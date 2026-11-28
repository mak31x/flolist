import type { Block, Task } from "@flolist/shared";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  IconButton,
} from "@flolist/ui";
import { X } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { t } from "../../i18n/index.ts";
import { coarsePointer, useSelectGestures, type SelectMode } from "../editor/select-gestures.ts";
import type { ViewRow } from "./rows.ts";
import type { ViewActions } from "./view-actions.tsx";

/** A row's right-click menu (desktop; touch-first devices long-press to select instead). */
export function ViewRowMenu({
  tasks,
  actions,
  children,
}: {
  tasks: readonly Task[];
  actions: ViewActions;
  children: ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={coarsePointer()}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        aria-label={t("tasks.actions.label")}
        data-keep-selection
        onCloseAutoFocus={(e) => {
          e.preventDefault();
        }}
      >
        {actions.items(tasks).map((item, i) => (
          <Fragment key={item.id}>
            {item.group && i > 0 && <ContextMenuSeparator />}
            <ContextMenuItem
              icon={item.icon}
              shortcut={item.shortcut}
              destructive={item.destructive}
              onSelect={() => {
                // Pickers open after the menu has closed and given focus back.
                if (item.id === "due" || item.id === "priority" || item.id === "labels") {
                  setTimeout(() => {
                    actions.run(item.id, tasks);
                  }, 0);
                } else actions.run(item.id, tasks);
              }}
            >
              {item.label}
            </ContextMenuItem>
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** The floating bar of a view selection (views.md → Multiselect). */
export function ViewSelectionBar({
  tasks,
  actions,
  onClear,
}: {
  tasks: readonly Task[];
  actions: ViewActions;
  onClear: () => void;
}) {
  const items = actions.items(tasks).filter((i) => i.id !== "open");
  return (
    <div
      role="toolbar"
      aria-label={t("tasks.selection.bar")}
      data-selection-bar
      data-keep-selection
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+84px)] left-1/2 z-30 flex max-w-[calc(100vw-16px)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-full bg-surface-raised px-2 py-1.5 shadow-popover md:bottom-6 print:hidden"
    >
      <span className="shrink-0 px-2 text-body font-semibold whitespace-nowrap text-text">
        {t("tasks.selection.count", { count: tasks.length })}
      </span>
      {items
        .filter((i) => i.id !== "due" && i.id !== "priority" && i.id !== "labels")
        .map((item) => (
          <IconButton
            key={item.id}
            label={item.label}
            icon={item.icon}
            {...(item.shortcut ? { shortcut: item.shortcut } : {})}
            onClick={() => {
              actions.run(item.id, tasks);
              if (item.id !== "complete") onClear();
            }}
          />
        ))}
      <IconButton
        label={t("tasks.selection.clear")}
        icon={<X />}
        shortcut="Escape"
        onClick={onClear}
      />
    </div>
  );
}

/**
 * A view row with its selection gestures and right-click menu. A selected row's menu acts on the
 * whole selection, like a list row's (D-073).
 */
export function SelectableRow({
  row,
  selected,
  selection,
  actions,
  onSelect,
  children,
}: {
  row: ViewRow;
  selected: boolean;
  selection: readonly Task[];
  actions: ViewActions;
  onSelect: (block: Block, mode: SelectMode) => void;
  children: ReactNode;
}) {
  const gestures = useSelectGestures(row.block, true, selection.length > 0, onSelect);
  const targets = selected && selection.length > 0 ? selection : [row.task];
  return (
    <ViewRowMenu tasks={targets} actions={actions}>
      <div {...gestures} data-keep-selection={selected || undefined}>
        {children}
      </div>
    </ViewRowMenu>
  );
}
