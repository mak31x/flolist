import type { Block, Priority, TaskDue } from "@flolist/shared";
import {
  cn,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Pill,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@flolist/ui";
import { Calendar, Check, Tag } from "lucide-react";
import type { ReactNode } from "react";
import { t } from "../../i18n/index.ts";
import { focusBlock } from "../editor/focus.ts";
import { DatePicker } from "./DatePicker.tsx";
import { LabelChip } from "./LabelChip.tsx";
import { LabelPicker } from "./LabelPicker.tsx";
import { useDueLabel, useTaskLabels } from "./hooks.ts";
import { usePickerOpen } from "./picker-store.ts";
import { PRIORITY_MENU, priorityName, priorityOf } from "./priority.ts";
import { PriorityIcon } from "./PriorityIcon.tsx";

type Scope = "row" | "details";

interface PickerProps {
  blockId: string;
  scope: Scope;
  /** The editor to focus once the picker closes (the title the shortcut came from). */
  returnFocusTo?: string;
  trigger: ReactNode;
}

const restoreFocus = (id: string | undefined) => (e: Event) => {
  if (!id) return;
  e.preventDefault();
  focusBlock(id, "end");
};

export function DuePopover(
  props: PickerProps & { due: TaskDue | null; onChange: (due: TaskDue | null) => void },
) {
  const [open, setOpen] = usePickerOpen(props.blockId, props.scope, "due");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{props.trigger}</PopoverTrigger>
      <PopoverContent
        aria-label={t("due.picker")}
        onCloseAutoFocus={restoreFocus(props.returnFocusTo)}
      >
        <DatePicker
          value={props.due}
          onChange={props.onChange}
          onDone={() => {
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function PriorityMenu(
  props: PickerProps & { value: Priority; onChange: (value: Priority) => void },
) {
  const [open, setOpen] = usePickerOpen(props.blockId, props.scope, "priority");
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger asChild>{props.trigger}</MenuTrigger>
      <MenuContent align="start" onCloseAutoFocus={restoreFocus(props.returnFocusTo)}>
        {PRIORITY_MENU.map((level) => (
          <MenuItem
            key={level}
            icon={<PriorityIcon value={level} />}
            trailing={level === props.value ? <Check aria-hidden /> : undefined}
            onSelect={() => {
              props.onChange(level);
            }}
          >
            {priorityName(priorityOf(level))}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

export function LabelsPopover(
  props: PickerProps & {
    workspaceId: string;
    value: readonly string[];
    onChange: (ids: string[]) => void;
  },
) {
  const [open, setOpen] = usePickerOpen(props.blockId, props.scope, "labels");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{props.trigger}</PopoverTrigger>
      <PopoverContent
        aria-label={t("labels.chip")}
        onCloseAutoFocus={restoreFocus(props.returnFocusTo)}
      >
        <LabelPicker
          workspaceId={props.workspaceId}
          value={props.value}
          onChange={props.onChange}
        />
      </PopoverContent>
    </Popover>
  );
}

export interface TaskFieldsProps {
  block: Block;
  workspaceId: string;
  onFields: (fields: { due?: TaskDue | null; priority?: Priority; labelIds?: string[] }) => void;
  returnFocusTo?: string;
}

/** The details panel's property chips (ui-design §5): Due date, Priority, Labels. */
export function TaskPropertyChips({
  block,
  workspaceId,
  onFields,
  returnFocusTo,
}: TaskFieldsProps) {
  const task = block.task;
  const due = useDueLabel(task?.due ?? null, task?.completedAt != null);
  const labels = useTaskLabels(task?.labelIds ?? []);
  if (!task) return null;
  const common = {
    blockId: block.id,
    scope: "details" as const,
    ...(returnFocusTo ? { returnFocusTo } : {}),
  };
  return (
    <>
      <DuePopover
        {...common}
        due={task.due}
        onChange={(next) => {
          onFields({ due: next });
        }}
        trigger={
          <Pill
            icon={<Calendar />}
            active={task.due !== null}
            className={cn(due?.overdue && "text-accent")}
            aria-label={due ? t("due.label", { date: due.text }) : t("due.chip")}
          >
            {due?.text ?? t("due.chip")}
          </Pill>
        }
      />
      <PriorityMenu
        {...common}
        value={task.priority}
        onChange={(priority) => {
          onFields({ priority });
        }}
        trigger={
          <Pill icon={<PriorityIcon value={task.priority} />} active={task.priority > 0}>
            {task.priority > 0 ? priorityName(priorityOf(task.priority)) : t("priority.chip")}
          </Pill>
        }
      />
      <LabelsPopover
        {...common}
        workspaceId={workspaceId}
        value={task.labelIds}
        onChange={(labelIds) => {
          onFields({ labelIds });
        }}
        trigger={
          <Pill icon={<Tag />} active={labels.length > 0}>
            {labels.length > 0 ? labels.map((l) => l.name).join(", ") : t("labels.chip")}
          </Pill>
        }
      />
    </>
  );
}

const metaButton =
  "h-5 items-center gap-1 rounded-full px-1 text-meta text-text-muted outline-none hover:bg-chip focus-visible:ring-2 focus-visible:ring-focus-ring [&_svg]:size-3.5";

/**
 * Under a task row's title (ui-design §4): the meta line (due date, priority, labels) and,
 * while the title is being edited, icons to set the fields that are still empty.
 */
export function TaskMetaLine({ block, workspaceId, onFields }: TaskFieldsProps) {
  const task = block.task;
  const due = useDueLabel(task?.due ?? null, task?.completedAt != null);
  const labels = useTaskLabels(task?.labelIds ?? []);
  const [dueOpen] = usePickerOpen(block.id, "row", "due");
  const [priorityOpen] = usePickerOpen(block.id, "row", "priority");
  const [labelsOpen] = usePickerOpen(block.id, "row", "labels");
  if (!task) return null;
  const hasMeta = due !== null || task.priority > 0 || labels.length > 0;
  const anyOpen = dueOpen || priorityOpen || labelsOpen;
  const title = block.id;
  const common = { blockId: block.id, scope: "row" as const, returnFocusTo: title };
  // Empty fields show as icons only while editing (or while their picker is open). The display
  // class is picked, not stacked: `inline-flex` would win over `hidden` in the stylesheet.
  const shown = (empty: boolean) =>
    empty ? "hidden group-focus-within/block:inline-flex" : "inline-flex";

  return (
    <div
      className={cn(
        "-ml-1 flex-wrap items-center gap-1 print:hidden",
        hasMeta || anyOpen ? "flex" : "hidden group-focus-within/block:flex",
      )}
    >
      <DuePopover
        {...common}
        due={task.due}
        onChange={(next) => {
          onFields({ due: next });
        }}
        trigger={
          <button
            type="button"
            aria-label={
              due
                ? t(due.overdue ? "due.overdue" : "due.label", { date: due.text })
                : t("editor.task.dueDate", { title: "" }).trim()
            }
            className={cn(metaButton, due?.overdue && "text-accent", shown(!due && !dueOpen))}
          >
            <Calendar aria-hidden />
            {due && <span>{due.text}</span>}
          </button>
        }
      />
      <PriorityMenu
        {...common}
        value={task.priority}
        onChange={(priority) => {
          onFields({ priority });
        }}
        trigger={
          <button
            type="button"
            aria-label={
              task.priority > 0
                ? t("priority.label", { priority: priorityName(priorityOf(task.priority)) })
                : t("priority.chip")
            }
            className={cn(metaButton, shown(task.priority === 0 && !priorityOpen))}
          >
            <PriorityIcon value={task.priority} />
          </button>
        }
      />
      <LabelsPopover
        {...common}
        workspaceId={workspaceId}
        value={task.labelIds}
        onChange={(labelIds) => {
          onFields({ labelIds });
        }}
        trigger={
          <button
            type="button"
            aria-label={t("labels.chip")}
            className={cn(metaButton, "gap-1", shown(labels.length === 0 && !labelsOpen))}
          >
            {labels.length === 0 ? (
              <Tag aria-hidden />
            ) : (
              labels.map((l) => <LabelChip key={l.id} name={l.name} color={l.color} />)
            )}
          </button>
        }
      />
    </div>
  );
}
