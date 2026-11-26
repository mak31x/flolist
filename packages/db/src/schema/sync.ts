import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import { createdAt } from "./columns.ts";

/**
 * Change events written in the same transaction as the mutation that caused them
 * (architecture.md → API conventions). The API drains undispatched rows to WebSocket
 * channels after commit, in id order.
 */
export const outbox = pgTable(
  "outbox",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    channels: text("channels").array().notNull(),
    event: jsonb("event").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  },
  (t) => [
    index("outbox_pending_idx")
      .on(t.id)
      .where(sql`${t.dispatchedAt} is null`),
  ],
);

/**
 * One row per applied `clientMutationId` (D-006), so a retried request returns the stored
 * response instead of applying twice. Rows older than 24 h are pruned.
 */
export const appliedMutations = pgTable(
  "applied_mutations",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clientMutationId: uuid("client_mutation_id").notNull(),
    /** `{ status, body }` of the original response; null while the mutation runs. */
    result: jsonb("result").$type<{ status: number; body: unknown }>(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.clientMutationId] }),
    index("applied_mutations_created_at_idx").on(t.createdAt),
  ],
);
