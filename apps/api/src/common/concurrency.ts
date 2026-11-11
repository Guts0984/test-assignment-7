/**
 * Caps how many requests of one kind may be in flight per key (e.g. per client address) at once.
 * It is in-memory and runs BEFORE any database work, so a flood from one address is turned away
 * immediately instead of queueing for the shared connection pool and starving everyone else.
 */
export const createConcurrencyLimiter = (max: number) => {
  const inflight = new Map<string, number>();
  return {
    /** Returns a release function, or null when this key already has `max` requests in flight. */
    acquire: (key: string): (() => void) | null => {
      const n = inflight.get(key) ?? 0;
      if (n >= max) return null;
      inflight.set(key, n + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const cur = (inflight.get(key) ?? 1) - 1;
        if (cur <= 0) inflight.delete(key);
        else inflight.set(key, cur);
      };
    },
    size: () => inflight.size,
  };
};
