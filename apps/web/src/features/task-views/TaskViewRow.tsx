import type { InlineNode } from "@flolist/shared";
import { cn } from "@flolist/ui";
import type { Editor } from "@tiptap/core";
import { memo, useCallback, useEffect, useRef, type ReactNode } from "react";
import { t } from "../../i18n/index.ts";
import { InlineEditor } from "../editor/InlineEditor.tsx";
import { isModKey } from "../editor/keys.ts";
import { TaskMarker, TaskTrailing } from "../editor/TaskRow.tsx";
import { TaskMetaLine } from "../properties/TaskProperties.tsx";
import type { TaskChange } from "./mutations.ts";
import type { ViewRow } from "./rows.ts";

const INDENT_PX = 24;
const TITLE_DELAY_MS = 500;

export interface TaskViewRowProps {
  row: ViewRow;
  /** The workspace whose labels the pickers offer. */
  workspaceId: string;
  /** Muted context after the meta line (the task's list in Today) `[assumption]`. */
  context?: ReactNode | undefined;
  collapsed?: boolean | undefined;
  selected?: boolean | undefined;
  onCollapse?: ((taskId: string) => void) | undefined;
  onChange: (taskId: string, change: TaskChange) => void;
  onOpen: (taskId: string) => void;
  /** Enter at the end of the title: a new task below. */
  onEnter?: ((taskId: string) => void) | undefined;
  /** ↑/↓ at the title's first/last line. */
  onArrow?: ((taskId: string, direction: -1 | 1) => void) | undefined;
  /** Mod+D on the row. */
  onToggle?: ((taskId: string) => void) | undefined;
  /** Extra props for the row element (selection gestures, drag handle). */
  rowProps?:
    (React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }) | undefined;
  dragHandle?: ReactNode | undefined;
  style?: React.CSSProperties | undefined;
}

/**
 * One task row in a cross-list view (Inbox, Today): the list row's parts (checkbox, title
 * editor, meta line, progress and open arrow) around a `Task` instead of a block. The title
 * saves after a typing pause and when it loses focus.
 */
export const TaskViewRow = memo(function TaskViewRow(props: TaskViewRowProps) {
  const { row } = props;
  const { task, block } = row;
  const pending = useRef<InlineNode[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  // Only refs inside, so one function serves every render (and the unmount below).
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const inline = pending.current;
    pending.current = null;
    if (inline) latest.current.onChange(latest.current.row.task.id, { titleInline: inline });
  }, []);
  // Unsaved typing is sent when the row goes away (navigation, the task leaving the view).
  useEffect(() => flush, [flush]);

  const onKeyDown = (event: KeyboardEvent, editor: Editor): boolean => {
    const p = latest.current;
    if (isModKey(event, "d")) {
      event.preventDefault();
      p.onToggle?.(task.id);
      return true;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      flush();
      p.onOpen(task.id);
      return true;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      flush();
      p.onEnter?.(task.id);
      return true;
    }
    if (event.key === "Escape") {
      flush();
      editor.view.dom.blur();
      return true;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const { from, to } = editor.state.selection;
      const atEdge = event.key === "ArrowUp" ? from <= 1 : to >= editor.state.doc.content.size - 1;
      if (!atEdge || !p.onArrow) return false;
      event.preventDefault();
      flush();
      p.onArrow(task.id, event.key === "ArrowUp" ? -1 : 1);
      return true;
    }
    return false;
  };

  const done = task.completedAt !== null;
  return (
    <div
      {...props.rowProps}
      data-task-row={task.id}
      data-selected={props.selected || undefined}
      style={{ ...props.style, ...(row.depth ? { marginLeft: row.depth * INDENT_PX } : {}) }}
      className={cn(
        "group/block relative rounded-md",
        props.selected && "bg-surface-selected",
        props.rowProps?.className,
      )}
    >
      {props.dragHandle}
      <div className="flex py-[3px]">
        <TaskMarker
          block={block}
          hasSubtasks={row.progress.total > 0}
          collapsed={props.collapsed ?? false}
          saved
          onCollapse={props.onCollapse ? () => props.onCollapse?.(task.id) : undefined}
          onComplete={(_b, completed) => {
            props.onChange(task.id, { completed });
          }}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <InlineEditor
            blockId={task.id}
            inline={task.titleInline}
            placeholder={t("editor.task.placeholder")}
            ariaLabel={t("taskViews.title")}
            className={cn(
              "text-body text-text transition-colors duration-(--motion-fast)",
              done && "text-text-muted line-through",
            )}
            onChange={(inline) => {
              pending.current = inline;
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(flush, TITLE_DELAY_MS);
            }}
            onKeyDown={onKeyDown}
            onRequestLink={() => undefined}
            onFocus={() => undefined}
          />
          <div className="flex min-w-0 items-center gap-2">
            <TaskMetaLine
              block={block}
              workspaceId={props.workspaceId}
              onFields={(fields) => {
                props.onChange(task.id, fields);
              }}
            />
            {props.context && (
              <span className="truncate text-meta text-text-subtle">{props.context}</span>
            )}
          </div>
        </div>
        <TaskTrailing
          block={block}
          progress={row.progress}
          saved
          onOpen={() => {
            flush();
            props.onOpen(task.id);
          }}
        />
      </div>
    </div>
  );
});
