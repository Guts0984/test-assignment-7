import { describe, expect, it } from 'vitest';
import { extendLine, fillDirection, planFillTargets } from './fill';

describe('extendLine - numbers', () => {
  it('a single number is COPIED (default)', () => {
    expect(extendLine(['10.00'], 3, false, 'decimal', false)).toEqual(['10.00', '10.00', '10.00']);
    expect(extendLine([5], 3, false, 'integer', false)).toEqual([5, 5, 5]);
  });
  it('a single number COUNTS UP with Ctrl', () => {
    expect(extendLine([5], 3, false, 'integer', true)).toEqual([6, 7, 8]);
    expect(extendLine(['10.50'], 2, false, 'decimal', true)).toEqual(['11.50', '12.50']);
  });
  it('two numbers continue their step: 1,2 -> 3,4,5', () => {
    expect(extendLine([1, 2], 3, false, 'integer', false)).toEqual([3, 4, 5]);
    expect(extendLine([10, 20, 30], 2, false, 'integer', false)).toEqual([40, 50]);
    expect(extendLine([5, 3], 3, false, 'integer', false)).toEqual([1, -1, -3]);
  });
  it('decimal steps are exact (0.10 steps never drift)', () => {
    expect(extendLine(['0.10', '0.20'], 4, false, 'decimal', false)).toEqual([
      '0.30',
      '0.40',
      '0.50',
      '0.60',
    ]);
    const long = extendLine(['0.01', '0.02'], 500, false, 'decimal', false);
    expect(long[499]).toBe('5.02'); // 0.02 + 500 x 0.01
  });
  it('a series of 500 from two cells is exactly arithmetic', () => {
    const out = extendLine([100, 105], 500, false, 'integer', false) as number[];
    expect(out).toHaveLength(500);
    expect(out[0]).toBe(110);
    expect(out[499]).toBe(110 + 499 * 5);
  });
  it('not a constant step -> the pattern repeats', () => {
    expect(extendLine([1, 2, 4], 4, false, 'integer', false)).toEqual([1, 2, 4, 1]);
  });
  it('an empty cell in the source breaks the series -> repeat', () => {
    expect(extendLine(['1.00', null], 3, false, 'decimal', false)).toEqual(['1.00', null, '1.00']);
  });
  it('dragging UP continues backwards', () => {
    expect(extendLine([3, 4], 3, true, 'integer', false)).toEqual([2, 1, 0]);
    expect(extendLine(['a', 'b'], 3, true, 'text', false)).toEqual(['b', 'a', 'b']);
  });
});

describe('extendLine - dates, text, lists', () => {
  it('dates: copy, +1 day with Ctrl, constant step continues (month/leap boundaries)', () => {
    expect(extendLine(['2024-02-28'], 2, false, 'date', false)).toEqual([
      '2024-02-28',
      '2024-02-28',
    ]);
    expect(extendLine(['2024-02-28'], 3, false, 'date', true)).toEqual([
      '2024-02-29',
      '2024-03-01',
      '2024-03-02',
    ]);
    expect(extendLine(['2024-01-01', '2024-01-08'], 2, false, 'date', false)).toEqual([
      '2024-01-15',
      '2024-01-22',
    ]);
    expect(extendLine(['2023-12-30', '2023-12-31'], 2, false, 'date', false)).toEqual([
      '2024-01-01',
      '2024-01-02',
    ]);
  });
  it('text with a trailing number continues when it steps evenly, keeping zero padding', () => {
    expect(extendLine(['SKU-0007', 'SKU-0008'], 3, false, 'text', false)).toEqual([
      'SKU-0009',
      'SKU-0010',
      'SKU-0011',
    ]);
    expect(extendLine(['A1', 'A3'], 2, false, 'text', false)).toEqual(['A5', 'A7']);
    expect(extendLine(['SKU-0099'], 2, false, 'text', true)).toEqual(['SKU-0100', 'SKU-0101']);
  });
  it('different prefixes or plain text just repeat', () => {
    expect(extendLine(['A1', 'B2'], 3, false, 'text', false)).toEqual(['A1', 'B2', 'A1']);
    expect(extendLine(['Lamp'], 3, false, 'text', false)).toEqual(['Lamp', 'Lamp', 'Lamp']);
  });
  it('selects and tags are copied cyclically', () => {
    expect(extendLine(['draft', 'active'], 5, false, 'select', false)).toEqual([
      'draft',
      'active',
      'draft',
      'active',
      'draft',
    ]);
    expect(extendLine([['a']], 2, false, 'tags', false)).toEqual([['a'], ['a']]);
  });
  it('count 0 / empty source', () => {
    expect(extendLine([1, 2], 0, false, 'integer', false)).toEqual([]);
    expect(extendLine([], 5, false, 'integer', false)).toEqual([]);
  });
});

describe('fillDirection', () => {
  const s = { r1: 5, c1: 2, r2: 6, c2: 3 };
  it.each([
    [{ ...s, r2: 20 }, 'down'],
    [{ ...s, r1: 0 }, 'up'],
    [{ ...s, c2: 8 }, 'right'],
    [{ ...s, c1: 0 }, 'left'],
    [{ ...s, r2: 12, c2: 4 }, 'down'], // went further down than right
    [s, null],
  ])('%j -> %s', (ext, dir) => expect(fillDirection(s, ext)).toBe(dir));
});

describe('planFillTargets', () => {
  const values: Record<string, unknown> = { '0:5': 10, '1:5': 20, '0:1': 'Lamp', '0:3': '5.00' };
  const valueAt = (r: number, c: number) => values[`${r}:${c}`] ?? null;
  it('a two-cell numeric column is continued over 500 rows (one plan, one action)', () => {
    const t = planFillTargets({
      source: { r1: 0, c1: 5, r2: 1, c2: 5 },
      extended: { r1: 0, c1: 5, r2: 500, c2: 5 },
      valueAt,
      increment: false,
    });
    expect(t).toHaveLength(499);
    expect(t[0]).toMatchObject({ row: 2, col: 5, input: { value: 30 } });
    expect(t[498]).toMatchObject({ row: 500, col: 5, input: { value: 10 + 500 * 10 } });
  });
  it('several columns are filled independently', () => {
    const t = planFillTargets({
      source: { r1: 0, c1: 1, r2: 0, c2: 3 },
      extended: { r1: 0, c1: 1, r2: 2, c2: 3 },
      valueAt,
      increment: false,
    });
    expect(t.filter((x) => x.col === 1).map((x) => (x.input as { value: unknown }).value)).toEqual([
      'Lamp',
      'Lamp',
    ]);
    expect(t.filter((x) => x.col === 3).map((x) => (x.input as { value: unknown }).value)).toEqual([
      '5.00',
      '5.00',
    ]);
  });
  it('dragging up writes rows above, nearest first', () => {
    const t = planFillTargets({
      source: { r1: 10, c1: 5, r2: 11, c2: 5 },
      extended: { r1: 7, c1: 5, r2: 11, c2: 5 },
      valueAt: (r) => r * 10,
      increment: false,
    });
    expect(t.map((x) => [x.row, (x.input as { value: unknown }).value])).toEqual([
      [9, 90],
      [8, 80],
      [7, 70],
    ]);
  });
  it('filling right only copies across columns of the same kind', () => {
    const t = planFillTargets({
      source: { r1: 0, c1: 3, r2: 0, c2: 3 },
      extended: { r1: 0, c1: 3, r2: 0, c2: 5 },
      valueAt,
      increment: false,
    });
    // price -> oldPrice (both decimals) is allowed; price -> stock (integer) is not
    expect(t.map((x) => x.col)).toEqual([4]);
  });
  it('no extension -> nothing', () => {
    expect(
      planFillTargets({
        source: { r1: 0, c1: 5, r2: 0, c2: 5 },
        extended: { r1: 0, c1: 5, r2: 0, c2: 5 },
        valueAt,
        increment: false,
      }),
    ).toEqual([]);
  });
});
