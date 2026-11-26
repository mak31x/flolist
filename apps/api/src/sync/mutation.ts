import { appliedMutations, outbox, type Tx } from "@flolist/db";
import type { ChangeEvent } from "@flolist/shared";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { unauthenticated } from "../lib/errors.ts";
import { dbOf, type AppEnv, type AuthUser } from "../types.ts";

/** A change event without the fields `emit` fills in. */
export type ChangeInput = ChangeEvent extends infer E
  ? E extends ChangeEvent
    ? Omit<E, "type" | "clientMutationId">
    : never
  : never;

export interface MutationScope {
  tx: Tx;
  user: AuthUser;
  /** Queues a change event for `channels`; it's written in this transaction (outbox). */
  emit: (channels: readonly string[], change: ChangeInput) => Promise<void>;
}

export interface MutationResult {
  status: ContentfulStatusCode;
  body: unknown;
}

class AlreadyApplied extends Error {}

async function storedResult(c: Context<AppEnv>, userId: string, clientMutationId: string) {
  const [row] = await dbOf(c)
    .select({ result: appliedMutations.result })
    .from(appliedMutations)
    .where(
      and(
        eq(appliedMutations.userId, userId),
        eq(appliedMutations.clientMutationId, clientMutationId),
      ),
    )
    .limit(1);
  return row?.result ?? null;
}

/**
 * Runs one idempotent mutation (D-006, architecture.md → API conventions):
 * - a `clientMutationId` the caller already used replays the stored response, so a retry after
 *   a lost response never applies twice (and isn't re-authorized against the changed row);
 * - otherwise `fn` runs in a transaction together with its outbox rows and the
 *   `applied_mutations` record; any throw rolls all of it back;
 * - after commit the outbox is drained to WebSocket clients.
 *
 * `fn` must call `authorize()` itself (with `tx`).
 */
export async function runMutation(
  c: Context<AppEnv>,
  clientMutationId: string,
  fn: (scope: MutationScope) => Promise<MutationResult>,
): Promise<Response> {
  const user = c.get("user");
  if (!user) throw unauthenticated();

  const replay = await storedResult(c, user.id, clientMutationId);
  if (replay) return c.json(replay.body as object, replay.status as ContentfulStatusCode);

  let result: MutationResult;
  try {
    result = await dbOf(c).transaction(async (tx) => {
      const claimed = await tx
        .insert(appliedMutations)
        .values({ userId: user.id, clientMutationId })
        .onConflictDoNothing()
        .returning({ id: appliedMutations.clientMutationId });
      // A concurrent request with the same id committed first.
      if (claimed.length === 0) throw new AlreadyApplied();

      const emit: MutationScope["emit"] = async (channels, change) => {
        if (channels.length === 0) return;
        const event = { type: "change", clientMutationId, ...change };
        await tx.insert(outbox).values({ channels: [...new Set(channels)], event });
      };
      const out = await fn({ tx, user, emit });
      await tx
        .update(appliedMutations)
        .set({ result: { status: out.status, body: out.body } })
        .where(
          and(
            eq(appliedMutations.userId, user.id),
            eq(appliedMutations.clientMutationId, clientMutationId),
          ),
        );
      return out;
    });
  } catch (err) {
    if (!(err instanceof AlreadyApplied)) throw err;
    const stored = await storedResult(c, user.id, clientMutationId);
    if (!stored) throw new Error("mutation claimed but has no stored result", { cause: err });
    return c.json(stored.body as object, stored.status as ContentfulStatusCode);
  }

  c.get("afterMutation")?.();
  return c.json(result.body as object, result.status);
}
