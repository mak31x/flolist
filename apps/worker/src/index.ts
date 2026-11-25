import { startWorker } from "./worker.ts";

const worker = startWorker();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void worker.stop().then(() => process.exit(0));
  });
}
