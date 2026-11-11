'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { EditableField, HistoryEntry } from '@catalog/shared';
import { displayText, fetchHistory, productKeys, restoreFromHistory } from '@/entities/product';
import { isApiFailure } from '@/shared/api/error';
import type { AppLocale } from '@/shared/lib/locale';
import { AnchoredPopover, type AnchorRect } from '@/shared/ui/anchored-popover';
import { Button } from '@/shared/ui/button';

type Props = {
  rect: AnchorRect | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  field: EditableField;
  /** Confirmed version of the cell now; the restore is a normal change and conflicts if this is stale. */
  currentVersion: number;
  canRestore: boolean;
  locale: AppLocale;
  /** Called after the server accepted the restore so the table can show the value. */
  onRestored: (entry: HistoryEntry, newVersion: number) => void;
};

/** Who changed the cell, when, from what to what - and a way to put an old value back. */
export const HistoryPopover = ({
  rect,
  open,
  onOpenChange,
  productId,
  field,
  currentVersion,
  canRestore,
  locale,
  onRestored,
}: Props) => {
  const t = useTranslations();
  const qc = useQueryClient();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const q = useQuery({
    queryKey: productKeys.history(productId, field),
    queryFn: () => fetchHistory(productId, field),
    enabled: open,
    staleTime: 0,
  });

  const show = (v: unknown): string => {
    if (v === null || v === undefined || (Array.isArray(v) && v.length === 0))
      return t('history.emptyValue');
    if (field === 'category') return t(`categories.${String(v)}`);
    if (field === 'status') return t(`status.${String(v)}`);
    return displayText(field, v, locale);
  };
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );

  const restore = async (e: HistoryEntry) => {
    setBusy(e.id);
    setMessage(null);
    try {
      const r = await restoreFromHistory(e.id, currentVersion);
      if (r.status === 'ok') {
        onRestored(e, r.newVersion);
        setMessage({ kind: 'ok', text: t('history.restored') });
        await qc.invalidateQueries({ queryKey: productKeys.history(productId, field) });
      }
    } catch (err) {
      let text = t('history.restoreFailed');
      if (isApiFailure(err)) {
        const d = err.details as { author?: { login?: string } | null } | undefined;
        if (err.status === 409)
          text = d?.author?.login
            ? t('history.restoreConflict', { author: d.author.login })
            : t('history.restoreConflictUnknown');
        else if (err.status === 403) text = t('history.restoreForbidden');
        else if (err.status === 400) text = t('history.restoreInvalid');
      }
      setMessage({ kind: 'error', text });
    } finally {
      setBusy(null);
    }
  };

  return (
    <AnchoredPopover
      rect={rect}
      open={open}
      onOpenChange={onOpenChange}
      label={t('history.title', { column: t(`columns.${field}`) })}
    >
      <h3 className="mb-2 text-sm font-semibold">
        {t('history.title', { column: t(`columns.${field}`) })}
      </h3>
      {q.isPending && <p className="text-sm text-muted-foreground">{t('history.loading')}</p>}
      {q.isError && (
        <p role="alert" className="text-sm text-danger">
          {t('history.error')}
        </p>
      )}
      {q.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('history.empty')}</p>
      )}
      <ol className="flex max-h-72 flex-col gap-2 overflow-auto">
        {q.data?.map((e) => (
          <li key={e.id} className="rounded border border-border p-2 text-sm">
            <div className="flex flex-wrap justify-between gap-x-2 text-xs text-muted-foreground">
              <span>
                {t('history.by', { author: e.author?.login ?? t('history.unknownAuthor') })}
              </span>
              <time dateTime={e.createdAt}>{when(e.createdAt)}</time>
              <span>{t(`history.source.${e.source}`)}</span>
            </div>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2">
              <dt className="text-muted-foreground">{t('history.was')}</dt>
              <dd className="break-words">{show(e.oldValue)}</dd>
              <dt className="text-muted-foreground">{t('history.became')}</dt>
              <dd className="break-words font-medium">{show(e.newValue)}</dd>
            </dl>
            {canRestore && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                disabled={busy !== null}
                onClick={() => restore(e)}
                aria-label={t('history.restore', { value: show(e.oldValue) })}
              >
                {busy === e.id
                  ? t('history.restoring')
                  : t('history.restore', { value: show(e.oldValue) })}
              </Button>
            )}
          </li>
        ))}
      </ol>
      <p
        role="status"
        aria-live="polite"
        className={
          message?.kind === 'error'
            ? 'mt-2 text-sm text-danger'
            : 'mt-2 text-sm text-muted-foreground'
        }
      >
        {message?.text}
      </p>
    </AnchoredPopover>
  );
};
