'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { EditableField } from '@catalog/shared';
import { COLUMN_BY_FIELD } from '@/entities/product';
import type { Dir } from '@/shared/lib/grid';
import { datePlaceholder, type AppLocale } from '@/shared/lib/locale';

export type EditorProps = {
  field: EditableField;
  locale: AppLocale;
  draft: string;
  origin: 'replace' | 'open';
  /** The character that started the edit; seeds list type-ahead. */
  seed?: string;
  invalid?: boolean;
  describedBy?: string;
  onChange: (text: string) => void;
  /** `none` = commit in place (blur); the others also move like Enter / Tab. */
  /** Return false when the value was rejected: the editor stays open and can be submitted again. */
  onCommit: (move: Dir | 'none') => boolean | void;
  onCancel: () => void;
};

/**
 * Editor for one cell, chosen by column kind. Keyboard contract (same for every kind):
 * Enter / Shift+Enter commit and go down / up, Tab / Shift+Tab commit and go right / left, Esc cancels.
 */
export const CellEditor = ({
  field,
  locale,
  draft,
  origin,
  seed,
  invalid,
  describedBy,
  onChange,
  onCommit,
  onCancel,
}: EditorProps) => {
  const t = useTranslations();
  const col = COLUMN_BY_FIELD[field];
  const ref = useRef<HTMLInputElement & HTMLSelectElement>(null);
  const done = useRef(false);
  // `at: 0` = seeded but nothing typed yet, so the seed character stays part of the buffer.
  const typed = useRef({ text: seed ?? '', at: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (el instanceof HTMLInputElement) {
      // Typing started the edit: caret after that character. F2/Enter/double click: select everything.
      if (origin === 'replace') el.setSelectionRange(el.value.length, el.value.length);
      else el.select();
    }
    // Only on mount: later draft changes must not move the caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = (fn: () => boolean | void) => {
    if (done.current) return;
    done.current = true;
    if (fn() === false) done.current = false; // rejected (invalid): keep editing
  };

  /** Cumulative type-ahead for lists: "A" -> Active, "Ar" -> Archived (the buffer resets after a pause). */
  const typeAhead = (e: KeyboardEvent) => {
    if (col.kind !== 'select' || e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    const now = Date.now();
    const expired = typed.current.at !== 0 && now - typed.current.at > 800;
    const buf = expired ? e.key : typed.current.text + e.key;
    typed.current = { text: buf, at: now };
    const group = field === 'category' ? 'categories' : 'status';
    const hit = col.options?.find((o) =>
      t(`${group}.${o}`).toLowerCase().startsWith(buf.toLowerCase()),
    );
    if (hit) {
      e.preventDefault();
      onChange(hit);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation(); // the grid's own key handling must not see keys meant for the editor
    typeAhead(e);
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        finish(() => onCommit(e.shiftKey ? 'up' : 'down'));
        break;
      case 'Tab':
        e.preventDefault();
        finish(() => onCommit(e.shiftKey ? 'left' : 'right'));
        break;
      case 'Escape':
        e.preventDefault();
        finish(onCancel);
        break;
    }
  };

  const common = {
    'aria-label': t(`columns.${field}`),
    'aria-invalid': invalid || undefined,
    'aria-describedby': describedBy,
    onKeyDown,
    onBlur: () => finish(() => onCommit('none')),
    className:
      'h-full w-full rounded-none border-0 bg-background px-2 text-sm outline-2 -outline-offset-2 outline-ring ' +
      (col.align === 'right' ? 'text-right' : ''),
  };

  if (col.kind === 'select') {
    const group = field === 'category' ? 'categories' : 'status';
    return (
      <select ref={ref} {...common} value={draft} onChange={(e) => onChange(e.target.value)}>
        {col.nullable && <option value="">{t('grid.noCategory')}</option>}
        {col.options?.map((o) => (
          <option key={o} value={o}>
            {t(`${group}.${o}`)}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      ref={ref}
      {...common}
      value={draft}
      onChange={(e) => onChange(e.target.value)}
      inputMode={col.kind === 'decimal' ? 'decimal' : col.kind === 'integer' ? 'numeric' : 'text'}
      placeholder={col.kind === 'date' ? datePlaceholder(locale) : undefined}
      autoComplete="off"
      spellCheck={false}
    />
  );
};
