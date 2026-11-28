import { taskPageSchema, type InlineNode, type Task } from "@flolist/shared";
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
} from "@flolist/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { Editor } from "@tiptap/core";
import { Inbox, MoreVertical, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { t } from "../../i18n/index.ts";
import { api } from "../../lib/api.ts";
import { playCompleteSound } from "../../platform/index.ts";
import type { PanelTask } from "../../shell/panel-task.ts";
import { usePanelTaskNav } from "../../shell/panel-task.ts";
import { useMe } from "../auth/hooks.ts";
import { blocksKey } from "../editor/api.ts";
import { BlockEditor } from "../editor/BlockEditor.tsx";
import { focusBlock } from "../editor/focus.ts";
import { InlineEditor } from "../editor/InlineEditor.tsx";
import { mergeFetchedBlocks } from "../editor/store.ts";
import { TaskPropertyChips } from "../properties/TaskProperties.tsx";
import { ActivityLog } from "../tasks/ActivityLog.tsx";
import { TaskDetails } from "../tasks/TaskDetails.tsx";
import { taskQuery } from "./api.ts";
import { useDeleteViewTasks, useUpdateViewTask, type TaskChange } from "./mutations.ts";
import { taskAsBlock } from "./rows.ts";

/**
 * The right panel's task (ui-design §5), wherever it was opened: a task in a list shows the
 * list's details (it edits the list page's store); a task in no list (Inbox-only, M4.1) shows
 * the same layout over its task page.
 */
export function TaskPanel({ task }: { task: PanelTask }) {
  const nav = usePanelTaskNav(task);
  const { data, isError } = useQuery({ ...taskQuery(task.taskId), enabled: task.from !== "list" });
  const { close } = nav;
  useEffect(() => {
    if (isError) close();
  }, [isError, close]);

  if (task.from === "list") {
    return <TaskDetails task={{ listId: task.listId, taskId: task.taskId }} nav={nav} />;
  }
  if (data?.listId) {
    return <TaskDetails task={{ listId: data.listId, taskId: data.id }} nav={nav} />;
  }
  if (!data) {
    return (
      <div className="p-4">
        <IconButton label={t("tasks.details.close")} icon={<X />} variant="chip" onClick={close} />
        <SkeletonSquiggle className="mt-6" rows={4} />
      </div>
    );
  }
  return <InboxTaskDetails key={data.id} task={data} nav={nav} />;
}

const titleEditorId = (taskId: string) => `details-title-${taskId}`;
const TITLE_DELAY_MS = 500;

/** The top-level task whose page holds `taskId`'s body (fetching the page seeds its cache). */
function useTaskPageTop(taskId: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["taskPageTop", taskId],
    queryFn: async () => {
      const page = await api("GET", `/tasks/${taskId}/page`, taskPageSchema);
      if (!qc.getQueryData(blocksKey(page.taskId))) {
        qc.setQueryData(blocksKey(page.taskId), mergeFetchedBlocks(page.taskId, page.items));
      }
      return page.taskId;
    },
    staleTime: Infinity,
  });
}

function InboxTaskDetails({ task, nav }: { task: Task; nav: ReturnType<typeof usePanelTaskNav> }) {
  const me = useMe();
  const navigate = useNavigate();
  const update = useUpdateViewTask(me.id);
  const remove = useDeleteViewTasks();
  const { data: top } = useTaskPageTop(task.id);
  const { data: parent } = useQuery({
    ...taskQuery(task.parentTaskId ?? ""),
    enabled: task.parentTaskId !== null,
  });
  const block = taskAsBlock(task);
  const done = task.completedAt !== null;
  const change = useCallback(
    (c: TaskChange) => {
      update.mutate({ id: task.id, change: c });
    },
    [update, task.id],
  );

  const pending = useRef<InlineNode[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const inline = pending.current;
    pending.current = null;
    if (inline) change({ titleInline: inline });
  }, [change]);
  useEffect(() => flush, [flush]);

  const onTitleKey = (event: KeyboardEvent, editor: Editor) => {
    if (event.key === "Enter" && !event.shiftKey) {
      // The title is one line; Enter moves into the body.
      event.preventDefault();
      flush();
      const first = document.querySelector<HTMLElement>("[data-task-body] [data-block-id]");
      if (first?.dataset.blockId) focusBlock(first.dataset.blockId, "start");
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      flush();
      editor.commands.blur();
      nav.close();
      return true;
    }
    return false;
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) nav.close();
      }}
    >
      <div className="flex items-center justify-between p-4 pb-0">
        <IconButton
          label={t("tasks.details.close")}
          icon={<X />}
          variant="chip"
          shortcut="Escape"
          onClick={nav.close}
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
            <MenuItem
              icon={<Trash2 />}
              onSelect={() => {
                nav.close();
                void remove([task]);
              }}
            >
              {t("tasks.actions.delete")}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {parent && (
          <button
            type="button"
            onClick={() => {
              nav.open(parent.id, parent.listId);
            }}
            className="mt-4 block max-w-full truncate px-1 text-meta text-text-muted hover:text-text"
          >
            ↳ {parent.title || t("editor.task.untitled")}
          </button>
        )}
        <div className={cn("flex items-start gap-3 px-1", parent ? "mt-1" : "mt-5")}>
          <Checkbox
            size="lg"
            className="mt-1"
            label={t(done ? "editor.task.reopen" : "editor.task.complete", { title: task.title })}
            checked={done}
            onCheckedChange={(completed) => {
              change({ completed });
              if (completed && me.soundsEnabled) playCompleteSound();
            }}
          />
          <h2 className="min-w-0 flex-1">
            <InlineEditor
              blockId={titleEditorId(task.id)}
              inline={task.titleInline}
              placeholder={t("editor.task.untitled")}
              ariaLabel={t("tasks.details.title")}
              className={cn(
                "text-details-title font-bold",
                done ? "text-text-muted line-through" : "text-text",
              )}
              onChange={(next) => {
                pending.current = next;
                if (timer.current) clearTimeout(timer.current);
                timer.current = setTimeout(flush, TITLE_DELAY_MS);
              }}
              onKeyDown={onTitleKey}
              onRequestLink={() => undefined}
            />
          </h2>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5 px-1">
          <Chip
            icon={<Inbox />}
            onClick={() => {
              void navigate({ to: "/inbox" });
            }}
          >
            {t("taskViews.inbox")}
          </Chip>
          <TaskPropertyChips
            block={block}
            workspaceId={task.workspaceId}
            returnFocusTo={titleEditorId(task.id)}
            onFields={change}
          />
        </div>

        <div data-task-body className="mt-4 pl-[54px]">
          {top ? (
            <BlockEditor
              listId={top}
              rootListId={null}
              pageKind="task"
              workspaceId={task.workspaceId}
              root={{ type: "task", id: task.id }}
              placeholder={t("tasks.details.bodyPlaceholder")}
              onOpenTask={(b) => {
                if (b.taskId) nav.open(b.taskId, null);
              }}
              onExitTop={() => {
                focusBlock(titleEditorId(task.id), "end");
              }}
            />
          ) : (
            <SkeletonSquiggle rows={2} />
          )}
        </div>

        <hr className="my-2 border-border" />
        <ActivityLog taskId={task.id} version={task.version} />
      </div>
    </div>
  );
}
