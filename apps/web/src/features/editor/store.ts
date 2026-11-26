import {
  MAX_BATCH_OPS,
  resolveBlockShape,
  uuidv7,
  type Block,
  type BlockBatch,
  type BlockBatchResult,
  type BlockContainer,
  type BlockOp,
  type ChangeEvent,
} from "@flolist/shared";
import type { QueryClient } from "@tanstack/react-query";
import { ApiRequestError, type ApiOptions } from "../../lib/api.ts";
import { blocksApi, blocksKey } from "./api.ts";
import { removeBlock, sortBlocks, upsertBlock } from "./cache.ts";

/**
 * The editable fields of a block. `fileId` belongs to media blocks; `sublistId` is set once,
 * when a sublist block is created (the server creates the child list with it). Task blocks have
 * `taskId` (made here when a block becomes a task) and `completed`; `container` puts a block in
 * a task's body (subtasks) or back in the list.
 */
export type BlockFields = Partial<
  Pick<Block, "type" | "position" | "indent" | "content" | "fileId" | "sublistId" | "taskId">
> & { completed?: boolean; container?: BlockContainer };

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

/** Fields an undo step restores (and that a local change lays over a server row). */
const UNDO_KEYS = [
  "type",
  "position",
  "indent",
  "content",
  "fileId",
  "taskId",
  "completed",
  "container",
] as const;
/** `keepalive` requests are capped at 64 KB by browsers. */
const KEEPALIVE_LIMIT = 60_000;

const containerOf = (b: Block): BlockContainer => ({ type: b.containerType, id: b.containerId });

/** Every field of a block, as `apply` takes them. */
const fullFields = (b: Block): BlockFields => ({
  type: b.type,
  position: b.position,
  indent: b.indent,
  content: b.content,
  ...(b.containerType === "task" ? { container: containerOf(b) } : {}),
  ...(b.fileId ? { fileId: b.fileId } : {}),
  ...(b.sublistId ? { sublistId: b.sublistId } : {}),
  ...(b.taskId ? { taskId: b.taskId } : {}),
  ...(b.task ? { completed: b.task.completedAt !== null } : {}),
});

/** One field's value on a block (undefined when it doesn't apply). */
function fieldOf(b: Block, key: (typeof UNDO_KEYS)[number]): unknown {
  if (key === "container") return containerOf(b);
  if (key === "completed") return b.task ? b.task.completedAt !== null : undefined;
  if (key === "taskId" || key === "fileId") return b[key] ?? undefined;
  return b[key];
}

/**
 * `fields` laid over `base` (a cached or server row): the shape rule, then position,
 * container, file and task. Throws when the result isn't a valid block.
 */
function overlay(
  base: Block,
  fields: BlockFields,
  userId: string | null,
  now: string,
  fresh = false,
): Block {
  // A new block's shape comes from the fields alone (the base is only a template).
  const result = resolveBlockShape(fresh ? null : base, fields);
  if (!result.ok) throw new Error(result.error);
  const isTask = result.shape.type === "task";
  const taskId = isTask ? (fields.taskId ?? base.taskId) : null;
  if (isTask && !taskId) throw new Error("A task block needs a task id");
  const completed = fields.completed ?? (base.task ? base.task.completedAt !== null : false);
  const unchanged = base.task && fields.completed === undefined ? base.task : null;
  return {
    ...base,
    ...result.shape,
    position: fields.position ?? base.position,
    containerType: fields.container?.type ?? base.containerType,
    containerId: fields.container?.id ?? base.containerId,
    fileId: fields.fileId ?? base.fileId,
    taskId,
    task: isTask
      ? (unchanged ?? {
          completedAt: completed ? now : null,
          completedBy: completed ? userId : null,
        })
      : null,
  };
}

/** A queued upsert as the batch API takes it (`sublistId` → `sublist`, task fields → `task`). */
function upsertOp(id: string, fields: BlockFields): BlockOp {
  const { sublistId, fileId, taskId, completed, ...rest } = fields;
  const task = {
    ...(taskId ? { id: taskId } : {}),
    ...(completed !== undefined ? { completed } : {}),
  };
  return {
    op: "upsert",
    id,
    ...rest,
    ...(fileId ? { fileId } : {}),
    ...(sublistId ? { sublist: { id: sublistId, title: "" } } : {}),
    ...(Object.keys(task).length > 0 ? { task } : {}),
  };
}

/** `overlay`, or the base unchanged when the local fields no longer fit it. */
function tryOverlay(base: Block, fields: BlockFields, userId: string | null): Block {
  try {
    return overlay(base, fields, userId, new Date().toISOString());
  } catch {
    return base;
  }
}

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
      const fields: BlockFields = { ...op.fields };
      const type = fields.type ?? prev?.type;
      // A block that becomes a task gets its task id here (undo hands the same one back).
      if (type === "task" && !fields.taskId && !prev?.taskId) fields.taskId = uuidv7();
      const position = fields.position ?? prev?.position;
      if (!type || !position) throw new Error("A new block needs a type and a position");
      const base: Block = prev ?? {
        id: op.id,
        containerType: "list",
        containerId: this.listId,
        rootListId: this.rootListId,
        type,
        position,
        indent: 0,
        content: {},
        fileId: null,
        sublistId: fields.sublistId ?? null,
        taskId: null,
        task: null,
        createdBy: this.userId,
        version: 0,
        createdAt: now,
        updatedAt: now,
      };
      const next = overlay(base, fields, this.userId, now, !prev);
      if (prev) {
        const undo: BlockFields = {};
        for (const key of UNDO_KEYS) {
          const before = fieldOf(prev, key);
          if (!same(before, fieldOf(next, key)) && before !== undefined) {
            Object.assign(undo, { [key]: before });
          }
        }
        if (Object.keys(undo).length === 0) continue;
        inverse.unshift({ op: "upsert", id: op.id, fields: undo });
      } else {
        inverse.unshift({ op: "delete", id: op.id });
      }
      rows = upsertBlock(rows, next);
      const q = queued.get(op.id);
      const full = !prev || q?.op === "delete" || (q?.op === "upsert" && q.full);
      const merged: BlockFields = q?.op === "upsert" ? { ...q.fields, ...fields } : fields;
      // A type change can reset content and indent (and merging may have kept an older
      // content); send the resolved values so the server applies exactly what we show.
      if (merged.type !== undefined) {
        merged.content = next.content;
        merged.indent = next.indent;
        if (next.taskId) merged.taskId = next.taskId;
      }
      queued.set(op.id, { op: "upsert", full, fields: merged });
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
    const inflight = new Map<string, Queued>();
    for (const [id, q] of this.queued) {
      if (q.op === "delete") {
        ops.push({ op: "delete", id });
        inflight.set(id, q);
        continue;
      }
      const row = this.get(id);
      const fields = q.full ? (row ? fullFields(row) : null) : q.fields;
      if (!fields) continue;
      ops.push(upsertOp(id, fields));
      inflight.set(id, { op: "upsert", fields, full: false });
    }
    this.inflightOps = inflight;
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
      next = tryOverlay(server, local, this.userId);
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
        out.set(id, tryOverlay(base, fields, this.userId));
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
/**
 * The list page whose cache holds `block`: its list, or for a task body the page that holds
 * the task's block (or the block itself, before a move). Null when no open page has it.
 */
function pageOf(qc: QueryClient, block: Block): string | null {
  if (block.containerType === "list") return block.containerId;
  for (const [key, rows] of qc.getQueriesData<Block[]>({ queryKey: ["blocks"] })) {
    const listId = key[1];
    if (typeof listId !== "string" || !rows) continue;
    if (rows.some((b) => b.taskId === block.containerId || b.id === block.id)) return listId;
  }
  return null;
}

export function applyBlockChange(qc: QueryClient, event: BlockChangeEvent): void {
  if (event.op === "upsert") {
    const listId = pageOf(qc, event.data);
    if (!listId) return;
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
