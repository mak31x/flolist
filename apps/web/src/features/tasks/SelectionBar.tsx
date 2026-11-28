import type { Block } from "@flolist/shared";
import {
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@flolist/ui";
import {
  CalendarDays,
  CircleCheck,
  Copy,
  CopyPlus,
  FileText,
  FolderInput,
  Inbox,
  Link2,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { t } from "../../i18n/index.ts";
import { DatePicker } from "../properties/DatePicker.tsx";
import { LabelPicker } from "../properties/LabelPicker.tsx";
import { runTaskAction, toggleComplete, type TaskActionHost } from "./actions.tsx";
import { taskFieldOps } from "./task-ops.ts";

/** Labels every selected task has (what the picker shows as checked). */
function commonLabels(tasks: readonly Block[]): string[] {
  const [first, ...rest] = tasks;
  if (!first?.task) return [];
  return first.task.labelIds.filter((id) => rest.every((b) => b.task?.labelIds.includes(id)));
}

/**
 * The floating action bar of a multiselection (views.md → Multiselect): Move to list, Set due
 * date, Add to / Remove from Inbox (M4.1), Label, Duplicate, Copy, Mark complete, Delete.
 * Assign joins in M7.3. It lives inside the editor (fixed to the viewport), so focus moving into
 * it keeps the selection; its popovers carry `data-keep-selection` for the same reason.
 */
export function SelectionBar({
  selected,
  host,
  onClear,
}: {
  selected: readonly Block[];
  host: TaskActionHost;
  onClear: () => void;
}) {
  const tasks = selected.filter((b) => b.type === "task");
  const [dueOpen, setDueOpen] = useState(false);
  const allDone = tasks.length > 0 && tasks.every((b) => b.task?.completedAt != null);
  const labels = commonLabels(tasks);
  const inInbox = tasks.every((b) => b.taskId && host.inbox?.has(b.taskId));

  return (
    <div
      role="toolbar"
      aria-label={t("tasks.selection.bar")}
      data-selection-bar
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+84px)] left-1/2 z-30 flex max-w-[calc(100vw-16px)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-full bg-surface-raised px-2 py-1.5 shadow-popover md:bottom-6 print:hidden"
    >
      <span className="shrink-0 px-2 text-body font-semibold whitespace-nowrap text-text">
        {t("tasks.selection.count", { count: selected.length })}
      </span>
      <IconButton
        label={t("tasks.actions.move")}
        icon={<FolderInput />}
        onClick={() => {
          runTaskAction("move", selected, host);
        }}
      />
      {host.inbox && tasks.length > 0 && (
        <IconButton
          label={t(inInbox ? "tasks.actions.removeFromInbox" : "tasks.actions.addToInbox")}
          icon={<Inbox />}
          {...(inInbox ? {} : { shortcut: "Mod+Shift+I" })}
          onClick={() => {
            runTaskAction(inInbox ? "removeFromInbox" : "addToInbox", selected, host);
          }}
        />
      )}
      <Popover open={dueOpen} onOpenChange={setDueOpen}>
        <PopoverTrigger asChild>
          <IconButton
            label={t("tasks.actions.due")}
            icon={<CalendarDays />}
            disabled={tasks.length === 0}
            tooltip={false}
          />
        </PopoverTrigger>
        <PopoverContent aria-label={t("due.picker")} side="top" data-keep-selection>
          <DatePicker
            value={null}
            onChange={(due) => {
              host.commands.run(taskFieldOps(tasks, { due }));
            }}
            onDone={() => {
              setDueOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {host.workspaceId && (
        <Popover>
          <PopoverTrigger asChild>
            <IconButton
              label={t("tasks.actions.labels")}
              icon={<Tag />}
              disabled={tasks.length === 0}
              tooltip={false}
            />
          </PopoverTrigger>
          <PopoverContent aria-label={t("labels.chip")} side="top" data-keep-selection>
            <LabelPicker
              workspaceId={host.workspaceId}
              value={labels}
              onChange={(next) => {
                // Checking a label adds it to every task, unchecking removes it from all.
                const added = next.filter((id) => !labels.includes(id));
                const removed = labels.filter((id) => !next.includes(id));
                host.commands.run(
                  tasks.flatMap((b) => {
                    const own = b.task?.labelIds ?? [];
                    const ids = [
                      ...own.filter((id) => !removed.includes(id)),
                      ...added.filter((id) => !own.includes(id)),
                    ];
                    return taskFieldOps([b], { labelIds: ids });
                  }),
                );
              }}
            />
          </PopoverContent>
        </Popover>
      )}
      <IconButton
        label={t("tasks.actions.duplicate")}
        icon={<CopyPlus />}
        shortcut="Mod+Shift+D"
        onClick={() => {
          runTaskAction("duplicate", selected, host);
        }}
      />
      <Menu>
        <MenuTrigger asChild>
          <IconButton label={t("tasks.actions.copy")} icon={<Copy />} tooltip={false} />
        </MenuTrigger>
        <MenuContent side="top" data-keep-selection>
          <MenuItem
            icon={<Copy />}
            onSelect={() => {
              runTaskAction("copyText", selected, host);
            }}
          >
            {t("tasks.actions.copyText")}
          </MenuItem>
          <MenuItem
            icon={<FileText />}
            onSelect={() => {
              runTaskAction("copyMarkdown", selected, host);
            }}
          >
            {t("tasks.actions.copyMarkdown")}
          </MenuItem>
          <MenuItem
            icon={<Link2 />}
            disabled={tasks.length === 0}
            onSelect={() => {
              runTaskAction("copyLink", selected, host);
            }}
          >
            {t("tasks.actions.copyLinks")}
          </MenuItem>
        </MenuContent>
      </Menu>
      <IconButton
        label={t(allDone ? "tasks.actions.reopen" : "tasks.actions.complete")}
        icon={<CircleCheck />}
        shortcut="Mod+D"
        disabled={tasks.length === 0}
        onClick={() => {
          toggleComplete(host, tasks);
        }}
      />
      <IconButton
        label={t("tasks.actions.delete")}
        icon={<Trash2 />}
        shortcut="Mod+Backspace"
        onClick={() => {
          runTaskAction("delete", selected, host);
        }}
      />
      <IconButton
        label={t("tasks.selection.clear")}
        icon={<X />}
        shortcut="Escape"
        onClick={onClear}
      />
    </div>
  );
}
