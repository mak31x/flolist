import type { Block } from "@flolist/shared";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  MenuItem,
  MenuSeparator,
} from "@flolist/ui";
import { Fragment } from "react";
import { t } from "../../i18n/index.ts";
import {
  runTaskAction,
  taskActionItems,
  type TaskActionHost,
  type TaskActionItem,
} from "./actions.tsx";
import { useTaskActions } from "./task-actions-context.ts";

/** Picker actions open after the menu has closed and handed focus back. */
function run(item: TaskActionItem, targets: readonly Block[], host: TaskActionHost) {
  if (item.id === "due" || item.id === "priority" || item.id === "labels") {
    setTimeout(() => {
      runTaskAction(item.id, targets, host);
    }, 0);
    return;
  }
  runTaskAction(item.id, targets, host);
}

/** The right-click menu of a task row. */
export function TaskContextMenuContent({ block }: { block: Block }) {
  const actions = useTaskActions();
  if (!actions) return null;
  const targets = actions.targetsFor(block);
  return (
    <ContextMenuContent
      aria-label={t("tasks.actions.label")}
      data-keep-selection
      // Actions place focus themselves (the copy, a picker); don't pull it back to the row.
      onCloseAutoFocus={(e) => {
        e.preventDefault();
      }}
    >
      {taskActionItems(targets, actions.host).map((item, i) => (
        <Fragment key={item.id}>
          {item.group && i > 0 && <ContextMenuSeparator />}
          <ContextMenuItem
            icon={item.icon}
            shortcut={item.shortcut}
            destructive={item.destructive}
            onSelect={() => {
              run(item, targets, actions.host);
            }}
          >
            {item.label}
          </ContextMenuItem>
        </Fragment>
      ))}
    </ContextMenuContent>
  );
}

/** The same actions as dropdown items (the details panel's ⋮). */
export function TaskMenuItems({
  targets,
  host,
  exclude = [],
}: {
  targets: readonly Block[];
  host: TaskActionHost;
  exclude?: readonly TaskActionItem["id"][];
}) {
  return taskActionItems(targets, host)
    .filter((item) => !exclude.includes(item.id))
    .map((item, i) => (
      <Fragment key={item.id}>
        {item.group && i > 0 && <MenuSeparator />}
        <MenuItem
          icon={item.icon}
          shortcut={item.shortcut}
          destructive={item.destructive}
          onSelect={() => {
            run(item, targets, host);
          }}
        >
          {item.label}
        </MenuItem>
      </Fragment>
    ));
}
