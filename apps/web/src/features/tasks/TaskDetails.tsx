import type { Block, InlineNode } from "@flolist/shared";
import {
  Checkbox,
  Chip,
  cn,
  IconButton,
  Menu,
  MenuContent,
  MenuTrigger,
  SkeletonSquiggle,
} from "@flolist/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { Editor } from "@tiptap/core";
import { MoreVertical, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { t } from "../../i18n/index.ts";
import { playCompleteSound } from "../../platform/index.ts";
import { useMe } from "../auth/hooks.ts";
import { blocksQuery } from "../editor/api.ts";
import { BlockEditor } from "../editor/BlockEditor.tsx";
import { EditorCommands } from "../editor/commands.ts";
import { editorFor, focusFirstBlock, focusBlock } from "../editor/focus.ts";
import { handleSuggestionKey } from "../properties/suggestion.ts";
import { useDateContext } from "../properties/dates.ts";
import { handleTaskFieldKey } from "../properties/shortcuts.ts";
import { useTitleSuggestions } from "../properties/use-title-suggestions.ts";
import { InlineEditor } from "../editor/InlineEditor.tsx";
import { isMod } from "../editor/keys.ts";
import { isDone, taskTitle } from "../editor/task-utils.ts";
import { parentBlockOf } from "../editor/tree.ts";
import { useBlockStore } from "../editor/use-block-store.ts";
import { listQuery } from "../lists/api.ts";
import { ListIcon } from "../lists/ListIcon.tsx";
import { TaskPropertyChips } from "../properties/TaskProperties.tsx";
import { usePicker } from "../properties/picker-store.ts";
import type { TaskActionHost } from "./actions.tsx";
import { useInboxActions } from "../task-views/inbox-actions.ts";
import { ActivityLog } from "./ActivityLog.tsx";
import { TaskMenuItems } from "./TaskMenus.tsx";

export interface OpenTask {
  listId: string;
  taskId: string;
}

/** Where the panel goes on close, and how it opens another task (`usePanelTaskNav`). */
export interface DetailsNav {
  close: () => void;
  open: (taskId: string, listId?: string | null) => void;
}

const titleEditorId = (blockId: string) => `details-title-${blockId}`;

/**
 * Task details (ui-design §5): close and ⋮ menu, a large checkbox and the title, the list
 * chip, the body (subtasks, text, media; the list's block editor rooted at the task), and the
 * activity log. It edits the same block store as the list beside it. Due date, priority and
 * labels chips sit next to the list chip; the assignee chip and the message composer come with
 * M7.3. The ⋮ menu holds the task actions (M3.3).
 */
export function TaskDetails({ task, nav }: { task: OpenTask; nav: DetailsNav }) {
  const { data: list } = useQuery(listQuery(task.listId));
  const { data: blocks } = useQuery(blocksQuery(task.listId));
  const block = blocks?.find((b) => b.taskId === task.taskId);
  const { close } = nav;

  // Deleted here or elsewhere (or never in this list): back to the list.
  const gone = blocks !== undefined && !block;
  useEffect(() => {
    if (gone) close();
  }, [gone, close]);

  return (
    <div
      className="flex h-full flex-col"
      onKeyDown={(e) => {
        // Esc closes, unless a block selection or menu inside took it.
        if (e.key === "Escape" && !e.defaultPrevented) close();
      }}
    >
      {list && block ? (
        <Details key={block.id} block={block} list={list} nav={nav} />
      ) : (
        <div className="p-4">
          <IconButton
            label={t("tasks.details.close")}
            icon={<X />}
            variant="chip"
            onClick={close}
          />
          <SkeletonSquiggle className="mt-6" rows={4} />
        </div>
      )}
    </div>
  );
}

function Details({
  block,
  list,
  nav,
}: {
  block: Block;
  list: {
    id: string;
    rootListId: string;
    workspaceId: string;
    title: string;
    emoji: string | null;
  };
  nav: DetailsNav;
}) {
  const navigate = useNavigate();
  const { close } = nav;
  const me = useMe();
  const store = useBlockStore(list.id, list.rootListId, me.id);
  const [commands] = useState(() => new EditorCommands(store));
  const taskId = block.taskId ?? "";
  const { data: blocks } = useQuery(blocksQuery(list.id));
  const parent = blocks ? parentBlockOf(blocks, block) : undefined;
  const inline = "inline" in block.content ? block.content.inline : [];
  const qc = useQueryClient();
  const inbox = useInboxActions();
  const host = useMemo<TaskActionHost>(
    () => ({
      inbox,
      listId: list.id,
      workspaceId: list.workspaceId,
      qc,
      commands,
      all: () => store.blocks,
      soundsEnabled: me.soundsEnabled,
      openPicker: (b, kind) => {
        usePicker.getState().setOpen({ blockId: b.id, scope: "details", kind });
      },
      // Deleted or moved away: the panel closes (a moved task lives on in its new list).
      onGone: close,
    }),
    [inbox, list.id, list.workspaceId, qc, commands, store, me.soundsEnabled, close],
  );

  const openTask = useCallback(
    (b: Block) => {
      if (b.taskId) nav.open(b.taskId, list.id);
    },
    [nav, list.id],
  );

  const suggest = useTitleSuggestions();
  const dateCtx = useDateContext();
  const onTitleKey = (event: KeyboardEvent, editor: Editor) => {
    if (handleSuggestionKey(titleEditorId(block.id), event)) return true;
    if (
      handleTaskFieldKey(event, block, "details", {
        today: dateCtx.now.date,
        timeZone: dateCtx.timeZone,
        setFields: (fields) => {
          commands.run([{ op: "upsert", id: block.id, fields }]);
        },
      })
    ) {
      return true;
    }
    if (event.key === "Enter" && !event.shiftKey && !isMod(event)) {
      // The title is one line; Enter moves into the body.
      event.preventDefault();
      if (!focusFirstBlockIn("[data-task-body]")) focusBlock(titleEditorId(block.id), "end");
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      editor.commands.blur();
      close();
      return true;
    }
    return false;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between p-4 pb-0">
        <IconButton
          label={t("tasks.details.close")}
          icon={<X />}
          variant="chip"
          shortcut="Escape"
          onClick={close}
        />
        <Menu>
          <MenuTrigger asChild>
            <IconButton
              label={t("tasks.details.more")}
              icon={<MoreVertical />}
              variant="chip"
              tooltip={false}
            />
          </MenuTrigger>
          <MenuContent align="end" aria-label={t("tasks.actions.label")}>
            <TaskMenuItems targets={[block]} host={host} />
          </MenuContent>
        </Menu>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {parent && (
          <button
            type="button"
            onClick={() => {
              openTask(parent);
            }}
            className="mt-4 block max-w-full truncate px-1 text-meta text-text-muted hover:text-text"
          >
            ↳ {taskTitle(parent)}
          </button>
        )}
        <div className={cn("flex items-start gap-3 px-1", parent ? "mt-1" : "mt-5")}>
          <Checkbox
            size="lg"
            className="mt-1"
            label={t(isDone(block) ? "editor.task.reopen" : "editor.task.complete", {
              title: taskTitle(block),
            })}
            checked={isDone(block)}
            onCheckedChange={(completed) => {
              commands.run([{ op: "upsert", id: block.id, fields: { completed } }]);
              if (completed && me.soundsEnabled) playCompleteSound();
            }}
          />
          <h2 className="min-w-0 flex-1">
            <InlineEditor
              blockId={titleEditorId(block.id)}
              inline={inline}
              placeholder={t("editor.task.untitled")}
              ariaLabel={t("tasks.details.title")}
              className={cn(
                "text-details-title font-bold",
                isDone(block) ? "text-text-muted line-through" : "text-text",
              )}
              onChange={(next: InlineNode[]) => {
                commands.run(
                  [{ op: "upsert", id: block.id, fields: { content: { inline: next } } }],
                  {
                    delay: "typing",
                    coalesce: block.id,
                  },
                );
                const editor = editorFor(titleEditorId(block.id));
                if (editor) {
                  suggest(titleEditorId(block.id), editor, (due) => {
                    commands.run([{ op: "upsert", id: block.id, fields: { due } }]);
                  });
                }
              }}
              onKeyDown={onTitleKey}
              onRequestLink={() => undefined}
              onHistory={(action) => {
                if (action === "undo") commands.undo();
                else commands.redo();
              }}
            />
          </h2>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5 px-1">
          <Chip
            icon={<ListIcon emoji={list.emoji} />}
            onClick={() => {
              void navigate({ to: "/lists/$listId", params: { listId: list.id } });
            }}
          >
            {list.title || t("lists.untitled")}
          </Chip>
          {list.workspaceId && (
            <TaskPropertyChips
              block={block}
              workspaceId={list.workspaceId}
              returnFocusTo={titleEditorId(block.id)}
              onFields={(fields) => {
                commands.run([{ op: "upsert", id: block.id, fields }]);
              }}
            />
          )}
        </div>

        <div data-task-body className="mt-4 pl-[54px] md:pl-[54px]">
          <BlockEditor
            listId={list.id}
            rootListId={list.rootListId}
            root={{ type: "task", id: taskId }}
            placeholder={t("tasks.details.bodyPlaceholder")}
            onOpenTask={openTask}
            onExitTop={() => {
              focusBlock(titleEditorId(block.id), "end");
            }}
          />
        </div>

        <hr className="my-2 border-border" />
        <ActivityLog taskId={taskId} version={block.version} />
      </div>
    </div>
  );
}

/** Focuses the first block of the editor inside `selector`. */
function focusFirstBlockIn(selector: string): boolean {
  const scope = document.querySelector(selector);
  const first = scope?.querySelector<HTMLElement>("[data-block-id]");
  const id = first?.dataset.blockId;
  if (!id) return focusFirstBlock();
  focusBlock(id, "start");
  return true;
}
