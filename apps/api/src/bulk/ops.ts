import {
  computeAdjust,
  fieldValueSchemas,
  type BulkOperation,
  type EditableField,
} from '@catalog/shared';

export type Planned =
  | { kind: 'change'; field: EditableField; value: unknown }
  | { kind: 'skip'; reason: 'invalid' | 'unchanged'; message: string };

type Current = {
  name: string;
  category: string | null;
  price: string | null;
  oldPrice: string | null;
  stock: number;
  status: string;
  tags: string[];
  arrivalDate: string | null;
};

/** The field a job writes (used by revert to find the right history entry). */
export const fieldOfOperation = (op: BulkOperation): EditableField =>
  op.type === 'addTag' || op.type === 'removeTag' ? 'tags' : op.field;

/** Pure: current product + operation -> the single change to try. Validation happens in the change engine. */
export const planOperation = (op: BulkOperation, cur: Current): Planned => {
  switch (op.type) {
    case 'set':
      return { kind: 'change', field: op.field, value: op.value };
    case 'adjust': {
      const r = computeAdjust(op.field, cur[op.field], op.mode, op.amount);
      if (!r.ok) return { kind: 'skip', reason: 'invalid', message: r.message };
      return { kind: 'change', field: op.field, value: r.value };
    }
    case 'addTag':
      return cur.tags.includes(op.tag)
        ? { kind: 'skip', reason: 'unchanged', message: `Already has tag "${op.tag}"` }
        : { kind: 'change', field: 'tags', value: [...cur.tags, op.tag] };
    case 'removeTag':
      return cur.tags.includes(op.tag)
        ? { kind: 'change', field: 'tags', value: cur.tags.filter((t) => t !== op.tag) }
        : { kind: 'skip', reason: 'unchanged', message: `Does not have tag "${op.tag}"` };
  }
};

/** Cheap checks at job creation so obviously broken jobs are a 400, not 2000 skipped rows. */
export const validateOperation = (op: BulkOperation): string | null => {
  if (op.type === 'set') {
    const r = fieldValueSchemas[op.field].safeParse(op.value);
    return r.success ? null : `Value is not valid for ${op.field}: ${r.error.issues[0]?.message}`;
  }
  if (
    op.type === 'adjust' &&
    op.field === 'stock' &&
    op.mode === 'absolute' &&
    !/^-?\d+$/.test(op.amount)
  ) {
    return 'Stock changes by a whole number';
  }
  return null;
};
