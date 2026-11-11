import { compareDecimal } from './decimal';
import { fieldValueSchemas, type EditableField, type ProductState } from './product';

/** Stable machine codes; the web layer maps them to localised messages. */
export type RuleCode =
  | 'invalidValue'
  | 'oldPriceNotGreater'
  | 'oldPriceRequiresPrice'
  | 'activeRequiresPrice'
  | 'activeRequiresCategory';

export type FieldIssue = { field: EditableField; code: RuleCode; message: string };

/** Single-field validation (shape only). Returns issues, empty when valid. */
export const validateFieldValue = (field: EditableField, value: unknown): FieldIssue[] => {
  const r = fieldValueSchemas[field].safeParse(value);
  if (r.success) return [];
  return [{ field, code: 'invalidValue', message: r.error.issues[0]?.message ?? 'invalid value' }];
};

/**
 * Cross-field rules on the *resulting* state of a product. Used by api (authoritative)
 * and web (so invalid values never leave the browser).
 */
export const validateProductState = (
  s: Pick<ProductState, 'price' | 'oldPrice' | 'status' | 'category'>,
): FieldIssue[] => {
  const issues: FieldIssue[] = [];
  if (s.oldPrice !== null) {
    if (s.price === null) {
      issues.push({
        field: 'oldPrice',
        code: 'oldPriceRequiresPrice',
        message: 'oldPrice requires price',
      });
    } else if (compareDecimal(s.oldPrice, s.price) <= 0) {
      issues.push({
        field: 'oldPrice',
        code: 'oldPriceNotGreater',
        message: 'oldPrice must be greater than price',
      });
    }
  }
  if (s.status === 'active') {
    if (s.price === null)
      issues.push({
        field: 'price',
        code: 'activeRequiresPrice',
        message: 'active requires price',
      });
    if (s.category === null) {
      issues.push({
        field: 'category',
        code: 'activeRequiresCategory',
        message: 'active requires category',
      });
    }
  }
  return issues;
};
