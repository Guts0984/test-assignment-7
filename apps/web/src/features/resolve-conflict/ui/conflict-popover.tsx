'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import type { EditableField } from '@catalog/shared';
import { displayText, type ConflictInfo } from '@/entities/product';
import type { AppLocale } from '@/shared/lib/locale';
import type { AnchorRect } from '@/shared/ui/anchored-popover';
import { Button } from '@/shared/ui/button';

/**
 * Edit conflict on one cell: shows both values and who wrote the server's one; the person chooses.
 * A plain non-modal dialog (not a focus-trapping popover): it appears next to the active cell, does not
 * take focus, goes away when the selection moves off the conflicted cell, and Esc hides it.
 * Enter/F2 on the conflicted cell moves focus into it (see the grid's `conflict` command).
 */
export const ConflictPopover = ({
  rect,
  conflict,
  field,
  locale,
  onResolve,
  onClose,
}: {
  rect: AnchorRect | null;
  conflict: ConflictInfo | null;
  field: EditableField;
  locale: AppLocale;
  onResolve: (choice: 'mine' | 'theirs') => void;
  onClose: () => void;
}) => {
  const t = useTranslations();
  const visible = conflict !== null && rect !== null;

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, onClose]);

  if (!conflict || !rect) return null;
  const show = (v: unknown): string => {
    if (v === null || v === undefined || (Array.isArray(v) && v.length === 0))
      return t('history.emptyValue');
    if (field === 'category') return t(`categories.${String(v)}`);
    if (field === 'status') return t(`status.${String(v)}`);
    return displayText(field, v, locale);
  };

  return (
    <div
      role="dialog"
      aria-label={t('conflict.title')}
      data-conflict-popover=""
      className="fixed z-50 flex w-80 flex-col gap-3 rounded-md border border-border bg-popover p-3 text-sm text-foreground shadow-md"
      style={{ left: rect.left, top: rect.top + rect.height + 4 }}
    >
      <h3 className="text-sm font-semibold">{t('conflict.title')}</h3>
      <p>
        {conflict.author
          ? t('conflict.body', { author: conflict.author })
          : t('conflict.bodyUnknown')}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">{t('conflict.yours')}</dt>
        <dd className="break-words font-medium">{show(conflict.mine)}</dd>
        <dt className="text-muted-foreground">{t('conflict.theirs')}</dt>
        <dd className="break-words font-medium">{show(conflict.theirs)}</dd>
      </dl>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => onResolve('theirs')}>
          {t('conflict.keepTheirs')}
        </Button>
        <Button size="sm" onClick={() => onResolve('mine')}>
          {t('conflict.keepMine')}
        </Button>
      </div>
    </div>
  );
};
