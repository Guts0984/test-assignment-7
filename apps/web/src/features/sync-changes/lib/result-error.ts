import type { ChangeResult, EditableField } from '@catalog/shared';
import type { CellError } from '@/entities/product';

const camel = (s: string): string => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** A server refusal -> the cell error the UI shows (`errors.<code>`). */
export const cellErrorFromResult = (
  field: EditableField,
  r: Exclude<ChangeResult, { status: 'ok' | 'conflict' }>,
): CellError => {
  switch (r.status) {
    case 'invalid': {
      const i = r.issues[0];
      const code = !i || i.code === 'invalidValue' ? 'invalid' : camel(i.code);
      return { code, field: i?.field ?? field };
    }
    case 'forbidden':
      return { code: 'readOnly', field };
    case 'not_found':
      return { code: 'notFound', field };
    default:
      return { code: 'invalid', field };
  }
};
