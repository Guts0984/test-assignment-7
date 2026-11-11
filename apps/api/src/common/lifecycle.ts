/** Process-level flags shared between the HTTP layer and background workers. */
export type Lifecycle = {
  shuttingDown: boolean;
  /** Called on shutdown, in order; workers register here to stop on a chunk boundary. */
  onShutdown: (fn: () => Promise<void>) => void;
  runShutdownHooks: () => Promise<void>;
};

export const createLifecycle = (): Lifecycle => {
  const hooks: (() => Promise<void>)[] = [];
  const lc: Lifecycle = {
    shuttingDown: false,
    onShutdown: (fn) => {
      hooks.push(fn);
    },
    runShutdownHooks: async () => {
      lc.shuttingDown = true;
      for (const h of hooks) await h();
    },
  };
  return lc;
};
