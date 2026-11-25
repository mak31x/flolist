import { describe, expect, it } from "vitest";
import { startWorker } from "./worker.ts";

describe("startWorker", () => {
  it("starts and stops cleanly", async () => {
    const logs: string[] = [];
    const worker = startWorker((m) => logs.push(m));
    await worker.stop();
    expect(logs).toEqual(["[worker] started (no jobs registered yet)", "[worker] stopped"]);
  });
});
