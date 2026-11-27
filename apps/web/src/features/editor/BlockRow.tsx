import type { Block, InlineNode } from "@flolist/shared";
import { cn } from "@flolist/ui";
import type { Editor } from "@tiptap/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { memo, type CSSProperties, type ReactNode } from "react";
import { t } from "../../i18n/index.ts";
import { BlockHandle, type BlockAction } from "./BlockHandle.tsx";
import { InlineEditor } from "./InlineEditor.tsx";
import { AttachmentBlock, ImageBlock } from "./MediaBlocks.tsx";
import { SublistBlock } from "./SublistBlock.tsx";
import { TaskMarker, TaskTrailing } from "./TaskRow.tsx";
import { isDone } from "./task-utils.ts";
import { TaskMetaLine } from "../properties/TaskProperties.tsx";
import { useTaskFields } from "../properties/task-fields-context.ts";

export interface BlockRowProps {
  block: Block;
  /** The number a `numbered` block shows. */
  number?: number | undefined;
  placeholder?: string | undefined;
  onChange: (block: Block, inline: InlineNode[]) => void;
  onKeyDown?: (block: Block, event: KeyboardEvent, editor: Editor) => boolean;
  /** Keys on a block focused as a whole (divider, image, attachment, sublist). */
  onDividerKeyDown?: (block: Block, event: KeyboardEvent) => boolean;
  /** An image's caption was edited. */
  onCaption?: (block: Block, caption: string) => void;
  /** Resolves once queued block changes are saved (a new sublist's list exists then). */
  ready?: () => Promise<void>;
  onRequestLink: (editor: Editor) => void;
  onFocus?: (block: Block) => void;
  /** Part of the block selection (highlighted). */
  selected?: boolean;
  onPaste?: (block: Block, event: ClipboardEvent, editor: Editor) => boolean;
  onHistory?: (action: "undo" | "redo") => void;
  /** False for an empty list's unsaved placeholder: no handle, no dragging. */
  saved: boolean;
  /** False while the list is shown sorted (drag reorder is off then). */
  draggable?: boolean;
  onAction: (block: Block, action: BlockAction) => void;
  /** Nesting level (subtasks under their task). */
  depth?: number | undefined;
  /** Task rows: direct subtasks done/total. */
  progress?: { done: number; total: number } | undefined;
  collapsed?: boolean | undefined;
  onCollapse?: ((block: Block) => void) | undefined;
  onComplete?: ((block: Block, completed: boolean) => void) | undefined;
  onOpenTask?: ((block: Block) => void) | undefined;
}

/** Text styles per type [assumption: sizes picked to sit between body and page title]. */
const textClass: Record<string, string> = {
  task: "text-body",
  paragraph: "text-body",
  heading1: "font-display text-[26px] leading-8 font-bold tracking-[-0.01em]",
  heading2: "font-display text-[21px] leading-7 font-semibold",
  heading3: "text-[17px] leading-6 font-semibold",
  bullet: "text-body",
  numbered: "text-body",
  quote: "text-body",
};

/** Top spacing per type, so headings open a new section. */
const gapClass: Record<string, string> = {
  heading1: "mt-5",
  heading2: "mt-4",
  heading3: "mt-3",
};

const BULLETS = ["•", "◦", "▪"];
const INDENT_PX = 24;

/** Numbered levels count 1., a., i. [assumption]. */
function numberLabel(n: number, indent: number): string {
  const style = indent % 3;
  if (style === 1) {
    let s = "";
    for (let v = n; v > 0; v = Math.floor((v - 1) / 26))
      s = String.fromCharCode(97 + ((v - 1) % 26)) + s;
    return `${s}.`;
  }
  if (style === 2) {
    const romans: [number, string][] = [
      [1000, "m"],
      [900, "cm"],
      [500, "d"],
      [400, "cd"],
      [100, "c"],
      [90, "xc"],
      [50, "l"],
      [40, "xl"],
      [10, "x"],
      [9, "ix"],
      [5, "v"],
      [4, "iv"],
      [1, "i"],
    ];
    let v = n;
    let s = "";
    for (const [value, numeral] of romans) {
      while (v >= value) {
        s += numeral;
        v -= value;
      }
    }
    return `${s}.`;
  }
  return `${String(n)}.`;
}

const typeLabel = (block: Block) => t(`editor.type.${block.type}`);

const dividerBorder: Record<string, string> = {
  gray: "border-divider-gray",
  red: "border-divider-red",
  orange: "border-divider-orange",
  green: "border-divider-green",
  blue: "border-divider-blue",
  purple: "border-divider-purple",
};

/**
 * One block: a sortable row with the hover handle, its marker (bullet, number, quote bar) and
 * its inline editor, or a divider (focusable as a whole).
 */
export const BlockRow = memo(function BlockRow(props: BlockRowProps) {
  const { block } = props;
  const fields = useTaskFields();
  const sortable = useSortable({
    id: block.id,
    disabled: !props.saved || props.draggable === false,
  });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition,
  };

  const atomicKey = (e: { nativeEvent: KeyboardEvent; preventDefault: () => void }) => {
    if (props.onDividerKeyDown?.(block, e.nativeEvent)) e.preventDefault();
  };

  let body: ReactNode;
  if (block.type === "image") {
    body = (
      <ImageBlock
        block={block}
        onKeyDown={atomicKey}
        onCaption={(caption) => {
          props.onCaption?.(block, caption);
        }}
      />
    );
  } else if (block.type === "attachment") {
    body = <AttachmentBlock block={block} onKeyDown={atomicKey} />;
  } else if (block.type === "sublist") {
    body = (
      <SublistBlock
        block={block}
        onKeyDown={atomicKey}
        ready={props.ready ?? (() => Promise.resolve())}
      />
    );
  } else if (block.type === "divider") {
    const color = "color" in block.content ? block.content.color : "gray";
    body = (
      <div
        role="separator"
        data-atomic
        tabIndex={-1}
        aria-label={typeLabel(block)}
        onMouseDown={(e) => {
          e.preventDefault();
          e.currentTarget.focus();
        }}
        onKeyDown={(e) => {
          if (props.onDividerKeyDown?.(block, e.nativeEvent)) e.preventDefault();
        }}
        className="cursor-default py-2.5 outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <hr className={cn("border-t-2", dividerBorder[color])} />
      </div>
    );
  } else {
    const inline = "inline" in block.content ? block.content.inline : [];
    const marker =
      block.type === "bullet" ? (
        <span aria-hidden className="w-6 shrink-0 text-center text-text-muted select-none">
          {BULLETS[block.indent % BULLETS.length]}
        </span>
      ) : block.type === "numbered" ? (
        <span
          aria-hidden
          className="min-w-6 shrink-0 pr-1 text-right text-text-muted tabular-nums select-none"
        >
          {numberLabel(props.number ?? 1, block.indent)}
        </span>
      ) : block.type === "task" ? (
        <TaskMarker
          block={block}
          hasSubtasks={(props.progress?.total ?? 0) > 0}
          collapsed={props.collapsed ?? false}
          saved={props.saved}
          onCollapse={props.onCollapse}
          onComplete={(b, completed) => props.onComplete?.(b, completed)}
        />
      ) : null;
    const task = block.type === "task";
    body = (
      <div
        className={cn(
          "flex py-[3px]",
          block.type === "quote" && "my-0.5 border-l-[3px] border-border-strong pl-3",
        )}
        style={block.indent > 0 ? { paddingLeft: block.indent * INDENT_PX } : undefined}
      >
        {marker}
        {/* One wrapper for every text type, so Turn into keeps the editor mounted. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <InlineEditor
            blockId={block.id}
            inline={inline}
            placeholder={
              props.placeholder ??
              (block.type.startsWith("heading")
                ? typeLabel(block)
                : task
                  ? t("editor.task.placeholder")
                  : undefined)
            }
            ariaLabel={typeLabel(block)}
            className={cn(
              "text-text transition-colors duration-(--motion-fast)",
              textClass[block.type],
              task && isDone(block) && "text-text-muted line-through",
            )}
            onChange={(next) => {
              props.onChange(block, next);
            }}
            onKeyDown={(event, editor) => props.onKeyDown?.(block, event, editor) ?? false}
            onRequestLink={props.onRequestLink}
            onFocus={() => {
              props.onFocus?.(block);
            }}
            onPaste={(event, editor) => props.onPaste?.(block, event, editor) ?? false}
            onHistory={props.onHistory}
          />
          {task && fields && props.saved && (
            <TaskMetaLine
              block={block}
              workspaceId={fields.workspaceId}
              onFields={(f) => {
                fields.setFields(block, f);
              }}
            />
          )}
        </div>
        {task && (
          <TaskTrailing
            block={block}
            progress={props.progress ?? { done: 0, total: 0 }}
            saved={props.saved}
            onOpen={props.onOpenTask}
          />
        )}
      </div>
    );
  }

  return (
    <div
      ref={sortable.setNodeRef}
      data-block-id={block.id}
      data-block-type={block.type}
      data-selected={props.selected || undefined}
      data-depth={props.depth || undefined}
      style={{ ...style, ...(props.depth ? { marginLeft: props.depth * INDENT_PX } : {}) }}
      className={cn(
        "group/block relative rounded-md",
        props.selected && "bg-surface-selected",
        gapClass[block.type],
        sortable.isDragging && "z-10 opacity-60",
      )}
    >
      {props.saved && (
        <BlockHandle
          block={block}
          dragRef={sortable.setActivatorNodeRef}
          dragAttributes={sortable.attributes}
          dragListeners={sortable.listeners}
          onAction={props.onAction}
        />
      )}
      {body}
    </div>
  );
});
