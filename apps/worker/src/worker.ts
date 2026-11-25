/**
 * The worker process. pg-boss job handlers (reminders, push, email, digests) are added in later
 * phases; for now it only starts, stays alive and shuts down cleanly.
 */
export interface Worker {
  stop(): Promise<void>;
}

export function startWorker(log: (msg: string) => void = console.log): Worker {
  log("[worker] started (no jobs registered yet)");
  const keepAlive = setInterval(() => undefined, 60_000);
  return {
    stop() {
      clearInterval(keepAlive);
      log("[worker] stopped");
      return Promise.resolve();
    },
  };
}
