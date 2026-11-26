import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  type SortingStrategy,
} from "@dnd-kit/sortable";
import {
  numberedLabels,
  positionAfter,
  positionAt,
  uuidv7,
  type Block,
  type InlineNode,
  type MediaContent,
  DEFAULT_LIST_VIEW_PREFS,
  type ListViewPrefs,
} from "@flolist/shared";
import { SkeletonSquiggle } from "@flolist/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMe } from "../auth/hooks.ts";
import { t } from "../../i18n/index.ts";
import { listQuery } from "../lists/api.ts";
import { isSorted, viewBlocks } from "../lists/list-view.ts";
import { blocksQuery } from "./api.ts";
import { insertFiles, moveBlocksTo, usePendingUploads } from "./media.ts";
import { PendingUploadRow } from "./MediaBlocks.tsx";
import { BlockRow } from "./BlockRow.tsx";
import { EditorCommands } from "./commands.ts";
import type { BlockAction } from "./BlockHandle.tsx";
import { readBlocks, writeBlocks } from "./clipboard.ts";
import {
  blockAction,
  deleteSelection,
  handleBlockKey,
  handleDividerKey,
  handleSelectionKey,
  pasteAfterSelection,
  pasteIntoBlock,
  selectedBlocks,
  type KeyContext,
} from "./keyboard.ts";
import { linkRequestFor, type LinkRequest } from "./link.ts";
import { LinkPrompt } from "./LinkPrompt.tsx";
import { filterSlashItems } from "./slash.ts";
import { SlashMenu } from "./SlashMenu.tsx";
import { useSlash } from "./use-slash.ts";
import { useBlockStore } from "./use-block-store.ts";

/** Where the pointer is now, for mouse and touch drags (keyboard drags only reorder). */
function pointerOf(event: DragMoveEvent | DragEndEvent): { x: number; y: number } | null {
  const start = event.activatorEvent;
  let x: number | undefined;
  let y: number | undefined;
  if (start instanceof MouseEvent) {
    x = start.clientX;
    y = start.clientY;
  } else if (typeof TouchEvent !== "undefined" && start instanceof TouchEvent) {
    x = start.touches[0]?.clientX;
    y = start.touches[0]?.clientY;
  }
  if (x === undefined || y === undefined) return null;
  return { x: x + event.delta.x, y: y + event.delta.y };
}

/**
 * A list that takes the dragged block: a sublist row whose middle the pointer is over (judged
 * by the row's resting place, since sorting may have shifted it), or a sidebar list.
 */
function dropTargetAt(
  event: DragMoveEvent | DragEndEvent,
  blocks: readonly Block[],
): HTMLElement | null {
  const point = pointerOf(event);
  if (!point) return null;
  const { over, active } = event;
  const overBlock = over && over.id !== active.id ? blocks.find((b) => b.id === over.id) : null;
  if (over && overBlock?.type === "sublist") {
    const band = over.rect.height / 4;
    if (point.y > over.rect.top + band && point.y < over.rect.top + over.rect.height - band) {
      return document.querySelector<HTMLElement>(
        `[data-block-id="${overBlock.id}"] [data-drop-list-id]`,
      );
    }
  }
  if (typeof document.elementsFromPoint !== "function") return null;
  for (const el of document.elementsFromPoint(point.x, point.y)) {
    if (el.closest("[data-block-editor]")) continue;
    const target = el.closest<HTMLElement>("[data-drop-list-id]");
    if (target) return target;
  }
  return null;
}

/** While a block hovers a sublist row, the rows hold still so the row stays under it. */
const holdStill: SortingStrategy = () => null;

let marked: HTMLElement | null = null;
function markDropTarget(el: HTMLElement | null) {
  if (marked === el) return;
  marked?.removeAttribute("data-drop-target");
  el?.setAttribute("data-drop-target", "");
  marked = el;
}

const docToInlineEmpty = (editor: Editor) => editor.state.doc.textContent.length === 0;

/** A not-yet-saved empty paragraph shown in an empty list; typing into it creates it. */
function phantomBlock(id: string, listId: string, rootListId: string): Block {
  const now = new Date(0).toISOString();
  return {
    id,
    containerType: "list",
    containerId: listId,
    rootListId,
    position: positionAfter(null),
    type: "paragraph",
    indent: 0,
    content: { inline: [] },
    fileId: null,
    sublistId: null,
    createdBy: null,
    version: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * The block editor of one list (D-007, lists-and-blocks.md → Editor behaviour): a column of
 * blocks, each with its own inline editor; the keyboard controller moves between them.
 */
export function BlockEditor({
  listId,
  rootListId,
  onExitTop,
  view = DEFAULT_LIST_VIEW_PREFS,
}: {
  listId: string;
  rootListId: string;
  /** The caller's filter/sort settings; a sorted view can't be reordered by drag. */
  view?: ListViewPrefs;
  /** ↑ from the first block (the page moves focus to the list title). */
  onExitTop: () => void;
}) {
  const me = useMe();
  const qc = useQueryClient();
  const { data: blocks } = useQuery(blocksQuery(listId));
  const pending = usePendingUploads((s) => s.items);
  const store = useBlockStore(listId, rootListId, me.id);
  const [phantomId, setPhantomId] = useState(uuidv7);
  const [link, setLink] = useState<LinkRequest | null>(null);

  if (blocks?.some((b) => b.id === phantomId)) {
    // The placeholder block became real; the next empty list gets a fresh one.
    setPhantomId(uuidv7());
  }

  const rows = useMemo(() => {
    if (!blocks) return null;
    return blocks.length > 0 ? blocks : [phantomBlock(phantomId, listId, rootListId)];
  }, [blocks, phantomId, listId, rootListId]);
  const numbers = useMemo(() => numberedLabels(rows ?? []), [rows]);
  const shown = useMemo(() => (rows ? viewBlocks(rows, view) : []), [rows, view]);
  const sorted = isSorted(view);

  const rowsRef = useRef<readonly Block[]>([]);
  const exitTop = useRef(onExitTop);
  useLayoutEffect(() => {
    rowsRef.current = rows ?? [];
    exitTop.current = onExitTop;
  });
  const ctxRef = useRef<KeyContext | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ anchor: string; head: string } | null>(null);
  const selectionRef = useRef(selection);
  const [slash, slashApi] = useSlash(() => {
    if (!ctxRef.current) throw new Error("editor context not ready");
    return ctxRef.current;
  });
  const [ctx] = useState<KeyContext>(() => ({
    listId,
    rootListId,
    qc,
    workspaceId: async () => {
      // A just-created list is cached before the server has named its workspace.
      const cached = qc.getQueryData<{ workspaceId: string } | null>(listQuery(listId).queryKey);
      if (cached?.workspaceId) return cached.workspaceId;
      await store.flush();
      const list = await qc.query({ ...listQuery(listId), staleTime: 0 });
      if (!list) throw new Error("list is gone");
      return list.workspaceId;
    },
    // The store's blocks are current the moment a command applies; rendered rows may lag a
    // frame. Only an empty list's placeholder comes from the rendered rows.
    rows: () => (store.blocks.length > 0 ? store.blocks : rowsRef.current),
    isSaved: (id) => store.get(id) !== undefined,
    commands: new EditorCommands(store),
    focusTitle: () => {
      exitTop.current();
    },
    slash: slashApi,
    selection: {
      get: () => selectionRef.current,
      set: (anchor, head) => {
        selectionRef.current = { anchor, head };
        setSelection(selectionRef.current);
        // Keys go to the container while blocks are selected.
        containerRef.current?.focus({ preventScroll: true });
        document.querySelector(`[data-block-id="${head}"]`)?.scrollIntoView({ block: "nearest" });
      },
      clear: () => {
        selectionRef.current = null;
        setSelection(null);
      },
    },
  }));
  useLayoutEffect(() => {
    ctxRef.current = ctx;
  }, [ctx]);
  const onKeyDown = useCallback(
    (block: Block, event: KeyboardEvent, editor: Editor) =>
      handleBlockKey(ctx, block, event, editor),
    [ctx],
  );
  const onDividerKeyDown = useCallback(
    (block: Block, event: KeyboardEvent) => handleDividerKey(ctx, block, event),
    [ctx],
  );

  const onChange = useCallback(
    (block: Block, inline: InlineNode[]) => {
      const known = store.get(block.id);
      // Typing goes through the command stack too, one undo step per burst in a block.
      ctx.commands.run(
        [
          {
            op: "upsert",
            id: block.id,
            fields: known
              ? { content: { inline } }
              : {
                  type: block.type,
                  position: block.position,
                  indent: block.indent,
                  content: { inline },
                },
          },
        ],
        { delay: "typing", coalesce: block.id },
      );
      slashApi.update(block.id);
    },
    [store, ctx, slashApi],
  );
  const onHistory = useCallback(
    (action: "undo" | "redo") => {
      if (action === "undo") ctx.commands.undo();
      else ctx.commands.redo();
    },
    [ctx],
  );
  const onFocus = useCallback(
    (block: Block) => {
      slashApi.focused(block.id);
      // Editing text ends a block selection.
      if (selectionRef.current) ctx.selection.clear();
    },
    [slashApi, ctx],
  );
  const onCaption = useCallback(
    (block: Block, caption: string) => {
      if (!("caption" in block.content)) return;
      ctx.commands.run([
        {
          op: "upsert",
          id: block.id,
          fields: { content: { ...(block.content as MediaContent), caption } },
        },
      ]);
    },
    [ctx],
  );
  const ready = useCallback(() => store.flush(), [store]);
  const onPaste = useCallback(
    (block: Block, event: ClipboardEvent, editor: Editor) => {
      if (!event.clipboardData) return false;
      const files = [...event.clipboardData.files];
      if (files.length > 0) {
        // Pasted files (screenshots, copied images) become blocks below this one.
        event.preventDefault();
        const empty = docToInlineEmpty(editor);
        void insertFiles(ctx, block, files, { replace: empty });
        return true;
      }
      const drafts = readBlocks(event.clipboardData);
      // One block pastes inline (Tiptap keeps marks and links); several become blocks.
      if (drafts.length < 2) return false;
      event.preventDefault();
      pasteIntoBlock(ctx, block, editor, drafts);
      return true;
    },
    [ctx],
  );
  const toDrafts = () =>
    selectedBlocks(ctx).map((b) => ({
      type: b.type,
      indent: b.indent,
      content: b.content,
      ...(b.fileId ? { fileId: b.fileId } : {}),
      ...(b.sublistId
        ? {
            title: qc.getQueryData<{ title: string } | null>(listQuery(b.sublistId).queryKey)
              ?.title,
          }
        : {}),
    }));
  const onAction = useCallback(
    (block: Block, action: BlockAction) => {
      blockAction(ctx, block, action);
    },
    [ctx],
  );
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [into, setInto] = useState(false);
  const onDragMove = useCallback(
    (event: DragMoveEvent) => {
      const target = dropTargetAt(event, store.blocks);
      markDropTarget(target);
      setInto(target?.closest("[data-block-editor]") != null);
    },
    [store],
  );
  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const target = dropTargetAt(event, store.blocks);
      markDropTarget(null);
      setInto(false);
      // Dropped on a sublist row or a sidebar list: the block moves into that list.
      if (target) {
        const listOf = target.dataset.dropListId;
        const moving = store.get(String(active.id));
        if (listOf && moving && listOf !== listId && moving.sublistId !== listOf) {
          void moveBlocksTo(ctx, [moving.id], listOf);
        }
        return;
      }
      if (!over || active.id === over.id) return;
      const current = store.blocks;
      const newIndex = current.findIndex((b) => b.id === over.id);
      if (newIndex === -1) return;
      const others = current.filter((b) => b.id !== active.id);
      ctx.commands.run([
        { op: "upsert", id: String(active.id), fields: { position: positionAt(others, newIndex) } },
      ]);
    },
    [ctx, store, listId],
  );
  const onRequestLink = useCallback((editor: Editor) => {
    setLink(linkRequestFor(editor));
  }, []);

  if (!rows) {
    return (
      <div className="py-2" aria-busy>
        <SkeletonSquiggle />
      </div>
    );
  }

  const selectedIds = new Set(selection ? selectedBlocks(ctx).map((b) => b.id) : []);
  const onlyEmpty =
    rows.length === 1 &&
    rows[0]?.type === "paragraph" &&
    "inline" in rows[0].content &&
    rows[0].content.inline.length === 0;
  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={t("editor.label")}
      data-block-editor
      tabIndex={-1}
      className="flex flex-col pb-24 outline-none"
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (handleSelectionKey(ctx, e.nativeEvent)) e.preventDefault();
      }}
      onBlur={(e) => {
        // Clicking elsewhere ends the selection (focus moving into a block is handled there).
        if (!e.currentTarget.contains(e.relatedTarget) && selectionRef.current)
          ctx.selection.clear();
      }}
      onCopy={(e) => {
        if (!selectionRef.current) return;
        e.preventDefault();
        writeBlocks(e.clipboardData, toDrafts());
      }}
      onCut={(e) => {
        if (!selectionRef.current) return;
        e.preventDefault();
        writeBlocks(e.clipboardData, toDrafts());
        deleteSelection(ctx);
      }}
      onPaste={(e) => {
        if (!selectionRef.current || e.target !== e.currentTarget) return;
        e.preventDefault();
        pasteAfterSelection(ctx, readBlocks(e.clipboardData));
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        const files = [...e.dataTransfer.files];
        if (files.length === 0) return;
        e.preventDefault();
        // Dropped files go below the block under the pointer (or at the end).
        const row = (e.target as HTMLElement).closest<HTMLElement>("[data-block-id]");
        const anchor =
          ctx.rows().find((b) => b.id === row?.dataset.blockId) ?? ctx.rows().at(-1) ?? null;
        void insertFiles(ctx, anchor, files);
      }}
    >
      <p aria-live="polite" className="sr-only">
        {selection ? t("editor.selection.count", { count: selectedBlocks(ctx).length }) : ""}
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          markDropTarget(null);
          setInto(false);
        }}
      >
        <SortableContext
          items={shown.map((b) => b.id)}
          strategy={into ? holdStill : verticalListSortingStrategy}
        >
          {view.tasksOnly && shown.length === 0 && (
            <p className="py-2 text-body text-text-muted">{t("lists.view.noTasks")}</p>
          )}
          {shown.map((block) => (
            <BlockRow
              key={block.id}
              block={block}
              saved={blocks?.length !== 0}
              draggable={!sorted}
              selected={selectedIds.has(block.id)}
              onPaste={onPaste}
              onHistory={onHistory}
              onAction={onAction}
              number={numbers.get(block.id)}
              placeholder={onlyEmpty ? t("editor.placeholder") : undefined}
              onChange={onChange}
              onKeyDown={onKeyDown}
              onDividerKeyDown={onDividerKeyDown}
              onRequestLink={onRequestLink}
              onFocus={onFocus}
              onCaption={onCaption}
              ready={ready}
            />
          ))}
        </SortableContext>
      </DndContext>
      {pending
        .filter((u) => u.listId === listId)
        .map((u) => (
          <PendingUploadRow key={u.id} upload={u} />
        ))}
      {slash && (
        <SlashMenu
          listId={`slash-${slash.blockId}`}
          items={filterSlashItems(slash.query, t)}
          active={slash.active}
          anchor={slash.anchor}
          onPick={slashApi.pick}
          onHover={slashApi.hover}
          onClose={slashApi.close}
        />
      )}
      {link && (
        <LinkPrompt
          request={link}
          onClose={() => {
            setLink(null);
          }}
        />
      )}
    </div>
  );
}
