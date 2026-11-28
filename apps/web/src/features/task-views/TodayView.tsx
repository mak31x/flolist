import {
  addDays,
  compareKeys,
  positionBetween,
  type InboxPage,
  type Task,
  type TodayPage,
} from "@flolist/shared";
import {
  IconButton,
  Pill,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SegmentedTabs,
  SkeletonSquiggle,
  cn,
} from "@flolist/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { t } from "../../i18n/index.ts";
import { playCompleteSound } from "../../platform/index.ts";
import { EmptyTasks, NewTaskRow, Page } from "../../views/Page.tsx";
import { useMe } from "../auth/hooks.ts";
import { focusBlock } from "../editor/focus.ts";
import { listsQuery } from "../lists/api.ts";
import { DatePicker } from "../properties/DatePicker.tsx";
import { useDateContext } from "../properties/dates.ts";
import { labelsQuery } from "../properties/labels-api.ts";
import { inboxKey, todayKey, todayQuery } from "./api.ts";
import {
  seedInboxTask,
  useCreateInboxTask,
  usePutTodayOrder,
  useReschedule,
  useUpdateViewTask,
  type TaskChange,
} from "./mutations.ts";
import { blankTask, usePersonalWorkspaceId } from "./new-task.ts";
import { flatRows, sortRows, todayGroups, type ViewRow } from "./rows.ts";
import { useViewSelection } from "./selection.tsx";
import { SelectableRow } from "./ViewActionUi.tsx";
import { useNewTaskShortcut } from "./new-task-keys.ts";
import { TaskViewMenu } from "./TaskViewMenu.tsx";
import { useViewActions } from "./view-actions.tsx";
import { TaskViewRow } from "./TaskViewRow.tsx";
import { useViewPrefs } from "./view-prefs.ts";

type Tab = "open" | "completed";

const titleDate = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const titleWeekday = new Intl.DateTimeFormat(undefined, { weekday: "long", timeZone: "UTC" });
const utc = (date: string) => new Date(`${date}T00:00:00Z`);

/**
 * Today (views.md → Today): the open tasks due on the shown day, with an Overdue group (and
 * "Reschedule all") above them, or the tasks completed that day. ‹ › and the calendar show
 * other days (`?date=`). New tasks here are due on the shown day and go to the Inbox. Manual
 * order is kept per day `[assumption]`.
 */
export function TodayView() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const ctx = useDateContext();
  const today = ctx.now.date;
  const date = search.date ?? today;
  const isToday = date === today;
  const { data: page } = useQuery(todayQuery(date));
  const { data: labels } = useQuery(labelsQuery);
  const { data: lists } = useQuery(listsQuery);
  const workspaceId = usePersonalWorkspaceId();
  const prefs = useViewPrefs((s) => s.prefs.today);
  const [tab, setTab] = useState<Tab>("open");
  const [overdueOpen, setOverdueOpen] = useState(true);
  const update = useUpdateViewTask(me.id);
  const create = useCreateInboxTask();
  const reorder = usePutTodayOrder();
  const reschedule = useReschedule();

  const labelName = useCallback((id: string) => labels?.find((l) => l.id === id)?.name, [labels]);
  const groups = useMemo(() => (page ? todayGroups(page, today) : null), [page, today]);
  const { overdueRows, dueRows, completedRows } = useMemo(() => {
    // "Manual" keeps the day's own order (todayGroups already applied it).
    const sorted = (tasks: readonly Task[]) => sortRows(flatRows(tasks), prefs, me.id, labelName);
    return {
      overdueRows: groups ? sorted(groups.overdue) : [],
      dueRows: groups ? sorted(groups.today) : [],
      completedRows: groups ? flatRows(groups.completed) : [],
    };
  }, [groups, prefs, me.id, labelName]);
  const listTitle = (task: Task) =>
    task.listId ? lists?.find((l) => l.id === task.listId)?.title || t("lists.untitled") : null;

  const go = (next: string) => {
    void navigate({ to: "/today", search: next === today ? {} : { date: next } });
  };
  const open = useCallback(
    (taskId: string) => {
      void navigate({
        to: "/today/tasks/$taskId",
        params: { taskId },
        search: isToday ? {} : { date },
      });
    },
    [navigate, isToday, date],
  );
  const onChange = useCallback(
    (taskId: string, change: TaskChange) => {
      update.mutate({ id: taskId, change });
      if (change.completed && me.soundsEnabled) playCompleteSound();
    },
    [update, me.soundsEnabled],
  );

  /** A new task due on the shown day, in the Inbox; placed after `afterTaskId` in Today. */
  const newTask = useCallback(
    (afterTaskId?: string) => {
      if (!workspaceId) return;
      const task = blankTask(workspaceId, me.id, { date, time: null, tz: ctx.timeZone });
      const current = qc.getQueryData<TodayPage>(todayKey(date));
      // It goes to the top of the Inbox.
      const first = qc
        .getQueryData<InboxPage>(inboxKey)
        ?.items.map((i) => i.position)
        .sort(compareKeys)[0];
      const vars = { task, position: positionBetween(null, first ?? null) };

      seedInboxTask(qc, vars);

      create.mutate(vars);
      if (afterTaskId && current && prefs.sort === "manual") {
        const rows = dueRows.map((r) => r.task.id);
        const at = rows.indexOf(afterTaskId);
        const pos = (id: string | undefined) => (id ? (current.order[id] ?? null) : null);
        reorder.mutate({
          date,
          taskId: task.id,
          position: positionBetween(pos(rows[at]), pos(rows[at + 1])),
        });
      }
      setTab("open");
      focusBlock(task.id, "end");
    },
    [workspaceId, me.id, date, ctx.timeZone, qc, create, prefs.sort, dueRows, reorder],
  );

  const visible = useMemo(
    () => (tab === "open" ? [...overdueRows, ...dueRows] : completedRows),
    [tab, overdueRows, dueRows, completedRows],
  );
  const actions = useViewActions(open);
  const selection = useViewSelection(visible, actions);
  useNewTaskShortcut(() => {
    newTask();
  });

  const onArrow = (taskId: string, direction: -1 | 1) => {
    const next = visible[visible.findIndex((r) => r.task.id === taskId) + direction];
    if (next) focusBlock(next.task.id, direction > 0 ? "start" : "end");
  };
  const onToggle = (taskId: string) => {
    const row = visible.find((r) => r.task.id === taskId);
    if (row) onChange(taskId, { completed: row.task.completedAt === null });
  };

  const renderRows = (rows: readonly ViewRow[], enter: boolean) =>
    rows.map((row) => (
      <SelectableRow
        key={row.task.id}
        row={row}
        selected={selection.isSelected(row.task.id)}
        selection={selection.selected}
        actions={actions}
        onSelect={selection.onSelect}
      >
        <TaskViewRow
          row={row}
          selected={selection.isSelected(row.task.id)}
          workspaceId={row.task.workspaceId}
          context={listTitle(row.task)}
          onChange={onChange}
          onOpen={open}
          onEnter={enter ? newTask : undefined}
          onArrow={onArrow}
          onToggle={onToggle}
          rowProps={{ role: "listitem" }}
        />
      </SelectableRow>
    ));

  const title = isToday ? t("taskViews.today") : titleWeekday.format(utc(date));
  return (
    <Page
      title={title}
      secondary={titleDate.format(utc(date))}
      actions={
        <div className="flex items-center gap-1.5">
          <TaskViewMenu view="today" />
          <IconButton
            label={t("taskViews.previousDay")}
            icon={<ChevronLeft />}
            variant="chip"
            onClick={() => {
              go(addDays(date, -1));
            }}
          />
          <Popover>
            <PopoverTrigger asChild>
              <IconButton
                label={t("taskViews.jumpToDate")}
                icon={<CalendarDays />}
                variant="chip"
              />
            </PopoverTrigger>
            <PopoverContent aria-label={t("taskViews.jumpToDate")}>
              <DatePicker
                value={{ date, time: null, tz: ctx.timeZone }}
                onChange={(due) => {
                  go(due?.date ?? today);
                }}
              />
            </PopoverContent>
          </Popover>
          <IconButton
            label={t("taskViews.nextDay")}
            icon={<ChevronRight />}
            variant="chip"
            onClick={() => {
              go(addDays(date, 1));
            }}
          />
        </div>
      }
    >
      <SegmentedTabs
        label={t("taskViews.todayTabs")}
        tabs={[
          { value: "open", label: t("taskViews.open") },
          { value: "completed", label: t("taskViews.completed") },
        ]}
        value={tab}
        onValueChange={setTab}
        className="mb-3"
      />
      {tab === "open" && (
        <NewTaskRow
          disabled={!groups || !workspaceId}
          onClick={() => {
            newTask();
          }}
        />
      )}
      {!groups || !workspaceId ? (
        <SkeletonSquiggle className="mt-1" rows={3} />
      ) : tab === "completed" ? (
        completedRows.length === 0 ? (
          <EmptyTasks message={t("taskViews.completedEmpty")} />
        ) : (
          <div role="list" aria-label={t("taskViews.completed")}>
            {renderRows(completedRows, false)}
          </div>
        )
      ) : overdueRows.length + dueRows.length === 0 ? (
        <EmptyTasks message={t(isToday ? "taskViews.todayEmpty" : "taskViews.dayEmpty")} />
      ) : (
        <>
          {overdueRows.length > 0 && (
            <section aria-label={t("taskViews.overdue")} className="mb-4">
              <div className="flex items-center justify-between gap-2 py-1">
                <button
                  type="button"
                  aria-expanded={overdueOpen}
                  onClick={() => {
                    setOverdueOpen((v) => !v);
                  }}
                  className="flex items-center gap-1 rounded text-meta font-semibold text-accent outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  <ChevronDown
                    aria-hidden
                    className={cn(
                      "size-3.5 transition-transform duration-(--motion-fast)",
                      !overdueOpen && "-rotate-90",
                    )}
                  />
                  {t("taskViews.overdue")} · {overdueRows.length}
                </button>
                <Pill
                  onClick={() => {
                    reschedule.mutate({ date, tasks: overdueRows.map((r) => r.task) });
                  }}
                >
                  {t(isToday ? "taskViews.rescheduleToday" : "taskViews.rescheduleDay")}
                </Pill>
              </div>
              {overdueOpen && <div role="list">{renderRows(overdueRows, false)}</div>}
            </section>
          )}
          <div role="list" aria-label={title}>
            {renderRows(dueRows, true)}
          </div>
        </>
      )}
      {selection.bar}
    </Page>
  );
}
