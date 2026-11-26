import { appliedMutations, outbox, type Db } from "@flolist/db";
import { and, asc, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import type { Logger } from "pino";
import type { Hub } from "./hub.ts";

export interface OutboxDrainer {
  /** Drain soon; calls while a drain runs coalesce into one more pass. */
  kick: () => void;
  /** Drain until empty and resolve (tests, shutdown). */
  drain: () => Promise<void>;
  /** Start the safety-net sweep and the hourly prune. */
  start: () => void;
  stop: () => void;
}

const BATCH = 500;
/** Dispatched events are kept briefly for debugging. */
const KEEP_DISPATCHED_MS = 60 * 60 * 1000;
/** `clientMutationId`s are unique per user for 24 h (architecture.md). */
const KEEP_MUTATIONS_MS = 24 * 60 * 60 * 1000;

/**
 * Moves committed outbox rows to the hub in id order and marks them dispatched. Mutations
 * kick it after commit; a periodic sweep catches anything a crash left behind. Delivery is
 * at-least-once: clients apply events idempotently (by version).
 */
export function createOutboxDrainer(
  db: Db,
  hub: Hub,
  logger: Logger,
  options: { sweepMs?: number; pruneMs?: number } = {},
): OutboxDrainer {
  let running: Promise<void> | null = null;
  /** Set when `drain()` is called during a pass, so the loop runs once more. */
  let again = false;
  const kickedMeanwhile = () => again;
  const timers: NodeJS.Timeout[] = [];

  async function drainOnce(): Promise<number> {
    return db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(outbox)
        .where(isNull(outbox.dispatchedAt))
        .orderBy(asc(outbox.id))
        .limit(BATCH)
        .for("update", { skipLocked: true });
      if (rows.length === 0) return 0;
      for (const row of rows) hub.publish(row.channels, row.event);
      await tx
        .update(outbox)
        .set({ dispatchedAt: new Date() })
        .where(
          inArray(
            outbox.id,
            rows.map((r) => r.id),
          ),
        );
      return rows.length;
    });
  }

  async function loop(): Promise<void> {
    do {
      again = false;
      try {
        while ((await drainOnce()) === BATCH) {
          // keep going while full batches come back
        }
      } catch (err) {
        logger.error({ err }, "outbox drain failed");
        return;
      }
    } while (kickedMeanwhile());
  }

  function drain(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = loop().finally(() => {
      running = null;
    });
    return running;
  }

  async function prune(): Promise<void> {
    const now = Date.now();
    try {
      await db
        .delete(outbox)
        .where(
          and(
            isNotNull(outbox.dispatchedAt),
            lt(outbox.dispatchedAt, new Date(now - KEEP_DISPATCHED_MS)),
          ),
        );
      await db
        .delete(appliedMutations)
        .where(lt(appliedMutations.createdAt, new Date(now - KEEP_MUTATIONS_MS)));
    } catch (err) {
      logger.error({ err }, "outbox prune failed");
    }
  }

  return {
    kick: () => {
      void drain();
    },
    drain,
    start: () => {
      const sweep = setInterval(() => void drain(), options.sweepMs ?? 5_000);
      const pruner = setInterval(() => void prune(), options.pruneMs ?? KEEP_DISPATCHED_MS);
      sweep.unref();
      pruner.unref();
      timers.push(sweep, pruner);
      void drain();
    },
    stop: () => {
      for (const t of timers.splice(0)) clearInterval(t);
    },
  };
}
