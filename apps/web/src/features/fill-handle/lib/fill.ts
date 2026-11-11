import { COLUMNS, type CellTarget } from '@/entities/product';
import type { CellRange } from '@/shared/lib/grid';

export type FillDir = 'down' | 'up' | 'right' | 'left';

/** Which way the drag extended the source range (the bigger extension wins when it went both ways). */
export const fillDirection = (source: CellRange, target: CellRange): FillDir | null => {
  const down = target.r2 - source.r2;
  const up = source.r1 - target.r1;
  const right = target.c2 - source.c2;
  const left = source.c1 - target.c1;
  const best = Math.max(down, up, right, left);
  if (best <= 0) return null;
  if (down === best) return 'down';
  if (up === best) return 'up';
  if (right === best) return 'right';
  return 'left';
};

const toScaled = (s: string): bigint => {
  const neg = s.startsWith('-');
  const [i = '0', f = ''] = (neg ? s.slice(1) : s).split('.');
  const n = BigInt(i) * 100n + BigInt(f.padEnd(2, '0').slice(0, 2));
  return neg ? -n : n;
};
const fromScaled = (n: bigint): string => {
  const neg = n < 0n;
  const a = neg ? -n : n;
  return `${neg ? '-' : ''}${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`;
};
const DAY = 86_400_000;
const isoToDays = (s: string): number => Math.round(Date.parse(`${s}T00:00:00Z`) / DAY);
const daysToIso = (d: number): string => new Date(d * DAY).toISOString().slice(0, 10);

type Kind = (typeof COLUMNS)[number]['kind'];

/**
 * The next `count` values after a line of source cells.
 * `backwards` extends before the first cell instead (dragging up/left); results are ordered outward from the source.
 * - a single number/date/text is COPIED (Excel's default); with `increment` (Ctrl while dragging) it counts up by one
 * - two or more numbers/dates with a constant step CONTINUE that step (exact decimal math, no float drift)
 * - text ending in a number ("SKU-0007") continues when the numbers step evenly, keeping leading zeros
 * - anything else repeats the source pattern
 */
export const extendLine = (
  values: readonly unknown[],
  count: number,
  backwards: boolean,
  kind: Kind,
  increment: boolean,
): unknown[] => {
  const n = values.length;
  if (n === 0 || count <= 0) return [];
  const repeat = (): unknown[] =>
    Array.from({ length: count }, (_, k) => (backwards ? values[n - 1 - (k % n)] : values[k % n]));
  const sign = backwards ? -1n : 1n;
  const anchor = backwards ? values[0] : values[n - 1];

  if (kind === 'decimal' || kind === 'integer') {
    const nums = values.map((v) =>
      v === null || v === undefined
        ? null
        : kind === 'decimal'
          ? toScaled(String(v))
          : BigInt(Number(v)),
    );
    if (nums.some((v) => v === null)) return repeat();
    const ns = nums as bigint[];
    let step: bigint | null = null;
    if (n >= 2) {
      step = ns[1]! - ns[0]!;
      if (ns.some((v, i) => i > 0 && v - ns[i - 1]! !== step)) return repeat();
    } else if (increment) step = kind === 'decimal' ? 100n : 1n;
    if (step === null) return repeat();
    const base = backwards ? ns[0]! : ns[n - 1]!;
    return Array.from({ length: count }, (_, k) => {
      const v = base + sign * step! * BigInt(k + 1);
      return kind === 'decimal' ? fromScaled(v) : Number(v);
    });
  }

  if (kind === 'date') {
    if (values.some((v) => typeof v !== 'string')) return repeat();
    const ds = (values as string[]).map(isoToDays);
    let step: number | null = null;
    if (n >= 2) {
      step = ds[1]! - ds[0]!;
      if (ds.some((v, i) => i > 0 && v - ds[i - 1]! !== step)) return repeat();
    } else if (increment) step = 1;
    if (step === null) return repeat();
    const base = backwards ? ds[0]! : ds[n - 1]!;
    return Array.from({ length: count }, (_, k) =>
      daysToIso(base + (backwards ? -1 : 1) * step! * (k + 1)),
    );
  }

  if (kind === 'text' && values.every((v) => typeof v === 'string')) {
    const m = (values as string[]).map((v) => /^(.*?)(\d+)$/.exec(v));
    if (m.every(Boolean)) {
      const prefix = m[0]![1]!;
      if (m.every((x) => x![1] === prefix)) {
        const nums = m.map((x) => BigInt(x![2]!));
        let step: bigint | null = null;
        if (n >= 2) {
          step = nums[1]! - nums[0]!;
          if (nums.some((v, i) => i > 0 && v - nums[i - 1]! !== step)) return repeat();
        } else if (increment) step = 1n;
        if (step !== null) {
          const width = Math.max(...m.map((x) => x![2]!.length));
          const pad = m.some((x) => x![2]!.startsWith('0')) ? width : 0;
          const base = backwards ? nums[0]! : nums[n - 1]!;
          return Array.from({ length: count }, (_, k) => {
            const v = base + sign * step! * BigInt(k + 1);
            return v < 0n ? String(anchor) : `${prefix}${v.toString().padStart(pad, '0')}`;
          });
        }
      }
    }
  }
  return repeat();
};

/**
 * Drag result -> the cells to write. `source` is the selection that was dragged from, `extended` is the
 * range after dragging (it contains `source`). Each column (down/up) or row (right/left) is a line.
 */
export const planFillTargets = (p: {
  source: CellRange;
  extended: CellRange;
  valueAt: (row: number, col: number) => unknown;
  increment: boolean;
}): CellTarget[] => {
  const dir = fillDirection(p.source, p.extended);
  if (!dir) return [];
  const { source: s, extended: e } = p;
  const out: CellTarget[] = [];
  if (dir === 'down' || dir === 'up') {
    const count = dir === 'down' ? e.r2 - s.r2 : s.r1 - e.r1;
    for (let c = s.c1; c <= s.c2; c++) {
      const line = Array.from({ length: s.r2 - s.r1 + 1 }, (_, i) => p.valueAt(s.r1 + i, c));
      const kind = COLUMNS[c]!.kind;
      extendLine(line, count, dir === 'up', kind, p.increment).forEach((value, k) => {
        out.push({ row: dir === 'down' ? s.r2 + 1 + k : s.r1 - 1 - k, col: c, input: { value } });
      });
    }
  } else {
    const count = dir === 'right' ? e.c2 - s.c2 : s.c1 - e.c1;
    for (let r = s.r1; r <= s.r2; r++) {
      // A row mixes columns of different kinds; copy each source cell outward when kinds differ.
      const line = Array.from({ length: s.c2 - s.c1 + 1 }, (_, i) => p.valueAt(r, s.c1 + i));
      for (let k = 0; k < count; k++) {
        const col = dir === 'right' ? s.c2 + 1 + k : s.c1 - 1 - k;
        const srcIndex: number =
          dir === 'right' ? k % line.length : line.length - 1 - (k % line.length);
        const srcCol = s.c1 + srcIndex;
        // only copy across columns of the same kind (a price cannot become a status)
        if (COLUMNS[col]?.kind === COLUMNS[srcCol]?.kind)
          out.push({ row: r, col, input: { value: line[srcIndex] } });
      }
    }
  }
  return out;
};
