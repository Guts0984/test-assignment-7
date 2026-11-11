'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LogOut, Moon, Sun } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useSearchParams } from 'next/navigation';
import { logout } from '@/entities/session';
import type { Me } from '@catalog/shared';
import { Link, useRouter } from '@/shared/i18n/navigation';
import { routing } from '@/shared/i18n/routing';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';

export const AppHeader = ({ me }: { me: Me }) => {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const { resolvedTheme, setTheme } = useTheme();
  const query = Object.fromEntries(params?.entries() ?? []);

  const out = useMutation({
    mutationFn: logout,
    onSettled: () => {
      qc.clear();
      router.replace('/login');
    },
  });

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
      <a
        href="#grid"
        className="sr-only focus:not-sr-only focus:rounded focus:bg-primary focus:px-2 focus:py-1 focus:text-primary-foreground"
      >
        {t('header.skip')}
      </a>
      <h1 className="text-base font-semibold">{t('common.appName')}</h1>
      <span className="flex-1" />
      <nav aria-label={t('common.language')} className="flex items-center gap-1">
        {routing.locales.map((l) => (
          <Link
            key={l}
            href={{ pathname: '/', query }}
            locale={l}
            aria-current={l === locale ? 'true' : undefined}
            className={cn(
              'rounded px-2 py-1 text-sm hover:bg-accent',
              l === locale && 'bg-accent font-semibold',
            )}
            lang={l}
          >
            {l.toUpperCase()}
          </Link>
        ))}
      </nav>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('common.theme')}
        onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      >
        {resolvedTheme === 'dark' ? (
          <Sun aria-hidden className="h-4 w-4" />
        ) : (
          <Moon aria-hidden className="h-4 w-4" />
        )}
      </Button>
      <span className="text-sm text-muted-foreground">
        {t('header.signedInAs', { login: me.login, role: t(`header.role${me.role}`) })}
      </span>
      <Button variant="outline" size="sm" onClick={() => out.mutate()}>
        <LogOut aria-hidden className="h-4 w-4" />
        {t('common.logout')}
      </Button>
    </header>
  );
};
