'use client';

import { Filter } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';
import type { EditableField, ProductFilter } from '@catalog/shared';
import { COLUMN_BY_FIELD, hasActiveFilter } from '@/entities/product';
import { cn } from '@/shared/lib/cn';
import { parseDecimal, parseInteger, separators, type AppLocale } from '@/shared/lib/locale';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';

type Props = {
  field: EditableField;
  filter: ProductFilter;
  locale: AppLocale;
  onChange: (next: ProductFilter) => void;
};

const isActive = (field: EditableField, f: ProductFilter): boolean => {
  switch (field) {
    case 'sku':
      return !!f.sku;
    case 'name':
      return !!f.name;
    case 'category':
      return !!f.category?.length;
    case 'status':
      return !!f.status?.length;
    case 'price':
      return f.priceMin !== undefined || f.priceMax !== undefined;
    case 'stock':
      return f.stockMin !== undefined || f.stockMax !== undefined;
    default:
      return false;
  }
};

/** Filter button + popover for one column: text "contains", numeric range, or a list to choose from. */
export const ColumnFilter = ({ field, filter, locale, onChange }: Props) => {
  const t = useTranslations();
  const col = COLUMN_BY_FIELD[field];
  const [open, setOpen] = useState(false);
  if (!col.filter) return null;
  const active = isActive(field, filter);
  const label = t(`columns.${field}`);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${t('grid.filterBy', { column: label })}${active ? `, ${t('filter.active')}` : ''}`}
          className={cn('shrink-0 rounded p-1 hover:bg-accent', active && 'text-primary')}
        >
          <Filter aria-hidden className={cn('h-3.5 w-3.5', active && 'fill-current')} />
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label={t('grid.filterBy', { column: label })}>
        <FilterForm
          // remount per open so the form starts from the applied filter
          key={String(open)}
          field={field}
          filter={filter}
          locale={locale}
          onApply={(next) => {
            onChange(next);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
};

const FilterForm = ({
  field,
  filter,
  locale,
  onApply,
}: {
  field: EditableField;
  filter: ProductFilter;
  locale: AppLocale;
  onApply: (f: ProductFilter) => void;
}) => {
  const t = useTranslations();
  const col = COLUMN_BY_FIELD[field];
  const id = useId();
  const dec = separators(locale).decimal;
  const show = (v: string | number | undefined) =>
    v === undefined ? '' : String(v).replace('.', dec);

  const [text, setText] = useState(field === 'sku' ? (filter.sku ?? '') : (filter.name ?? ''));
  const [min, setMin] = useState(show(field === 'price' ? filter.priceMin : filter.stockMin));
  const [max, setMax] = useState(show(field === 'price' ? filter.priceMax : filter.stockMax));
  const [picked, setPicked] = useState<string[]>(
    (field === 'category' ? filter.category : filter.status) ?? [],
  );
  const [problem, setProblem] = useState<'min' | 'max' | null>(null);

  const without = (keys: (keyof ProductFilter)[]): ProductFilter => {
    const next = { ...filter };
    for (const k of keys) delete next[k];
    return next;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (col.filter === 'text') {
      const key = field === 'sku' ? 'sku' : 'name';
      const v = text.trim();
      return onApply(v ? { ...without([key]), [key]: v } : without([key]));
    }
    if (col.filter === 'select') {
      const key = field === 'category' ? 'category' : 'status';
      return onApply(
        picked.length ? ({ ...without([key]), [key]: picked } as ProductFilter) : without([key]),
      );
    }
    const parse = (s: string) =>
      field === 'price' ? parseDecimal(s, locale) : parseInteger(s, locale);
    const lo = min.trim() === '' ? null : parse(min);
    const hi = max.trim() === '' ? null : parse(max);
    if (lo && !lo.ok) return setProblem('min');
    if (hi && !hi.ok) return setProblem('max');
    const [kMin, kMax] =
      field === 'price' ? (['priceMin', 'priceMax'] as const) : (['stockMin', 'stockMax'] as const);
    const next = without([kMin, kMax]) as Record<string, unknown>;
    if (lo?.ok) next[kMin] = field === 'price' ? lo.value : Number(lo.value);
    if (hi?.ok) next[kMax] = field === 'price' ? hi.value : Number(hi.value);
    onApply(next as ProductFilter);
  };

  const clearAll = () => {
    const keys: Record<EditableField, (keyof ProductFilter)[]> = {
      sku: ['sku'],
      name: ['name'],
      category: ['category'],
      status: ['status'],
      price: ['priceMin', 'priceMax'],
      stock: ['stockMin', 'stockMax'],
      oldPrice: [],
      tags: [],
      arrivalDate: [],
    };
    onApply(without(keys[field]));
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      {col.filter === 'text' && (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">{t('filter.contains')}</span>
          <Input value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      )}
      {col.filter === 'range' && (
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="text-xs font-medium">{t('filter.min')}</span>
            <Input
              value={min}
              onChange={(e) => setMin(e.target.value)}
              inputMode="decimal"
              aria-invalid={problem === 'min' || undefined}
              aria-describedby={problem ? `${id}-err` : undefined}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="text-xs font-medium">{t('filter.max')}</span>
            <Input
              value={max}
              onChange={(e) => setMax(e.target.value)}
              inputMode="decimal"
              aria-invalid={problem === 'max' || undefined}
              aria-describedby={problem ? `${id}-err` : undefined}
            />
          </label>
        </div>
      )}
      {problem && (
        <p id={`${id}-err`} role="alert" className="text-xs text-danger">
          {t('filter.invalidNumber')}
        </p>
      )}
      {col.filter === 'select' && (
        <fieldset className="max-h-56 overflow-auto">
          <legend className="sr-only">{t(`columns.${field}`)}</legend>
          {col.options?.map((o) => {
            const group = field === 'category' ? 'categories' : 'status';
            const checked = picked.includes(o);
            return (
              <label
                key={o}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-accent"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    setPicked((cur) => (checked ? cur.filter((x) => x !== o) : [...cur, o]))
                  }
                />
                <span>{t(`${group}.${o}`)}</span>
              </label>
            );
          })}
        </fieldset>
      )}
      <div className="flex justify-between gap-2">
        <PopoverClose asChild>
          <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
            {t('filter.clear')}
          </Button>
        </PopoverClose>
        <Button type="submit" size="sm">
          {t('filter.apply')}
        </Button>
      </div>
    </form>
  );
};

export { hasActiveFilter };
