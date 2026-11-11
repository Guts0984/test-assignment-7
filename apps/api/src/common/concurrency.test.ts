import { describe, expect, it } from 'vitest';
import { createConcurrencyLimiter } from './concurrency';

describe('createConcurrencyLimiter', () => {
  it('admits up to max per key, refuses the rest, and frees slots on release', () => {
    const l = createConcurrencyLimiter(2);
    const a = l.acquire('ip-1');
    const b = l.acquire('ip-1');
    expect(a && b).toBeTruthy();
    expect(l.acquire('ip-1')).toBeNull();
    a!();
    expect(l.acquire('ip-1')).not.toBeNull();
  });
  it('keys are independent: one noisy address does not affect another', () => {
    const l = createConcurrencyLimiter(1);
    expect(l.acquire('a')).not.toBeNull();
    expect(l.acquire('a')).toBeNull();
    expect(l.acquire('b')).not.toBeNull();
  });
  it('release is idempotent (a double release cannot grant extra slots) and the map does not leak', () => {
    const l = createConcurrencyLimiter(1);
    const r = l.acquire('a')!;
    r();
    r();
    expect(l.acquire('a')).not.toBeNull();
    expect(l.acquire('a')).toBeNull();
    const l2 = createConcurrencyLimiter(3);
    l2.acquire('x')!();
    expect(l2.size()).toBe(0);
  });
});
