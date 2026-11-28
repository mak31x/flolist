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
  positionsBetween,
  uuidv7,
  type Block,
  type BlockContainer,
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
import { handleSuggestionKey } from "../properties/suggestion.ts";
import { useDateContext } from "../properties/dates.ts";
import { labelsQuery } from "../properties/labels-api.ts";
import { handleTaskFieldKey } from "../properties/shortcuts.ts";
import { editorFor, focusBlock } from "./focus.ts";
import { useTitleSuggestions } from "../properties/use-title-suggestions.ts";
import {
  TaskFieldsContext,
  type TaskFieldsContextValue,
} from "../properties/task-fields-context.ts";
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
  selectedRows,
  type BlockSelection,
  type KeyContext,
} from "./keyboard.ts";
import { linkRequestFor, type LinkRequest } from "./link.ts";
import { LinkPrompt } from "./LinkPrompt.tsx";
import { filterSlashItems } from "./slash.ts";
import { SlashMenu } from "./SlashMenu.tsx";
import { useSlash } from "./use-slash.ts";
import { useBlockStore } from "./use-block-store.ts";
import { dropTargetAt, markDropTarget } from "./drop-targets.ts";
import { playCompleteSound } from "../../platform/index.ts";
import { usePicker } from "../properties/picker-store.ts";
import {
  deleteBlocks,
  duplicateBlocks,
  addToInbox,
  removeFromList,
  runTaskAction,
  toggleComplete,
  type TaskActionHost,
} from "../tasks/actions.tsx";
import { useInboxActions } from "../task-views/inbox-actions.ts";
import { SelectionBar } from "../tasks/SelectionBar.tsx";
import { topLevel } from "../tasks/task-ops.ts";
import { TaskActionsContext, type TaskActionsContextValue } from "../tasks/task-actions-context.ts";
import { isModKey } from "./keys.ts";
import {
  ancestorIn,
  childrenOf,
  containerOf,
  sameContainer,
  subtaskProgress,
  visibleTree,
  withDescendants,
} from "./tree.ts";

/** Where the pointer is now, for mouse and touch drags (keyboard drags only reorder). */
/** While a block hovers a sublist row, the rows hold still so the row stays under it. */
const holdStill: SortingStrategy = () => null;

/**
 * Task-action keys in a task title: Mod+Shift+D duplicates (Flolist add), Mod+Shift+I adds
 * to the Inbox, Mod+Shift+R removes from the list (keyboard-shortcuts.md → Task views).
 */
function duplicateKey(host: TaskActionHost | null, block: Block, event: KeyboardEvent): boolean {
  if (block.type !== "task" || !host) return false;
  if (isModKey(event, "d", true)) duplicateBlocks(host, [block]);
  else if (isModKey(event, "i", true)) addToInbox(host, [block]);
  else if (isModKey(event, "r", true) && host.listId) removeFromList(host, [block]);
  else return false;
  event.preventDefault();
  return true;
}

/**
 * Task-action keys while blocks are selected (keyboard-shortcuts.md → Task views): Mod+D
 * completes, Mod+Shift+D duplicates, Mod+Shift+I adds to the Inbox, Mod+Shift+R removes from
 * the list, Mod+Backspace/Delete deletes, Mod+Enter opens the task.
 */
function selectionActionKey(
  host: TaskActionHost,
  selected: readonly Block[],
  event: KeyboardEvent,
): boolean {
  if (isModKey(event, "d")) toggleComplete(host, selected);
  else if (isModKey(event, "d", true)) duplicateBlocks(host, selected);
  else if (isModKey(event, "i", true)) runTaskAction("addToInbox", selected, host);
  else if (isModKey(event, "r", true) && host.listId) removeFromList(host, selected);
  else if (isModKey(event, "backspace") || isModKey(event, "delete")) deleteBlocks(host, selected);
  else if (isModKey(event, "enter")) {
    const task = selected.find((b) => b.type === "task");
    if (!task) return false;
    host.openTask?.(task);
  } else return false;
  return true;
}

const docToInlineEmpty = (editor: Editor) => editor.state.doc.textContent.length === 0;

/** A not-yet-saved empty paragraph shown in an empty list; typing into it creates it. */
function phantomBlock(id: string, root: BlockContainer, rootListId: string | null): Block {
  const now = new Date(0).toISOString();
  return {
    id,
    containerType: root.type,
    containerId: root.id,
    rootListId,
    position: positionAfter(null),
    type: "paragraph",
    indent: 0,
    content: { inline: [] },
    fileId: null,
    sublistId: null,
    taskId: null,
    task: null,
    createdBy: null,
    version: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * The block editor of one page (D-007, lists-and-blocks.md → Editor behaviour): a column of
 * blocks, each with its own inline editor; the keyboard controller moves between them. A page
 * is a list, or (`pageKind: "task"`, M4.1) the body page of a task in no list, whose id is
 * then `listId` and whose workspace comes from `workspaceId`.
 */
export function BlockEditor({
  listId,
  rootListId,
  pageKind = "list",
  workspaceId: pageWorkspaceId,
  onExitTop,
  view = DEFAULT_LIST_VIEW_PREFS,
  root: rootProp,
  onOpenTask,
  placeholder,
}: {
  listId: string;
  rootListId: string | null;
  pageKind?: BlockContainer["type"];
  /** The workspace of a task page (list pages read it from the list). */
  workspaceId?: string;
  /** What this editor shows: the list (default), or one task's body (details panel). */
  root?: BlockContainer;
  /** Opens a task's details (the row's arrow, Mod+Enter). */
  onOpenTask?: (block: Block) => void;
  /** The empty editor's placeholder text. */
  placeholder?: string;
  /** The caller's filter/sort settings; a sorted view can't be reordered by drag. */
  view?: ListViewPrefs;
  /** ↑ from the first block (the page moves focus to the list title). */
  onExitTop: () => void;
}) {
  const me = useMe();
  const qc = useQueryClient();
  const { data: blocks } = useQuery(blocksQuery(listId, pageKind));
  const { data: labels } = useQuery(labelsQuery);
  const pending = usePendingUploads((s) => s.items);
  const store = useBlockStore(listId, rootListId, me.id, pageKind);
  const [phantomId, setPhantomId] = useState(uuidv7);
  const [link, setLink] = useState<LinkRequest | null>(null);

  const rootType = rootProp?.type ?? pageKind;
  const rootId = rootProp?.id ?? listId;
  const root = useMemo<BlockContainer>(() => ({ type: rootType, id: rootId }), [rootType, rootId]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const collapsedRef = useRef(collapsed);
  const viewRef = useRef(view);

  if (blocks?.some((b) => b.id === phantomId)) {
    // The placeholder block became real; the next empty list gets a fresh one.
    setPhantomId(uuidv7());
  }

  const tree = useMemo(
    () => (blocks ? visibleTree(blocks, root, collapsed) : null),
    [blocks, root, collapsed],
  );
  const empty = tree?.rows.length === 0;
  const rows = useMemo(() => {
    if (!tree) return null;
    return tree.rows.length > 0 ? tree.rows : [phantomBlock(phantomId, root, rootListId)];
  }, [tree, phantomId, root, rootListId]);
  const numbers = useMemo(() => numberedLabels(rows ?? []), [rows]);
  const shown = useMemo(
    () =>
      rows
        ? viewBlocks(rows, view, tree?.depth, me.id, (id) => labels?.find((l) => l.id === id)?.name)
        : [],
    [rows, view, tree, me.id, labels],
  );
  const sorted = isSorted(view);

  const rowsRef = useRef<readonly Block[]>([]);
  const exitTop = useRef(onExitTop);
  const openTaskRef = useRef(onOpenTask);
  useLayoutEffect(() => {
    rowsRef.current = rows ?? [];
    exitTop.current = onExitTop;
    openTaskRef.current = onOpenTask;
    collapsedRef.current = collapsed;
    viewRef.current = view;
  });
  const ctxRef = useRef<KeyContext | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<BlockSelection | null>(null);
  const selectionRef = useRef(selection);
  const [slash, slashApi] = useSlash(() => {
    if (!ctxRef.current) throw new Error("editor context not ready");
    return ctxRef.current;
  });
  // The store's blocks are current the moment a command applies; rendered rows may lag a
  // frame. Only an empty list's placeholder comes from the rendered rows.
  const rowsNow = () => {
    const tree = visibleTree(store.blocks, root, collapsedRef.current);
    if (tree.rows.length === 0) return rowsRef.current;
    // Rows hidden by the view's filters are skipped (arrows still follow stored order).
    return viewBlocks(tree.rows, { ...viewRef.current, sort: "manual" }, tree.depth);
  };
  const select = (next: BlockSelection) => {
    selectionRef.current = next;
    setSelection(next);
    // Keys go to the container while blocks are selected.
    containerRef.current?.focus({ preventScroll: true });
    document.querySelector(`[data-block-id="${next.head}"]`)?.scrollIntoView({ block: "nearest" });
  };
  const [ctx] = useState<KeyContext>(() => ({
    listId,
    rootListId,
    root,
    qc,
    workspaceId: async () => {
      if (pageWorkspaceId) return pageWorkspaceId;
      // A just-created list is cached before the server has named its workspace.
      const cached = qc.getQueryData<{ workspaceId: string } | null>(listQuery(listId).queryKey);
      if (cached?.workspaceId) return cached.workspaceId;
      await store.flush();
      const list = await qc.query({ ...listQuery(listId), staleTime: 0 });
      if (!list) throw new Error("list is gone");
      return list.workspaceId;
    },
    rows: rowsNow,
    all: () => store.blocks,
    openTask: (block) => {
      openTaskRef.current?.(block);
    },
    isSaved: (id) => store.get(id) !== undefined,
    commands: new EditorCommands(store),
    focusTitle: () => {
      exitTop.current();
    },
    slash: slashApi,
    selection: {
      get: () => selectionRef.current,
      set: (anchor, head) => {
        select({ anchor, head });
      },
      toggle: (id) => {
        const ids = selectedRows(selectionRef.current, rowsNow()).map((b) => b.id);
        const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
        if (next.length === 0) {
          selectionRef.current = null;
          setSelection(null);
          return;
        }
        select({ anchor: id, head: id, ids: next });
      },
      setIds: (ids) => {
        const [first] = ids;
        if (!first) return;
        select({ anchor: first, head: ids.at(-1) ?? first, ids });
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
  const suggest = useTitleSuggestions();
  const dateCtx = useDateContext();
  const dateRef = useRef({ today: dateCtx.now.date, timeZone: dateCtx.timeZone });
  useLayoutEffect(() => {
    dateRef.current = { today: dateCtx.now.date, timeZone: dateCtx.timeZone };
  });
  const hostRef = useRef<TaskActionHost | null>(null);
  const onKeyDown = useCallback(
    (block: Block, event: KeyboardEvent, editor: Editor) =>
      duplicateKey(hostRef.current, block, event) ||
      (block.type === "task" &&
        (handleSuggestionKey(block.id, event) ||
          handleTaskFieldKey(event, block, "row", {
            ...dateRef.current,
            setFields: (fields) => {
              ctx.commands.run([{ op: "upsert", id: block.id, fields }]);
            },
          }))) ||
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
                  ...(block.containerType === "task" ? { container: containerOf(block) } : {}),
                },
          },
        ],
        { delay: "typing", coalesce: block.id },
      );
      slashApi.update(block.id);
      const editor = block.type === "task" ? editorFor(block.id) : undefined;
      if (editor) {
        suggest(block.id, editor, (due) => {
          ctx.commands.run([{ op: "upsert", id: block.id, fields: { due } }]);
        });
      }
    },
    [store, ctx, slashApi, suggest],
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
      ...(b.task ? { completed: b.task.completedAt !== null } : {}),
      ...(b.sublistId
        ? {
            title: qc.getQueryData<{ title: string } | null>(listQuery(b.sublistId).queryKey)
              ?.title,
          }
        : {}),
    }));
  const onComplete = useCallback(
    (block: Block, completed: boolean) => {
      if (!store.get(block.id)) return;
      ctx.commands.run([{ op: "upsert", id: block.id, fields: { completed } }]);
      if (completed && me.soundsEnabled) playCompleteSound();
    },
    [ctx, store, me.soundsEnabled],
  );
  const { data: listRow } = useQuery({ ...listQuery(listId), enabled: pageKind === "list" });
  const workspaceOfList = pageWorkspaceId ?? listRow?.workspaceId;
  const taskFields = useMemo<TaskFieldsContextValue | null>(
    () =>
      workspaceOfList
        ? {
            workspaceId: workspaceOfList,
            setFields: (block, fields) => {
              if (!store.get(block.id)) return;
              ctx.commands.run([{ op: "upsert", id: block.id, fields }]);
            },
          }
        : null,
    [workspaceOfList, store, ctx],
  );
  const inbox = useInboxActions();
  const host = useMemo<TaskActionHost>(
    () => ({
      inbox,
      listId: pageKind === "list" ? listId : null,
      workspaceId: workspaceOfList,
      qc,
      commands: ctx.commands,
      all: () => store.blocks,
      soundsEnabled: me.soundsEnabled,
      openTask: (block) => {
        openTaskRef.current?.(block);
      },
      openPicker: (block, kind) => {
        ctx.selection.clear();
        usePicker.getState().setOpen({ blockId: block.id, scope: "row", kind });
      },
      onGone: () => {
        ctx.selection.clear();
      },
      onDuplicated: (ids) => {
        // A duplicated selection stays selected as its copies; one copy gets the caret.
        if (selectionRef.current) ctx.selection.setIds(ids);
        else if (ids[0]) focusBlock(ids[0], "end");
      },
    }),
    [inbox, listId, pageKind, workspaceOfList, qc, ctx, store, me.soundsEnabled],
  );
  useLayoutEffect(() => {
    hostRef.current = host;
  });
  const taskActions = useMemo<TaskActionsContextValue>(
    () => ({
      host,
      targetsFor: (block) => {
        const selected = selectionRef.current ? selectedBlocks(ctx) : [];
        return selected.some((b) => b.id === block.id) ? selected : [block];
      },
    }),
    [host, ctx],
  );
  const onSelectClick = useCallback(
    (block: Block, mode: "toggle" | "range") => {
      if (mode === "toggle") {
        ctx.selection.toggle(block.id);
        return;
      }
      // Shift-click: from the selection's anchor, else the block being edited, else this one.
      const focused =
        document.activeElement?.closest<HTMLElement>("[data-block-id]")?.dataset.blockId;
      ctx.selection.set(selectionRef.current?.anchor ?? focused ?? block.id, block.id);
    },
    [ctx],
  );
  const onCollapse = useCallback((block: Block) => {
    setCollapsed((old) => {
      const next = new Set(old);
      if (next.has(block.id)) next.delete(block.id);
      else next.add(block.id);
      return next;
    });
  }, []);
  const openTask = useCallback((block: Block) => {
    openTaskRef.current?.(block);
  }, []);
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
  /**
   * A dragged selection lands together where the dragged row would: tasks may change
   * container, other blocks only move when the target is their own container.
   */
  const moveGroup = useCallback(
    (group: readonly Block[], moving: Block, overRow: Block) => {
      const all = store.blocks;
      const reference =
        moving.type === "task" || sameContainer(containerOf(moving), overRow)
          ? overRow
          : ancestorIn(all, containerOf(moving), overRow);
      if (!reference) return;
      // Never into one of the moved tasks' own bodies.
      if (
        withDescendants(
          all,
          group.map((b) => b.id),
        ).has(reference.id)
      )
        return;
      const dest = containerOf(reference);
      const movable = group.filter((b) => b.type === "task" || sameContainer(dest, b));
      const ids = new Set(movable.map((b) => b.id));
      const siblings = childrenOf(all, dest).filter((b) => !ids.has(b.id));
      const visible = ctx.rows();
      const down =
        visible.findIndex((b) => b.id === moving.id) <
        visible.findIndex((b) => b.id === overRow.id);
      const index = siblings.findIndex((b) => b.id === reference.id) + (down ? 1 : 0);
      const positions = positionsBetween(
        siblings[index - 1]?.position ?? null,
        siblings[index]?.position ?? null,
        movable.length,
      );
      ctx.commands.run(
        movable.map((b, i) => ({
          op: "upsert",
          id: b.id,
          fields: {
            position: positions[i] ?? b.position,
            ...(sameContainer(dest, b) ? {} : { container: dest }),
          },
        })),
      );
    },
    [ctx, store],
  );
  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const target = dropTargetAt(event, store.blocks);
      markDropTarget(null);
      setInto(false);
      const all = store.blocks;
      const moving = store.get(String(active.id));
      // Dragging a selected row carries the whole selection (views.md → Multiselect).
      const selected = selectionRef.current ? selectedBlocks(ctx) : [];
      const group =
        moving && selected.some((b) => b.id === moving.id) ? topLevel(all, selected) : [];
      // Dropped on the sidebar's Inbox: the tasks are added to it (they stay in the list).
      if (target && target.dataset.dropInbox !== undefined) {
        const tasks = (group.length > 0 ? group : moving ? [moving] : []).flatMap((b) =>
          b.type === "task" && b.taskId ? [b.taskId] : [],
        );
        const host = hostRef.current;
        if (tasks.length > 0 && host?.inbox) {
          const { inbox } = host;
          void host.commands.flush().then(() => {
            inbox.add(tasks);
          });
        }
        return;
      }
      // Dropped on a sublist row or a sidebar list: the block moves into that list.
      if (target) {
        const listOf = target.dataset.dropListId;
        const ids = (group.length > 0 ? group : moving ? [moving] : [])
          .filter((b) => b.sublistId !== listOf)
          .map((b) => b.id);
        if (pageKind === "list" && listOf && listOf !== listId && ids.length > 0) {
          void moveBlocksTo(ctx, ids, listOf).then((moved) => {
            if (moved) ctx.selection.clear();
          });
        }
        return;
      }
      if (!over || active.id === over.id) return;
      const overRow = store.get(String(over.id));
      if (!moving || !overRow) return;
      if (group.length > 1) {
        moveGroup(group, moving, overRow);
        return;
      }
      // A task can land among another container's subtasks; other blocks stay in their own
      // container, next to the over row's ancestor there.
      const reference =
        moving.type === "task" || sameContainer(containerOf(moving), overRow)
          ? overRow
          : ancestorIn(all, containerOf(moving), overRow);
      if (!reference || reference.id === moving.id) return;
      const dest = containerOf(reference);
      const siblings = childrenOf(all, dest).filter((b) => b.id !== moving.id);
      const visible = ctx.rows();
      const down =
        visible.findIndex((b) => b.id === moving.id) < visible.findIndex((b) => b.id === over.id);
      const index = siblings.findIndex((b) => b.id === reference.id) + (down ? 1 : 0);
      const moved = !sameContainer(dest, moving);
      ctx.commands.run([
        {
          op: "upsert",
          id: moving.id,
          fields: { position: positionAt(siblings, index), ...(moved ? { container: dest } : {}) },
        },
      ]);
    },
    [ctx, store, listId, pageKind, moveGroup],
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
        // The action bar's buttons take the task-action keys and Esc too.
        const inBar =
          e.target instanceof Element && e.target.closest("[data-selection-bar]") !== null;
        if (e.target !== e.currentTarget && !inBar) return;
        if (selectionRef.current && selectionActionKey(host, selectedBlocks(ctx), e.nativeEvent)) {
          e.preventDefault();
          return;
        }
        if (inBar) {
          if (e.key === "Escape" && selectionRef.current) {
            e.preventDefault();
            const head = selectionRef.current.head;
            ctx.selection.clear();
            focusBlock(head, "end");
          }
          return;
        }
        if (handleSelectionKey(ctx, e.nativeEvent)) e.preventDefault();
      }}
      onBlur={(e) => {
        // Clicking elsewhere ends the selection (focus moving into a block is handled there);
        // the action bar's menus, pickers and dialogs keep it.
        const to = e.relatedTarget;
        const kept = to instanceof Element && to.closest("[data-keep-selection]") !== null;
        if (!e.currentTarget.contains(to) && !kept && selectionRef.current) ctx.selection.clear();
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
      {selection && rootType === "list" && (
        <SelectionBar
          selected={selectedBlocks(ctx)}
          host={host}
          onClear={() => {
            const head = selectionRef.current?.head;
            ctx.selection.clear();
            if (head) focusBlock(head, "end");
          }}
        />
      )}
      <TaskActionsContext.Provider value={taskActions}>
        <TaskFieldsContext.Provider value={taskFields}>
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
                  saved={!empty}
                  depth={tree?.depth.get(block.id)}
                  progress={
                    block.taskId && blocks ? subtaskProgress(blocks, block.taskId) : undefined
                  }
                  collapsed={collapsed.has(block.id)}
                  onCollapse={onCollapse}
                  onComplete={onComplete}
                  onOpenTask={onOpenTask ? openTask : undefined}
                  draggable={!sorted}
                  selected={selectedIds.has(block.id)}
                  selecting={selection !== null}
                  onSelectClick={onSelectClick}
                  onPaste={onPaste}
                  onHistory={onHistory}
                  onAction={onAction}
                  number={numbers.get(block.id)}
                  placeholder={onlyEmpty ? (placeholder ?? t("editor.placeholder")) : undefined}
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
        </TaskFieldsContext.Provider>
      </TaskActionsContext.Provider>
      {pending
        .filter((u) => u.listId === listId)
        .map((u) => (
          <PendingUploadRow key={u.id} upload={u} />
        ))}
      {slash && (
        <SlashMenu
          listId={`slash-${slash.blockId}`}
          items={filterSlashItems(slash.query, t, slash.inTask)}
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
