import type { Block, InlineNode } from "@flolist/shared";
import {
  Checkbox,
  Chip,
  cn,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  SkeletonSquiggle,
  toast,
} from "@flolist/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { Editor } from "@tiptap/core";
import { MoreVertical, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { t } from "../../i18n/index.ts";
import { playCompleteSound } from "../../platform/index.ts";
import { useMe } from "../auth/hooks.ts";
import { blocksQuery } from "../editor/api.ts";
import { BlockEditor } from "../editor/BlockEditor.tsx";
import { EditorCommands } from "../editor/commands.ts";
import { focusFirstBlock, focusBlock } from "../editor/focus.ts";
import { InlineEditor } from "../editor/InlineEditor.tsx";
import { isMod } from "../editor/keys.ts";
import type { BlockStore } from "../editor/store.ts";
import { isDone, taskTitle } from "../editor/task-utils.ts";
import { parentBlockOf } from "../editor/tree.ts";
import { useBlockStore } from "../editor/use-block-store.ts";
import { listQuery } from "../lists/api.ts";
import { ListIcon } from "../lists/ListIcon.tsx";
import { ActivityLog } from "./ActivityLog.tsx";

export interface OpenTask {
  listId: string;
  taskId: string;
}

const titleEditorId = (blockId: string) => `details-title-${blockId}`;

/**
 * Task details (ui-design §5): close and ⋮ menu, a large checkbox and the title, the list
 * chip, the body (subtasks, text, media; the list's block editor rooted at the task), and the
 * activity log. It edits the same block store as the list beside it. The other property chips
 * arrive with their fields (M3.2, M7.3), the message composer with M7.3, and the rest of the ⋮
 * menu with the task actions (M3.3).
 */
export function TaskDetails({ task }: { task: OpenTask }) {
  const navigate = useNavigate();
  const { data: list } = useQuery(listQuery(task.listId));
  const { data: blocks } = useQuery(blocksQuery(task.listId));
  const block = blocks?.find((b) => b.taskId === task.taskId);
  const close = useCallback(() => {
    void navigate({ to: "/lists/$listId", params: { listId: task.listId } });
  }, [navigate, task.listId]);

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
        <Details key={block.id} block={block} list={list} close={close} />
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
  close,
}: {
  block: Block;
  list: { id: string; rootListId: string; title: string; emoji: string | null };
  close: () => void;
}) {
  const navigate = useNavigate();
  const me = useMe();
  const store = useBlockStore(list.id, list.rootListId, me.id);
  const [commands] = useState(() => new EditorCommands(store));
  const taskId = block.taskId ?? "";
  const { data: blocks } = useQuery(blocksQuery(list.id));
  const parent = blocks ? parentBlockOf(blocks, block) : undefined;
  const inline = "inline" in block.content ? block.content.inline : [];

  const openTask = useCallback(
    (b: Block) => {
      if (!b.taskId) return;
      void navigate({
        to: "/lists/$listId/tasks/$taskId",
        params: { listId: list.id, taskId: b.taskId },
      });
    },
    [navigate, list.id],
  );

  const onTitleKey = (event: KeyboardEvent, editor: Editor) => {
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
          <MenuContent align="end">
            <MenuItem
              icon={<Trash2 />}
              destructive
              onSelect={() => {
                deleteTask(store, block);
                close();
              }}
            >
              {t("tasks.details.delete")}
            </MenuItem>
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
        <ActivityLog taskId={taskId} />
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

/** Deletes the task's block (and so the task and its body) with an Undo toast. */
function deleteTask(store: BlockStore, block: Block): void {
  const inverse = store.apply([{ op: "delete", id: block.id }]);
  toast(t("tasks.details.deleted"), {
    action: {
      label: t("tasks.details.undo"),
      onAction: () => {
        store.apply(inverse);
      },
    },
  });
}
