import { describe, expect, it } from 'vitest';
import { parseTsv, serializeTsv } from './tsv';

describe('parseTsv', () => {
  it('parses a plain block and ignores the trailing newline spreadsheets add', () => {
    expect(parseTsv('a\tb\nc\td\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
  it('handles Windows line endings and a lone \\r', () => {
    expect(parseTsv('a\tb\r\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseTsv('a\rb')).toEqual([['a'], ['b']]);
  });
  it('keeps empty cells (consecutive tabs) and empty lines in the middle', () => {
    expect(parseTsv('a\t\tc')).toEqual([['a', '', 'c']]);
    expect(parseTsv('a\n\nb')).toEqual([['a'], [''], ['b']]);
  });
  it('understands quoted cells with tabs, newlines and doubled quotes', () => {
    expect(parseTsv('"a\tb"\t"line1\nline2"\t"say ""hi"""')).toEqual([
      ['a\tb', 'line1\nline2', 'say "hi"'],
    ]);
  });
  it('a quote in the middle of an unquoted cell is literal', () => {
    expect(parseTsv('5" pipe\tx')).toEqual([['5" pipe', 'x']]);
  });
  it('an unterminated quote does not hang or lose data', () => {
    expect(parseTsv('"abc')).toEqual([['abc']]);
  });
  it('a single value is a 1x1 matrix; empty text is no rows', () => {
    expect(parseTsv('hello')).toEqual([['hello']]);
    expect(parseTsv('')).toEqual([]);
  });
  it('is fast on a 5000-row paste', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `SKU-${i}\tName ${i}\t12,50`).join('\n');
    const t0 = performance.now();
    expect(parseTsv(big)).toHaveLength(5000);
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

describe('serializeTsv', () => {
  it('round-trips tricky content', () => {
    const m = [
      ['plain', 'with\ttab', 'with\nnewline'],
      ['say "hi"', '', 'x'],
    ];
    expect(parseTsv(serializeTsv(m))).toEqual(m);
  });
  it('does not quote ordinary cells', () => {
    expect(serializeTsv([['a', 'b']])).toBe('a\tb');
  });
});
