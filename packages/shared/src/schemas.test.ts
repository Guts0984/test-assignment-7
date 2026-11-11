import { describe, expect, it } from 'vitest';
import { batchRequestSchema, BATCH_MAX } from './batch';
import { createBulkJobSchema } from './bulk';
import { loginRequestSchema } from './auth';

const id = '3f2b8c1e-5d4a-4b6e-9a1c-2d7e8f9a0b1c';
const ch = (n: number) =>
  Array.from({ length: n }, () => ({ id, field: 'name', value: 'x', baseVersion: 0 }));

describe('batch request', () => {
  it('accepts 1..1000, rejects 0 and 1001', () => {
    expect(batchRequestSchema.safeParse({ changes: ch(1) }).success).toBe(true);
    expect(batchRequestSchema.safeParse({ changes: ch(BATCH_MAX) }).success).toBe(true);
    expect(batchRequestSchema.safeParse({ changes: ch(0) }).success).toBe(false);
    expect(batchRequestSchema.safeParse({ changes: ch(BATCH_MAX + 1) }).success).toBe(false);
  });
  it.each([
    [{ changes: [{ id: 'nope', field: 'name', value: 'x', baseVersion: 0 }] }],
    [{ changes: [{ id, field: 'id', value: 'x', baseVersion: 0 }] }],
    [{ changes: [{ id, field: 'name', value: 'x', baseVersion: -1 }] }],
    [{ changes: [{ id, field: 'name', value: 'x', baseVersion: 1.5 }] }],
    [{ changes: [{ id, field: '__proto__', value: 'x', baseVersion: 0 }] }],
    [{ changes: 'x' }],
    [null],
    [[]],
  ])('rejects malformed %j', (body) => {
    expect(batchRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('bulk job', () => {
  it('rejects bad amounts and unknown operations', () => {
    const base = { filter: {} };
    expect(
      createBulkJobSchema.safeParse({
        ...base,
        operation: { type: 'adjust', field: 'price', mode: 'percent', amount: '10' },
      }).success,
    ).toBe(true);
    for (const amount of ['1e3', 'abc', '', '1.234', '--1']) {
      expect(
        createBulkJobSchema.safeParse({
          ...base,
          operation: { type: 'adjust', field: 'price', mode: 'percent', amount },
        }).success,
      ).toBe(false);
    }
    expect(
      createBulkJobSchema.safeParse({
        ...base,
        operation: { type: 'adjust', field: 'name', mode: 'percent', amount: '1' },
      }).success,
    ).toBe(false);
    expect(createBulkJobSchema.safeParse({ ...base, operation: { type: 'drop' } }).success).toBe(
      false,
    );
  });
});

describe('login', () => {
  it('rejects non-strings and oversize input (no object injection)', () => {
    expect(loginRequestSchema.safeParse({ login: { $ne: '' }, password: 'x' }).success).toBe(false);
    expect(loginRequestSchema.safeParse({ login: 'a', password: 'x'.repeat(257) }).success).toBe(
      false,
    );
    expect(loginRequestSchema.safeParse({ login: '', password: 'x' }).success).toBe(false);
  });
});
