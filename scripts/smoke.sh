#!/usr/bin/env bash
# Smoke + protection checks against a running `docker compose up` stack, all through nginx on :8080.
# Used by CI and runnable locally:  docker compose up --build -d --wait && scripts/smoke.sh
set -euo pipefail

BASE="http://localhost:${PUBLIC_PORT:-8080}"
ORIGIN="$BASE"
pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1" >&2; exit 1; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
login_body() { printf '{"login":"%s","password":"%s"}' "$1" "$2"; }

# 1. one entry point serves both the web app and the API
[ "$(code "$BASE/uk/login")" = 200 ] && pass "web app on $BASE/" || fail "web app"
[ "$(code "$BASE/docs")" = 200 ] && pass "swagger on $BASE/docs" || fail "swagger"
[ "$(code "$BASE/nginx-health")" = 200 ] && pass "nginx health" || fail "nginx health"
[ "$(code localhost:4000/ready 2>/dev/null || true)" != 200 ] && pass "api is NOT published directly" || fail "api published"
[ "$(code localhost:3000/ 2>/dev/null || true)" != 200 ] && pass "web is NOT published directly" || fail "web published"

# 2. protection headers, no version leak
H="$(curl -sI "$BASE/uk/login")"
echo "$H" | grep -qi '^x-content-type-options: nosniff' && pass "nosniff" || fail "nosniff"
echo "$H" | grep -qi '^x-frame-options: DENY' && pass "frame deny" || fail "frame deny"
echo "$H" | grep -qi '^content-security-policy:.*frame-ancestors' && pass "csp frame-ancestors" || fail "csp"
echo "$H" | grep -Eqi '^server: nginx/[0-9]' && fail "nginx version leaked" || pass "no nginx version in Server header"

# 3. only the methods the app uses
[ "$(code -X TRACE "$BASE/")" = 405 ] && pass "TRACE refused" || fail "TRACE"
[ "$(code -X DELETE "$BASE/api/products")" = 405 ] && pass "DELETE refused at the edge" || fail "DELETE"

# 4. oversize body is stopped at the edge
head -c 2000000 /dev/zero | tr '\0' 'a' > /tmp/big.json
[ "$(code -X POST -H 'content-type: application/json' --data-binary @/tmp/big.json "$BASE/api/auth/login")" = 413 ] && pass "2 MB body -> 413" || fail "body limit"

# 5. normal flow works through the proxy
JAR="$(mktemp)"
[ "$(code -c "$JAR" -X POST -H 'content-type: application/json' -H "origin: $ORIGIN" -d "$(login_body admin admin-pass-123)" "$BASE/api/auth/login")" = 200 ] && pass "login through nginx" || fail "login"
N="$(curl -fsS -b "$JAR" "$BASE/api/products" | python3 -c 'import sys,json; print(len(json.load(sys.stdin)["products"]))')"
[ "$N" = 2000 ] && pass "2000 products through nginx" || fail "products ($N)"

# 6. spoofed X-Forwarded-For must not create fresh identities: a flood still gets limited
GOT429=0
for i in $(seq 1 40); do
  c="$(code -X POST -H 'content-type: application/json' -H "x-forwarded-for: 10.$((i % 250)).$((i % 200)).$i" -d "$(login_body admin wrong-$i)" "$BASE/api/auth/login")"
  [ "$c" = 429 ] && GOT429=$((GOT429 + 1))
done
[ "$GOT429" -ge 20 ] && pass "XFF-spoofing flood limited ($GOT429/40 got 429)" || fail "spoofed flood not limited ($GOT429/40)"

# 7. THE KEY CHECK: the attacker above is blocked at once, an honest user on ANOTHER address is not.
#    (Checked right after the flood: the edge bucket refills at 30/min, so a few seconds later one request
#    would pass nginx, and the API's own per-address ceiling is deliberately higher than what nginx lets through.)
[ "$(code -X POST -H 'content-type: application/json' -d "$(login_body editor1 wrong)" "$BASE/api/auth/login")" = 429 ] && pass "attacker blocked" || fail "attacker not blocked"
NET="$(docker inspect "$(docker compose ps -q nginx)" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')"
OTHER="$(docker run --rm --network "$NET" curlimages/curl:8.10.1 -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -H "origin: $ORIGIN" -d "$(login_body viewer viewer-pass-123)" http://nginx:8080/api/auth/login)"
[ "$OTHER" = 200 ] && pass "honest user on another address logs in while the attacker is blocked" || fail "other user got $OTHER"

# 8. the API keyed the limiter on real client addresses, never on nginx's own address
NGINX_IP="$(docker inspect "$(docker compose ps -q nginx)" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')"
KEYS="$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-catalog}" -d "${POSTGRES_DB:-catalog}" -Atc "select key from rate_limits where key like 'login:ip:%' order by 1")"
echo "$KEYS" | sed 's/^/     key: /'
echo "$KEYS" | grep -q "login:ip:$NGINX_IP\$" && fail "limiter keyed on the nginx address ($NGINX_IP): all users would share one bucket" || pass "limiter is not keyed on the proxy address ($NGINX_IP)"
echo "$KEYS" | grep -q 'login:ip:10\.' && fail "limiter trusted a spoofed X-Forwarded-For" || pass "limiter ignored spoofed X-Forwarded-For values"
[ "$(echo "$KEYS" | grep -c .)" -ge 2 ] && pass "separate buckets per real client address ($(echo "$KEYS" | grep -c .))" || fail "expected one bucket per client address"

# 9. graceful stop
docker compose stop api > /dev/null
[ "$(docker inspect "$(docker compose ps -aq api)" --format '{{.State.ExitCode}}')" = 0 ] && pass "api stops with exit code 0" || fail "api exit code"
docker compose up -d --wait api > /dev/null
# 10. the strict login limit cannot be dodged by spelling the URL differently (Express is case-insensitive
#     and ignores a trailing slash). Empty the bucket with the canonical URL, then every other spelling must be
#     refused AT THE EDGE at once (nginx's own 429 is HTML; the API's is JSON), because they share the bucket.
for i in $(seq 1 30); do curl -s -o /dev/null -X POST -H 'content-type: application/json' -d '{"login":"x","password":"y"}' "$BASE/api/auth/login"; done
for path in /api/auth/LOGIN /api/auth/Login/ /api/auth/login// '/api/auth/%6cogin' '/api/auth/login/?a=b'; do
  H="$(curl -s -i -X POST -H 'content-type: application/json' -d '{"login":"x","password":"y"}' "$BASE$path" | tr -d '\r')"
  echo "$H" | head -1 | grep -q ' 429 ' && echo "$H" | grep -qi '^content-type: text/html' \
    && pass "login limit applies at the edge to $path" || fail "nginx login limit bypassed via $path"
done

echo "all checks passed"
