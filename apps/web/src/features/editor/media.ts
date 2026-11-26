import {
  DEFAULT_MAX_UPLOAD_MB,
  GENERIC_MIME,
  isInlineImage,
  positionBetween,
  uuidv7,
  type Block,
  type FileDto,
  type ListIndexItem,
  type MediaBlockType,
} from "@flolist/shared";
import { toast } from "@flolist/ui";
import { create } from "zustand";
import { t } from "../../i18n/index.ts";
import { uploadFile, UploadError } from "../files/upload.ts";
import { listKey, listsKey } from "../lists/api.ts";
import { upsertList } from "../lists/cache.ts";
import { pickFile } from "../../platform/index.ts";
import { blocksApi, blocksKey } from "./api.ts";
import { sortBlocks } from "./cache.ts";
import type { KeyContext } from "./keyboard.ts";
import type { LocalOp } from "./store.ts";

/**
 * Image, attachment and sublist blocks (lists-and-blocks.md → Block types). Media blocks are
 * created once their file is uploaded and checked, so every saved block points at a ready file;
 * until then the editor shows a local placeholder row with the upload's progress.
 */

export interface PendingUpload {
  id: string;
  listId: string;
  /** The row it shows under (null = the top of the list). */
  afterId: string | null;
  name: string;
  kind: MediaBlockType;
  progress: number;
}

interface PendingState {
  items: PendingUpload[];
  add: (item: PendingUpload) => void;
  update: (id: string, patch: Partial<PendingUpload>) => void;
  remove: (id: string) => void;
}

export const usePendingUploads = create<PendingState>((set) => ({
  items: [],
  add: (item) => {
    set((s) => ({ items: [...s.items, item] }));
  },
  update: (id, patch) => {
    set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  },
  remove: (id) => {
    set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
  },
}));

/** Inline images are the types the server checks by their bytes; anything else attaches. */
export const mediaKindOf = (file: File): MediaBlockType =>
  isInlineImage(file.type) ? "image" : "attachment";

export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

async function imageSize(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

const maxBytes = DEFAULT_MAX_UPLOAD_MB * 1024 * 1024;

const isEmptyParagraph = (block: Block) =>
  block.type === "paragraph" && "inline" in block.content && block.content.inline.length === 0;

/** Ops that delete `anchor` when it's an empty saved paragraph (the new block takes its place). */
function replaceOps(ctx: KeyContext, anchor: Block | null, replace: boolean): LocalOp[] {
  if (!replace || !anchor || !isEmptyParagraph(anchor) || !ctx.isSaved(anchor.id)) return [];
  const current = ctx.rows().find((b) => b.id === anchor.id);
  return current && isEmptyParagraph(current) ? [{ op: "delete", id: anchor.id }] : [];
}

/** A position right after `afterId` (or at the top), before whatever follows it now. */
function positionAfterRow(ctx: KeyContext, afterId: string | null): string {
  const rows = ctx.rows().filter((b) => ctx.isSaved(b.id));
  const index = afterId ? rows.findIndex((b) => b.id === afterId) : -1;
  const before = index >= 0 ? rows[index] : afterId ? rows.at(-1) : undefined;
  const next = index >= 0 ? rows[index + 1] : afterId ? undefined : rows[0];
  return positionBetween(before?.position ?? null, next?.position ?? null);
}

/**
 * Uploads `files` one after another and adds a block for each below `anchor`, in order. With
 * `replace`, an empty paragraph anchor (the one the slash menu was typed in) is removed.
 */
export async function insertFiles(
  ctx: KeyContext,
  anchor: Block | null,
  files: readonly File[],
  options: { replace?: boolean; kind?: MediaBlockType } = {},
): Promise<void> {
  let afterId = anchor?.id ?? null;
  let replace = options.replace ?? false;
  for (const file of files) {
    if (file.size > maxBytes) {
      toast(t("editor.upload.tooBig", { name: file.name, mb: DEFAULT_MAX_UPLOAD_MB }));
      continue;
    }
    // "Attachment" attaches anything, images included; otherwise images show inline.
    const kind = options.kind === "attachment" ? "attachment" : mediaKindOf(file);
    const pendingId = uuidv7();
    const pending = usePendingUploads.getState();
    pending.add({ id: pendingId, listId: ctx.listId, afterId, name: file.name, kind, progress: 0 });
    let uploaded: FileDto;
    try {
      const size = kind === "image" ? await imageSize(file) : null;
      uploaded = await uploadFile(file, {
        workspaceId: await ctx.workspaceId(),
        filename: file.name || (kind === "image" ? "image" : "file"),
        mime: file.type || GENERIC_MIME,
        ...(size ? size : {}),
        onProgress: (progress) => {
          usePendingUploads.getState().update(pendingId, { progress });
        },
      });
    } catch (err) {
      toast(err instanceof UploadError ? err.message : t("editor.upload.error"));
      continue;
    } finally {
      usePendingUploads.getState().remove(pendingId);
    }
    const id = uuidv7();
    ctx.commands.run([
      ...replaceOps(ctx, anchor, replace),
      {
        op: "upsert",
        id,
        fields: {
          type: kind,
          position: positionAfterRow(ctx, afterId),
          indent: 0,
          fileId: uploaded.id,
          content: {
            caption: "",
            file: {
              name: uploaded.filename,
              mime: uploaded.mime,
              sizeBytes: uploaded.sizeBytes,
              width: uploaded.width,
              height: uploaded.height,
            },
          },
        },
      },
    ]);
    replace = false;
    afterId = id;
  }
}

/**
 * Adds a sublist block below `anchor` (lists-and-blocks.md → Sublists). The child list is
 * created by the server with the block; it's placed in the list cache right away so the row
 * can show and rename it, and its title field gets focus.
 */
export function insertSublist(ctx: KeyContext, anchor: Block | null, replace: boolean): void {
  const id = uuidv7();
  const sublistId = uuidv7();
  const parent = ctx.qc.getQueryData<ListIndexItem | null>(listKey(ctx.listId));
  const now = new Date().toISOString();
  const list: ListIndexItem = {
    id: sublistId,
    workspaceId: parent?.workspaceId ?? "",
    rootListId: ctx.rootListId,
    parentListId: ctx.listId,
    parentBlockId: id,
    title: "",
    emoji: null,
    cover: null,
    createdBy: parent?.createdBy ?? "",
    version: 0,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: null,
  };
  ctx.qc.setQueryData<ListIndexItem[]>(listsKey, (old) => (old ? upsertList(old, list) : old));
  ctx.qc.setQueryData(listKey(sublistId), list);
  ctx.qc.setQueryData<Block[]>(blocksKey(sublistId), []);
  ctx.commands.run([
    ...replaceOps(ctx, anchor, replace),
    {
      op: "upsert",
      id,
      fields: {
        type: "sublist",
        position: positionAfterRow(ctx, anchor?.id ?? null),
        indent: 0,
        content: {},
        sublistId,
      },
    },
  ]);
  focusAtomic(id);
}

/** The slash menu (or Turn into) picked Image, Attachment or Sublist on `anchor`. */
export async function insertReference(
  ctx: KeyContext,
  anchor: Block,
  type: MediaBlockType | "sublist",
  replace: boolean,
): Promise<void> {
  if (type === "sublist") {
    insertSublist(ctx, anchor, replace);
    return;
  }
  const file = await pickFile(type === "image" ? IMAGE_ACCEPT : "");
  if (file) await insertFiles(ctx, anchor, [file], { replace, kind: type });
}

/** Focuses a non-text block's own control (divider, media, sublist title) once it's mounted. */
export function focusAtomic(id: string, tries = 5): void {
  const el = document.querySelector<HTMLElement>(`[data-block-id="${id}"] [data-atomic]`);
  if (el) {
    el.focus();
    return;
  }
  if (tries > 0)
    requestAnimationFrame(() => {
      focusAtomic(id, tries - 1);
    });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit] ?? "GB"}`;
}

/**
 * Moves blocks into another list (a drop on a sublist row or a sidebar list). Pending edits are
 * saved first; the blocks leave this list at once and come back if the move fails. History is
 * cleared, since its steps refer to blocks that now live elsewhere.
 */
export async function moveBlocksTo(
  ctx: KeyContext,
  ids: readonly string[],
  targetListId: string,
): Promise<void> {
  if (ids.length === 0 || targetListId === ctx.listId) return;
  const source = blocksKey(ctx.listId);
  try {
    await ctx.commands.flush();
    const before = ctx.qc.getQueryData<Block[]>(source);
    ctx.qc.setQueryData<Block[]>(source, (old) => old?.filter((b) => !ids.includes(b.id)));
    ctx.commands.clear();
    try {
      const result = await blocksApi.moveTo(ctx.listId, {
        clientMutationId: uuidv7(),
        ids: [...ids],
        targetListId,
      });
      ctx.qc.setQueryData<Block[]>(blocksKey(targetListId), (old) =>
        old ? sortBlocks([...old.filter((b) => !ids.includes(b.id)), ...result.blocks]) : old,
      );
      toast(t("editor.move.done", { count: ids.length }));
    } catch (err) {
      ctx.qc.setQueryData(source, before);
      throw err;
    }
  } catch {
    toast(t("editor.move.error"));
    void ctx.qc.invalidateQueries({ queryKey: source });
  }
}
