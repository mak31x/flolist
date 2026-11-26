import type { Block } from "@flolist/shared";
import { Checkbox, cn, ProgressRing } from "@flolist/ui";
import { ArrowRight, ChevronRight } from "lucide-react";
import { t } from "../../i18n/index.ts";
import { isDone, taskTitle } from "./task-utils.ts";

/**
 * The parts of a task row around its title editor (ui-design §4). They're rendered inside the
 * same row layout as text blocks, so turning a paragraph into a task (or back) keeps the title
 * editor mounted and the caret where it was.
 */

/** The collapse chevron (when there are subtasks) and the checkbox. */
export function TaskMarker(props: {
  block: Block;
  hasSubtasks: boolean;
  collapsed: boolean;
  saved: boolean;
  onCollapse?: ((block: Block) => void) | undefined;
  onComplete: (block: Block, completed: boolean) => void;
}) {
  const { block } = props;
  const done = isDone(block);
  return (
    <span className="relative mr-2 flex h-6 shrink-0 items-center">
      {props.hasSubtasks && props.onCollapse && (
        <button
          type="button"
          aria-expanded={!props.collapsed}
          aria-label={t(props.collapsed ? "editor.task.expand" : "editor.task.collapse")}
          onClick={() => props.onCollapse?.(block)}
          className={cn(
            "absolute -left-5 flex size-4 items-center justify-center rounded text-text-subtle hover:text-text-muted print:hidden",
            "[&_svg]:size-3.5 [&_svg]:transition-transform [&_svg]:duration-(--motion-fast)",
            !props.collapsed && "[&_svg]:rotate-90",
          )}
        >
          <ChevronRight aria-hidden />
        </button>
      )}
      <Checkbox
        label={t(done ? "editor.task.reopen" : "editor.task.complete", { title: taskTitle(block) })}
        checked={done}
        disabled={!props.saved}
        onCheckedChange={(checked) => {
          props.onComplete(block, checked);
        }}
      />
    </span>
  );
}

/** Subtask progress and, on hover, the "open details" arrow. */
export function TaskTrailing(props: {
  block: Block;
  progress: { done: number; total: number };
  saved: boolean;
  onOpen?: ((block: Block) => void) | undefined;
}) {
  const { block, progress } = props;
  return (
    <>
      {progress.total > 0 && (
        <ProgressRing
          className="mt-[5px] ml-2 shrink-0"
          done={progress.done}
          total={progress.total}
          label={t("editor.task.progress", progress)}
        />
      )}
      {props.onOpen && props.saved && (
        <button
          type="button"
          aria-label={t("editor.task.open", { title: taskTitle(block) })}
          onClick={() => props.onOpen?.(block)}
          className={cn(
            "ml-2 flex size-6 shrink-0 items-center justify-center rounded-full bg-control-dark text-on-control-dark hover:opacity-90 print:hidden [&_svg]:size-3.5",
            "opacity-0 transition-opacity group-hover/block:opacity-100 group-focus-within/block:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
          )}
        >
          <ArrowRight aria-hidden />
        </button>
      )}
    </>
  );
}
