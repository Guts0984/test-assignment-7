'use client';

import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/shared/lib/cn';
import type { SyncStatus } from '../lib/sync-engine';

/** "N unsaved" / "saved" / "error", announced politely to screen readers. */
export const SyncIndicator = ({
  status,
  problems = 0,
  className,
}: {
  status: SyncStatus;
  /** Cells that were refused or are in conflict: "all saved" would be a lie while any exist. */
  problems?: number;
  className?: string;
}) => {
  const t = useTranslations('sync');
  const { state, unsaved, lastError } = status;
  const attention = state === 'saved' && problems > 0;
  const text = attention
    ? t('needsAttention', { count: problems })
    : state === 'saved'
      ? t('saved')
      : state === 'retrying'
        ? t('retrying', { count: unsaved })
        : state === 'error'
          ? lastError === 'Session expired'
            ? t('sessionExpired')
            : t('error')
          : unsaved > 0
            ? t('unsaved', { count: unsaved })
            : t('saved');
  const Icon =
    state === 'saved' && !attention ? Check : state === 'saving' ? Loader2 : AlertTriangle;
  return (
    <p
      role="status"
      aria-live="polite"
      data-state={state}
      className={cn(
        'flex items-center gap-1.5 text-sm',
        state === 'saved' && !attention && 'text-muted-foreground',
        attention && 'text-warning',
        (state === 'retrying' || state === 'error') && 'text-danger',
        className,
      )}
    >
      <Icon aria-hidden className={cn('h-4 w-4', state === 'saving' && 'animate-spin')} />
      <span>{text}</span>
    </p>
  );
};
