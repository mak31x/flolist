import {
  MAX_BATCH_OPS,
  resolveBlockShape,
  uuidv7,
  type Block,
  type BlockBatch,
  type BlockBatchResult,
  type BlockOp,
  type ChangeEvent,
} from "@flolist/shared";
import type { QueryClient } from "@tanstack/react-query";
import { ApiRequestError, type ApiOptions } from "../../lib/api.ts";
import { blocksApi, blocksKey } from "./api.ts";
import { removeBlock, sortBlocks, upsertBlock } from "./cache.ts";

/** The editable fields of a block. */
export type BlockFields = Partial<Pick<Block, "type" | "position" | "indent" | "content">>;

/** One local change. Moves are upserts of `position`/`indent`. */
export type LocalOp =
  { op: "upsert"; id: string; fields: BlockFields } | { op: "delete"; id: string };

/** How soon queued ops are sent: typing waits for a pause, structural commands go at once. */
export type FlushDelay = "typing" | "command";

type Queued = { op: "upsert"; fields: BlockFields; full: boolean } | { op: "delete" };

export interface BlockStoreOptions {
  qc: QueryClient;
  listId: string;
  rootListId: string;
  userId?: string | null;
  send?: (listId: string, input: BlockBatch, options?: ApiOptions) => Promise<BlockBatchResult>;
  /** Resolves when the list exists on the server (a just-created list may still be saving). */
  ready?: () => Promise<void>;
  /** Called once a batch is given up on (after retries); the store has rolled back. */
  onError?: (err: unknown) => void;
  typingDelayMs?: number;
  /** Waits before retrying a transient failure (same `clientMutationId`, so it's safe). */
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

const SHAPE_KEYS = ["type", "position", "indent", "content"] as const;
/** `keepalive` requests are capped at 64 KB by browsers. */
const KEEPALIVE_LIMIT = 60_000;

const fullFields = (b: Block): BlockFields => ({
  type: b.type,
  position: b.position,
  indent: b.indent,
  content: b.content,
});

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

function isTransient(err: unknown): boolean {
  if (err instanceof ApiRequestError) return err.status >= 500 || err.status === 429;
  // fetch rejects with a TypeError when the network is down.
  return err instanceof TypeError;
}

/**
 * The write side of one open list's blocks (CLAUDE.md → Optimistic UI, D-006).
 *
 * - `apply()` patches the query cache at once and queues the change. Repeated changes to one
 *   block merge, so a typing burst becomes one upsert of its latest content.
 * - Queued ops are sent as one batch (one transaction on the server) after a short delay; only
 *   one batch is in flight at a time. Transient failures retry with the same mutation id; any
 *   other failure drops the queue, refetches the server's state and calls `onError`.
 * - Rows from the server (batch answers and live events) are applied by version, with fields
 *   that are still queued locally laid over them, so a remote change never undoes unsent typing.
 * - New and restored blocks are sent with their whole shape; other upserts send only the
 *   changed fields (field-level last-write-wins).
 */
export class BlockStore {
  readonly listId: string;
  private readonly qc: QueryClient;
  private readonly rootListId: string;
  private readonly userId: string | null;
  private readonly send: NonNullable<BlockStoreOptions["send"]>;
  private readonly onError: (err: unknown) => void;
  private readonly ready: () => Promise<void>;
  private readonly typingDelayMs: number;
  private readonly retryDelaysMs: readonly number[];
  private readonly sleep: (ms: number) => Promise<void>;

  private queued = new Map<string, Queued>();
  /** The batch in flight, by block: a stale live upsert must not undo it, nor a refetch. */
  private inflightOps = new Map<string, Queued>();
  private inflight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dueAt = Infinity;
  private rollbackListeners = new Set<() => void>();

  constructor(options: BlockStoreOptions) {
    this.qc = options.qc;
    this.listId = options.listId;
    this.rootListId = options.rootListId;
    this.userId = options.userId ?? null;
    this.send = options.send ?? blocksApi.batch;
    this.onError = options.onError ?? (() => undefined);
    this.ready = options.ready ?? (() => Promise.resolve());
    this.typingDelayMs = options.typingDelayMs ?? 500;
    this.retryDelaysMs = options.retryDelaysMs ?? [500, 1500, 4000];
    this.sleep =
      options.sleep ??
      ((ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms);
        }));
  }

  get blocks(): Block[] {
    return this.qc.getQueryData<Block[]>(blocksKey(this.listId)) ?? [];
  }

  get(id: string): Block | undefined {
    return this.blocks.find((b) => b.id === id);
  }

  /** True while anything is queued or in flight. */
  get busy(): boolean {
    return this.queued.size > 0 || this.inflight !== null;
  }

  /** Runs `fn` after a rollback (the undo stack clears itself, since its inverses are stale). */
  onRollback(fn: () => void): () => void {
    this.rollbackListeners.add(fn);
    return () => this.rollbackListeners.delete(fn);
  }

  /**
   * Applies `ops` optimistically and queues them. Returns the ops that undo them, in order.
   * Throws (and changes nothing) if an op would make an invalid block.
   */
  apply(ops: readonly LocalOp[], delay: FlushDelay = "command"): LocalOp[] {
    let rows = this.blocks;
    const queued = new Map(this.queued);
    const inverse: LocalOp[] = [];
    const now = new Date().toISOString();

    for (const op of ops) {
      const prev = rows.find((b) => b.id === op.id);
      if (op.op === "delete") {
        if (!prev) continue;
        inverse.unshift({ op: "upsert", id: op.id, fields: fullFields(prev) });
        rows = removeBlock(rows, op.id);
        queued.set(op.id, { op: "delete" });
        continue;
      }
      const result = resolveBlockShape(prev ?? null, op.fields);
      const position = op.fields.position ?? prev?.position;
      if (!result.ok) throw new Error(result.error);
      if (!position) throw new Error("A new block needs a type and a position");
      const next: Block = prev
        ? { ...prev, ...result.shape, position }
        : {
            id: op.id,
            containerType: "list",
            containerId: this.listId,
            rootListId: this.rootListId,
            ...result.shape,
            position,
            createdBy: this.userId,
            version: 0,
            createdAt: now,
            updatedAt: now,
          };
      if (prev) {
        const undo: BlockFields = {};
        for (const key of SHAPE_KEYS) {
          if (!same(prev[key], next[key])) Object.assign(undo, { [key]: prev[key] });
        }
        if (Object.keys(undo).length === 0) continue;
        inverse.unshift({ op: "upsert", id: op.id, fields: undo });
      } else {
        inverse.unshift({ op: "delete", id: op.id });
      }
      rows = upsertBlock(rows, next);
      const q = queued.get(op.id);
      const full = !prev || q?.op === "delete" || (q?.op === "upsert" && q.full);
      const fields: BlockFields =
        q?.op === "upsert" ? { ...q.fields, ...op.fields } : { ...op.fields };
      // A type change can reset content and indent (and merging may have kept an older
      // content); send the resolved values so the server applies exactly what we show.
      if (fields.type !== undefined) {
        fields.content = next.content;
        fields.indent = next.indent;
      }
      queued.set(op.id, { op: "upsert", full, fields });
    }

    this.queued = queued;
    this.qc.setQueryData<Block[]>(blocksKey(this.listId), rows);
    if (this.queued.size > 0) this.schedule(delay === "typing" ? this.typingDelayMs : 0);
    return inverse;
  }

  /** Sends everything queued now (and waits for anything in flight first). */
  async flush(options: ApiOptions = {}): Promise<void> {
    this.clearTimer();
    while (this.inflight) await this.inflight;
    if (this.queued.size === 0) return;

    const ops: BlockOp[] = [];
    for (const [id, q] of this.queued) {
      if (q.op === "delete") {
        ops.push({ op: "delete", id });
        continue;
      }
      const row = this.get(id);
      const fields = q.full ? (row ? fullFields(row) : null) : q.fields;
      if (fields) ops.push({ op: "upsert", id, ...fields });
    }
    this.inflightOps = new Map(
      ops.map((o): [string, Queued] => {
        if (o.op !== "upsert") return [o.id, { op: "delete" }];
        const fields: BlockFields = {};
        for (const key of SHAPE_KEYS) {
          if (o[key] !== undefined) Object.assign(fields, { [key]: o[key] });
        }
        return [o.id, { op: "upsert", fields, full: false }];
      }),
    );
    this.queued = new Map();

    this.inflight = (async () => {
      await this.ready();
      for (let i = 0; i < ops.length; i += MAX_BATCH_OPS) {
        const ok = await this.sendBatch(ops.slice(i, i + MAX_BATCH_OPS), options);
        if (!ok) return;
      }
    })().finally(() => {
      this.inflight = null;
      this.inflightOps = new Map();
    });
    await this.inflight;
  }

  /** A block as the server now has it (a batch answer or a live upsert). */
  receive(server: Block): void {
    const q = this.queued.get(server.id);
    if (q?.op === "delete" || this.inflightOps.get(server.id)?.op === "delete") return;
    const rows = this.blocks;
    const current = rows.find((b) => b.id === server.id);
    if (current && server.version <= current.version) return;
    let next = server;
    if (q?.op === "upsert") {
      const local = q.full && current ? fullFields(current) : q.fields;
      const merged = resolveBlockShape(server, local);
      next = merged.ok
        ? { ...server, ...merged.shape, position: local.position ?? server.position }
        : server;
    }
    this.qc.setQueryData<Block[]>(blocksKey(this.listId), upsertBlock(rows, next));
  }

  /**
   * A fresh fetch of the list (reconnect, refocus): the server's rows, except where this tab
   * already holds a newer version, with every unsent and in-flight local change laid on top.
   * Without this a refetch would briefly (or, for a focused block, lastingly) undo typing.
   */
  mergeFetched(server: readonly Block[]): Block[] {
    const local = new Map(this.blocks.map((b) => [b.id, b]));
    const out = new Map<string, Block>();
    for (const row of server) {
      const mine = local.get(row.id);
      out.set(row.id, mine && mine.version > row.version ? mine : row);
    }
    // In-flight first, then queued (newer) changes.
    for (const pending of [this.inflightOps, this.queued]) {
      for (const [id, q] of pending) {
        if (q.op === "delete") {
          out.delete(id);
          continue;
        }
        const mine = local.get(id);
        const base = out.get(id) ?? mine;
        if (!base) continue;
        const fields = q.full && mine ? fullFields(mine) : q.fields;
        const merged = resolveBlockShape(base, fields);
        if (merged.ok)
          out.set(id, { ...base, ...merged.shape, position: fields.position ?? base.position });
      }
    }
    return sortBlocks([...out.values()]);
  }

  /** A live delete. A block with queued local changes stays (our upsert will restore it). */
  receiveDelete(id: string): void {
    if (this.queued.get(id)?.op === "upsert") return;
    this.qc.setQueryData<Block[]>(blocksKey(this.listId), (old) => old && removeBlock(old, id));
  }

  /** Stops the timer; the caller should `flush()` first if it wants pending changes saved. */
  dispose(): void {
    this.clearTimer();
  }

  private async sendBatch(ops: BlockOp[], options: ApiOptions): Promise<boolean> {
    const input: BlockBatch = { clientMutationId: uuidv7(), ops };
    const keepalive = options.keepalive === true && JSON.stringify(input).length < KEEPALIVE_LIMIT;
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await this.send(this.listId, input, keepalive ? { keepalive } : {});
        for (const block of result.blocks) this.receive(block);
        return true;
      } catch (err) {
        const wait = this.retryDelaysMs[attempt];
        if (isTransient(err) && wait !== undefined) {
          await this.sleep(wait);
          continue;
        }
        this.rollback(err);
        return false;
      }
    }
  }

  private rollback(err: unknown): void {
    this.queued = new Map();
    this.clearTimer();
    void this.qc.invalidateQueries({ queryKey: blocksKey(this.listId) });
    for (const fn of this.rollbackListeners) fn();
    this.onError(err);
  }

  private schedule(ms: number): void {
    const due = Date.now() + ms;
    if (this.timer && this.dueAt <= due) return;
    this.clearTimer();
    this.dueAt = due;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.dueAt = Infinity;
      void this.flush();
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.dueAt = Infinity;
  }
}

/** Stores of the lists open in this tab, so live events reach the one that owns the cache. */
const stores = new Map<string, BlockStore>();

/** Fetched blocks of a list, merged with the open store's pending changes (if it's open). */
export function mergeFetchedBlocks(listId: string, server: Block[]): Block[] {
  return stores.get(listId)?.mergeFetched(server) ?? server;
}

export function registerBlockStore(store: BlockStore): () => void {
  stores.set(store.listId, store);
  return () => {
    if (stores.get(store.listId) === store) stores.delete(store.listId);
  };
}

export type BlockChangeEvent = ChangeEvent & { entity: "block" };

/** Applies a live block event (called from `applyChange`). */
export function applyBlockChange(qc: QueryClient, event: BlockChangeEvent): void {
  if (event.op === "upsert") {
    const listId = event.data.containerId;
    const store = stores.get(listId);
    if (store) {
      store.receive(event.data);
      return;
    }
    qc.setQueryData<Block[]>(blocksKey(listId), (old) => {
      if (!old) return old;
      const current = old.find((b) => b.id === event.id);
      return current && event.version <= current.version ? old : upsertBlock(old, event.data);
    });
    return;
  }
  // Deletes don't name their list; drop the id from every cached list.
  for (const [key] of qc.getQueriesData<Block[]>({ queryKey: ["blocks"] })) {
    const listId = key[1];
    if (typeof listId !== "string") continue;
    const store = stores.get(listId);
    if (store) store.receiveDelete(event.id);
    else qc.setQueryData<Block[]>(key, (old) => old && removeBlock(old, event.id));
  }
}
