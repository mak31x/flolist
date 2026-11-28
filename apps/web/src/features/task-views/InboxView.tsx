import { compareKeys, positionBetween, type InboxPage } from "@flolist/shared";
import { SkeletonSquiggle, toast } from "@flolist/ui";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { GripVertical } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { t } from "../../i18n/index.ts";
import { playCompleteSound } from "../../platform/index.ts";
import { EmptyTasks, NewTaskRow, Page } from "../../views/Page.tsx";
import { useMe } from "../auth/hooks.ts";
import { dropTargetAt, markDropTarget } from "../editor/drop-targets.ts";
import { focusBlock } from "../editor/focus.ts";
import { labelsQuery } from "../properties/labels-api.ts";
import { inboxKey, inboxQuery } from "./api.ts";
import { blankTask, usePersonalWorkspaceId } from "./new-task.ts";
import {
  seedInboxTask,
  useCreateInboxTask,
  usePutInboxItem,
  useUpdateViewTask,
  type TaskChange,
} from "./mutations.ts";
import { inboxRows, sortRows, type ViewRow } from "./rows.ts";
import { useViewSelection } from "./selection.tsx";
import { SelectableRow } from "./ViewActionUi.tsx";
import { useNewTaskShortcut } from "./new-task-keys.ts";
import { TaskViewMenu } from "./TaskViewMenu.tsx";
import { moveTasks, useViewActions } from "./view-actions.tsx";
import { TaskViewRow } from "./TaskViewRow.tsx";
import { useViewPrefs } from "./view-prefs.ts";

/** Inbox positions sorted, for placing a new or moved item between neighbours. */
function sortedPositions(page: InboxPage | undefined): string[] {
  return (page?.items ?? []).map((i) => i.position).sort(compareKeys);
}

/**
 * The Inbox (views.md → Inbox): the caller's Inbox tasks in manual order (drag to reorder),
 * subtasks nested under them, a New task row at the top, and the filter/sort pill. Completed
 * tasks stay in the Inbox but are hidden unless Hide completed is off (D-075).
 */
export function InboxView() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: page } = useQuery(inboxQuery);
  const { data: labels } = useQuery(labelsQuery);
  const workspaceId = usePersonalWorkspaceId();
  const prefs = useViewPrefs((s) => s.prefs.inbox);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const update = useUpdateViewTask(me.id);
  const create = useCreateInboxTask();
  const putItem = usePutInboxItem();

  const rows = useMemo(
    () =>
      page
        ? sortRows(
            inboxRows(page, collapsed),
            prefs,
            me.id,
            (id) => labels?.find((l) => l.id === id)?.name,
          )
        : null,
    [page, collapsed, prefs, me.id, labels],
  );

  const onChange = useCallback(
    (taskId: string, change: TaskChange) => {
      update.mutate({ id: taskId, change });
      if (change.completed && me.soundsEnabled) playCompleteSound();
    },
    [update, me.soundsEnabled],
  );

  const open = useCallback(
    (taskId: string) => {
      void navigate({ to: "/inbox/tasks/$taskId", params: { taskId } });
    },
    [navigate],
  );

  /** A new Inbox task after `afterTaskId`'s item (or at the top), focused for typing. */
  const newTask = useCallback(
    (afterTaskId?: string) => {
      if (!workspaceId) return;
      const current = qc.getQueryData<InboxPage>(inboxKey);
      const positions = sortedPositions(current);
      const after = afterTaskId
        ? current?.items.find((i) => i.taskId === afterTaskId)?.position
        : undefined;
      const index = after ? positions.indexOf(after) : -1;
      const position = positionBetween(positions[index] ?? null, positions[index + 1] ?? null);
      const task = blankTask(workspaceId, me.id);
      const vars = { task, position };

      seedInboxTask(qc, vars);

      create.mutate(vars);
      focusBlock(task.id, "end");
    },
    [workspaceId, qc, me.id, create],
  );

  const actions = useViewActions(open);
  const selection = useViewSelection(rows ?? [], actions);

  useNewTaskShortcut(() => {
    newTask();
  });

  const onArrow = useCallback(
    (taskId: string, direction: -1 | 1) => {
      const list = rows ?? [];
      const next = list[list.findIndex((r) => r.task.id === taskId) + direction];
      if (next) focusBlock(next.task.id, direction > 0 ? "start" : "end");
    },
    [rows],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const manual = prefs.sort === "manual";
  const onDragMove = (event: DragMoveEvent) => {
    const target = dropTargetAt(event);
    markDropTarget(target?.dataset.dropListId ? target : null);
  };
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    // Dropped on a sidebar list: the task (or the selection it belongs to) moves there.
    const dropped = dropTargetAt(event);
    markDropTarget(null);
    const listId = dropped?.dataset.dropListId;
    if (page && listId) {
      const dragged = page.tasks.find((x) => x.id === active.id);
      const group = selection.isSelected(String(active.id))
        ? selection.selected.filter((x) => x.parentTaskId === null || x.listId !== null)
        : dragged
          ? [dragged]
          : [];
      if (group.length > 0) {
        selection.clear();
        void moveTasks(group, listId)
          .then(() => {
            toast(t("taskViews.moved", { count: group.length }));
          })
          .catch(() => {
            toast(t("taskViews.moveError"));
          })
          .finally(() => {
            void qc.invalidateQueries({ queryKey: inboxKey });
          });
      }
      return;
    }
    if (!page || !rows || !over || active.id === over.id) return;
    // Drops land among the top-level items; a subtask row stands for its top-level task.
    const heads = rows.filter((r) => r.depth === 0).map((r) => r.task.id);
    const headOf = (id: string) => {
      let index = rows.findIndex((r) => r.task.id === id);
      while (index > 0 && (rows[index]?.depth ?? 0) > 0) index -= 1;
      return rows[index]?.task.id;
    };
    const target = headOf(String(over.id));
    const moving = page.items.find((i) => i.taskId === active.id);
    if (!target || !moving || target === moving.taskId) return;
    const order = heads.filter((id) => id !== moving.taskId);
    const down = heads.indexOf(moving.taskId) < heads.indexOf(target);
    const at = order.indexOf(target) + (down ? 1 : 0);
    const positionOf = (id: string | undefined) =>
      id ? (page.items.find((i) => i.taskId === id)?.position ?? null) : null;
    const position = positionBetween(positionOf(order[at - 1]), positionOf(order[at]));
    const task = page.tasks.find((x) => x.id === moving.taskId);
    if (task) putItem.mutate({ task, position });
  };

  return (
    <Page title={t("taskViews.inbox")} actions={<TaskViewMenu view="inbox" />}>
      <NewTaskRow
        disabled={!rows || !workspaceId}
        onClick={() => {
          newTask();
        }}
      />
      {!rows || !workspaceId ? (
        <SkeletonSquiggle className="mt-1" rows={3} />
      ) : rows.length === 0 ? (
        <EmptyTasks message={t("taskViews.inboxEmpty")} />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            markDropTarget(null);
          }}
        >
          <SortableContext
            items={rows.filter((r) => r.depth === 0).map((r) => r.task.id)}
            strategy={verticalListSortingStrategy}
          >
            <div role="list" aria-label={t("taskViews.inbox")} data-task-view className="mt-1">
              {rows.map((row) => (
                <SelectableRow
                  key={row.task.id}
                  row={row}
                  selected={selection.isSelected(row.task.id)}
                  selection={selection.selected}
                  actions={actions}
                  onSelect={selection.onSelect}
                >
                  <InboxRow
                    row={row}
                    selected={selection.isSelected(row.task.id)}
                    workspaceId={row.task.workspaceId}
                    draggable={manual && row.depth === 0}
                    collapsed={collapsed.has(row.task.id)}
                    onCollapse={(id) => {
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      });
                    }}
                    onChange={onChange}
                    onOpen={open}
                    onEnter={row.depth === 0 ? newTask : undefined}
                    onArrow={onArrow}
                    onToggle={(id) => {
                      const target = rows.find((r) => r.task.id === id);
                      if (target) onChange(id, { completed: target.task.completedAt === null });
                    }}
                  />
                </SelectableRow>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      {selection.bar}
    </Page>
  );
}

function InboxRow({
  row,
  draggable,
  ...props
}: Omit<React.ComponentProps<typeof TaskViewRow>, "rowProps" | "dragHandle" | "style"> & {
  row: ViewRow;
  draggable: boolean;
}) {
  const sortable = useSortable({ id: row.task.id, disabled: !draggable });
  return (
    <TaskViewRow
      {...props}
      row={row}
      rowProps={{ ref: sortable.setNodeRef, role: "listitem" }}
      style={{
        transform: CSS.Translate.toString(sortable.transform),
        transition: sortable.transition,
        ...(sortable.isDragging ? { zIndex: 10, opacity: 0.6 } : {}),
      }}
      dragHandle={
        draggable ? (
          <DragHandle
            dragRef={sortable.setActivatorNodeRef}
            attributes={sortable.attributes}
            listeners={sortable.listeners}
          />
        ) : null
      }
    />
  );
}

/** The ⋮⋮ grip of a top-level Inbox row (desktop; phones drag with a long press). */
function DragHandle({
  dragRef,
  attributes,
  listeners,
}: {
  dragRef: (el: HTMLElement | null) => void;
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
}) {
  return (
    <button
      type="button"
      ref={dragRef}
      {...attributes}
      {...listeners}
      aria-label={t("taskViews.drag")}
      className="absolute top-1.5 -left-6 hidden size-5 items-center justify-center rounded text-text-subtle opacity-0 group-hover/block:opacity-100 focus-visible:opacity-100 md:flex [&_svg]:size-4"
    >
      <GripVertical aria-hidden />
    </button>
  );
}
