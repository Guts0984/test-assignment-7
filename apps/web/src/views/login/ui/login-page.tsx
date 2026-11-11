'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';
import { getDemoAccounts, login, sessionKeys } from '@/entities/session';
import { isApiFailure } from '@/shared/api/error';
import { useRouter } from '@/shared/i18n/navigation';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';

export const LoginPage = () => {
  const t = useTranslations('login');
  const router = useRouter();
  const qc = useQueryClient();
  const [loginValue, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const demo = getDemoAccounts();
  const loginId = useId();
  const passwordId = useId();

  const m = useMutation({
    mutationFn: () => login({ login: loginValue, password }),
    onSuccess: (me) => {
      qc.setQueryData(sessionKeys.me, me);
      router.replace('/');
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };

  const message = (() => {
    const e = m.error;
    if (!e) return null;
    if (isApiFailure(e) && e.code === 'rate_limited')
      return t('rateLimited', { seconds: e.retryAfterSec ?? 60 });
    if (isApiFailure(e) && (e.status === 401 || e.status === 400)) return t('invalid');
    return t('unavailable');
  })();

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={loginId} className="text-sm font-medium">
            {t('login')}
          </label>
          <Input
            id={loginId}
            name="login"
            autoComplete="username"
            value={loginValue}
            onChange={(e) => setLogin(e.target.value)}
            aria-invalid={m.isError || undefined}
            aria-describedby={message ? 'login-error' : undefined}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={passwordId} className="text-sm font-medium">
            {t('password')}
          </label>
          <Input
            id={passwordId}
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={m.isError || undefined}
            required
          />
        </div>
        {message && (
          <p id="login-error" role="alert" className="text-sm text-danger">
            {message}
          </p>
        )}
        <Button type="submit" disabled={m.isPending || !loginValue || !password}>
          {t('submit')}
        </Button>
      </form>
      {demo.length > 0 && (
        <section
          aria-label={t('demo.title')}
          className="flex flex-col gap-2 rounded-md border border-border bg-muted p-3 text-sm"
        >
          <h2 className="font-semibold">{t('demo.title')}</h2>
          <p className="text-muted-foreground">{t('demo.hint')}</p>
          <ul className="flex flex-col gap-1.5">
            {demo.map((a) => (
              <li key={a.login}>
                <button
                  type="button"
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-left hover:bg-accent"
                  onClick={() => {
                    setLogin(a.login);
                    setPassword(a.password);
                  }}
                >
                  <span className="font-mono font-medium">{a.login}</span> /{' '}
                  <span className="font-mono">{a.password}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`demo.role.${a.login}`)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
};
