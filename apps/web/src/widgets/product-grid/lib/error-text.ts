import type { EditableField } from '@catalog/shared';
import type { AppLocale } from '@/shared/lib/locale';
import type { CellError } from '@/entities/product';

type T = (key: string, values?: Record<string, string | number>) => string;

/** The sentence explaining a cell error: shown in the cell's tooltip and announced by the live region. */
export const cellErrorText = (
  t: T,
  error: CellError,
  field: EditableField,
  locale: AppLocale,
): string =>
  t(`errors.${error.code}`, {
    example:
      field === 'arrivalDate'
        ? locale === 'uk'
          ? '31.12.2025'
          : '12/31/2025'
        : locale === 'uk'
          ? '1 234,50'
          : '1,234.50',
    ...error.params,
  });
