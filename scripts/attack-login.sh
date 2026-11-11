#!/usr/bin/env bash
# Hostile-client checks against the REAL stack (docker compose up), through nginx on :8080.
# Every "client" is a separate container, so each one really has its own source address.
#   docker compose up --build -d --wait && scripts/attack-login.sh
set -uo pipefail

NGINX="$(docker compose ps -q nginx)"
NET="$(docker inspect "$NGINX" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')"
URL="http://nginx:8080"
IMG=curlimages/curl:8.10.1
FAILS=0
ok()   { echo "ok   - $1"; }
bad()  { echo "FAIL - $1"; FAILS=$((FAILS + 1)); }

# Every client is a long-lived container, so each one keeps its OWN source address for the whole run
# (Docker hands a freed address to the next container, which would silently merge two "users").
CLIENTS=()
# Every client carries a label, so leftovers of a killed run are found and removed by label.
LABEL=catalog-attack-client
cleanup() { docker ps -aq --filter "label=$LABEL" | xargs -r docker rm -f >/dev/null 2>&1; }
trap cleanup EXIT INT TERM
cleanup   # leftovers from an earlier interrupted run
client() { local id; id="$(docker run -d --label "$LABEL" --network "$NET" "$IMG" sleep 1800)"; CLIENTS+=("$id"); echo "$id"; }
from() { docker exec "$1" sh -c "$2"; }   # from <client> <shell snippet>
login_code() { # login password
  printf 'curl -s -o /dev/null -w "%%{http_code}" -X POST -H "content-type: application/json" -H "origin: http://localhost:8080" -d '"'"'{"login":"%s","password":"%s"}'"'"' %s/api/auth/login' "$1" "$2" "$URL"
}
good_admin="$(login_code admin admin-pass-123)"
good_viewer="$(login_code viewer viewer-pass-123)"
ipof() { docker inspect "$1" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'; }
psql_() { docker compose exec -T postgres psql -U "${POSTGRES_USER:-catalog}" -d "${POSTGRES_DB:-catalog}" "$@"; }

echo "== 0. reset limiter state so the run is repeatable"
psql_ -qc "delete from rate_limits" >/dev/null

ATTACKER="$(client)"; ADMIN_REAL="$(client)"; VIEWER_REAL="$(client)"
echo "     attacker=$(ipof "$ATTACKER")  real admin=$(ipof "$ADMIN_REAL")  real viewer=$(ipof "$VIEWER_REAL")"

echo "== 1. one attacker address hammers admin's account: the REAL admin on another address must be unaffected"
from "$ATTACKER" "for i in \$(seq 1 80); do $(login_code admin "guess-\$i"); echo; done" | sort | uniq -c | sed 's/^/     attacker codes: /'
[ "$(from "$ADMIN_REAL" "$good_admin")" = 200 ] && ok "admin logs in from a different address while being attacked" || bad "admin locked out by a single-address attack"

echo "== 2. the attacker also floods the site: other users stay fast"
from "$ATTACKER" "for i in \$(seq 1 150); do curl -s -o /dev/null $URL/uk/login; $(login_code "user\$i" x) >/dev/null; done" >/dev/null 2>&1 &
sleep 1
T0=$(date +%s%N); C="$(from "$VIEWER_REAL" "$good_viewer")"; T1=$(date +%s%N)
[ "$C" = 200 ] && ok "viewer logs in during the flood ($(( (T1 - T0) / 1000000 )) ms)" || bad "viewer got $C during a flood"
wait

echo "== 3. DISTRIBUTED guessing: 25 different addresses x 5 wrong passwords at the SAME account (a botnet)"
KNOWN="$(client)"
[ "$(from "$KNOWN" "$good_admin")" = 200 ] && ok "admin's usual address logs in once (becomes a known address)" || bad "initial login from the usual address failed"
BOTS=(); for n in $(seq 1 25); do BOTS+=("$(client)"); done
for n in $(seq 1 25); do from "${BOTS[$((n-1))]}" "for i in 1 2 3 4 5; do $(login_code admin "bot-$n-\$i"); echo; done" >/dev/null; done
FRESH="$(client)"
RESULT="$(from "$FRESH" "$good_admin")"
echo "     real admin with the CORRECT password from a NEW address during the botnet attack: HTTP $RESULT"
echo "     (a botnet of $(ipof "${BOTS[0]}") ... $(ipof "${BOTS[24]}"))"
if [ "$RESULT" = 200 ]; then ok "new address not locked out"; else echo "note - a NEW address is throttled while an account is under distributed attack ($RESULT); see next check"; fi
[ "$(from "$KNOWN" "$good_admin")" = 200 ] && ok "admin from the USUAL address still logs in during the botnet attack" || bad "account lockout DoS: the botnet blocked admin on his usual address"

echo "== 4. a NEIGHBOUR behind the SAME address (office / campus / carrier NAT) cannot lock the real user out"
# KNOWN is the admin's usual address and is also where the "neighbour" sits (same container = same address)
for i in 1 2 3 4 5 6 7 8; do from "$KNOWN" "$(login_code admin "neighbour-$i")" >/dev/null; done
[ "$(from "$KNOWN" "$good_admin")" = 200 ] && ok "admin still logs in from the shared address after 8 wrong guesses by a neighbour" || bad "a neighbour on the same address locked the user out"
STRANGER="$(client)"
NEIGH="$(for i in 1 2 3 4 5 6 7 8; do from "$STRANGER" "$(login_code admin "stranger-$i")"; echo; done | sort | uniq -c | tr '\n' ' ')"
echo "     an address that never logged in as admin, 8 wrong guesses: $NEIGH"
echo "$NEIGH" | grep -q '429' && ok "a stranger's guessing is capped at 5 per address" || bad "a stranger can guess without limit"

echo "== 4b. a RETURNING user on a NEW address keeps access (device cookie) while the botnet attacks; a stranger does not"
psql_ -qc "delete from rate_limits" >/dev/null   # the earlier botnet already exhausted the account ceiling; start clean
DEV1="$(client)"
from "$DEV1" "curl -s -c /tmp/jar -o /dev/null -X POST -H 'content-type: application/json' -H 'origin: http://localhost:8080' -d '{\"login\":\"admin\",\"password\":\"admin-pass-123\"}' $URL/api/auth/login"
DID="$(from "$DEV1" "grep -w did /tmp/jar | awk '{print \$7}'")"
[ -n "$DID" ] && ok "login issued a device cookie" || bad "no device cookie issued"
NEWADDR="$(client)"; STRANGER2="$(client)"
for n in $(seq 1 25); do BOT="$(client)"; from "$BOT" "for i in 1 2 3 4 5; do $(login_code admin "bot3-$n-\$i"); echo; done" >/dev/null; done
[ "$(from "$NEWADDR" "curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -H 'origin: http://localhost:8080' -H 'cookie: did=$DID' -d '{\"login\":\"admin\",\"password\":\"admin-pass-123\"}' $URL/api/auth/login")" = 200 ] \
  && ok "the owner's browser logs in from a brand-new address during a botnet attack" || bad "returning user locked out by the botnet"
[ "$(from "$STRANGER2" "$good_admin")" = 429 ] && ok "a stranger with the right password is still throttled (the botnet is not rewarded)" || echo "note - stranger not throttled"

psql_ -qc "delete from rate_limits" >/dev/null   # fresh limiter state for the remaining checks
echo "== 5. cross-user data: a viewer must not see another user's background jobs"
JAR="$(mktemp)"; VJAR="$(mktemp)"
curl -s -c "$JAR" -X POST -H 'content-type: application/json' -H 'origin: http://localhost:8080' -d '{"login":"admin","password":"admin-pass-123"}' localhost:8080/api/auth/login >/dev/null
JOB="$(curl -s -b "$JAR" -X POST -H 'content-type: application/json' -H 'origin: http://localhost:8080' -d '{"filter":{"name":"zzz-none"},"operation":{"type":"addTag","tag":"t"}}' localhost:8080/api/bulk-jobs | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')"
curl -s -c "$VJAR" -X POST -H 'content-type: application/json' -H 'origin: http://localhost:8080' -d '{"login":"viewer","password":"viewer-pass-123"}' localhost:8080/api/auth/login >/dev/null
[ "$(curl -s -o /dev/null -w '%{http_code}' -b "$VJAR" localhost:8080/api/bulk-jobs/$JOB)" != 200 ] && ok "viewer cannot read admin's job by id" || bad "viewer can read admin's job (author, filter, skipped SKUs)"
curl -s -b "$VJAR" localhost:8080/api/bulk-jobs | grep -q "$JOB" && bad "viewer sees admin's job in the job list" || ok "viewer's job list does not contain admin's job"
[ "$(curl -s -b "$VJAR" localhost:8080/api/me | python3 -c 'import sys,json; print(json.load(sys.stdin)["login"])')" = viewer ] && ok "/me returns only the caller" || bad "/me leaks another user"

echo "== 6. no user enumeration: unknown login and wrong password look the same"
A="$(curl -s -X POST -H 'content-type: application/json' -d '{"login":"admin","password":"nope"}' localhost:8080/api/auth/login | python3 -c 'import sys,json; d=json.load(sys.stdin)["error"]; print(d["code"],d["message"])')"
B="$(curl -s -X POST -H 'content-type: application/json' -d '{"login":"no-such-user","password":"nope"}' localhost:8080/api/auth/login | python3 -c 'import sys,json; d=json.load(sys.stdin)["error"]; print(d["code"],d["message"])')"
[ "$A" = "$B" ] && ok "identical error for existing and non-existing login ($A)" || bad "enumeration: '$A' vs '$B'"

echo "== 7. CSRF / CORS"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'origin: https://evil.example' -H 'content-type: application/json' -d '{"login":"viewer","password":"viewer-pass-123"}' localhost:8080/api/auth/login)" = 403 ] && ok "login from a foreign Origin refused" || bad "foreign origin accepted"
curl -s -i -X OPTIONS -H 'origin: https://evil.example' -H 'access-control-request-method: POST' localhost:8080/api/auth/login | grep -qi 'access-control-allow-origin: https://evil' && bad "CORS allows a foreign origin" || ok "no CORS allowance for a foreign origin"

echo "== 8. session cookie flags and forgery"
curl -s -i -X POST -H 'content-type: application/json' -H 'origin: http://localhost:8080' -d '{"login":"viewer","password":"viewer-pass-123"}' localhost:8080/api/auth/login | grep -i '^set-cookie' | grep -qi 'httponly' && ok "session cookie is HttpOnly" || bad "cookie not HttpOnly"
[ "$(curl -s -o /dev/null -w '%{http_code}' -H 'cookie: sid=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' localhost:8080/api/me)" = 401 ] && ok "forged session token refused" || bad "forged token accepted"

echo
[ "$FAILS" = 0 ] && echo "ALL ATTACK CHECKS PASSED" || { echo "$FAILS CHECK(S) FAILED"; exit 1; }
