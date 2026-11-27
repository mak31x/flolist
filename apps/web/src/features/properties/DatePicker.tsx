import {
  addDays,
  dueTimeSchema,
  endOfMonth,
  endOfWeek,
  startOfWeek,
  type TaskDue,
} from "@flolist/shared";
import { cn, IconButton } from "@flolist/ui";
import {
  CalendarArrowUp,
  CalendarCheck,
  CalendarRange,
  CalendarX,
  ChevronLeft,
  ChevronRight,
  Clock,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { t } from "../../i18n/index.ts";
import {
  formatDayLong,
  formatMonth,
  isWeekend,
  monthGrid,
  monthOf,
  shiftMonth,
  weekdayColumns,
  weekdayInitial,
  weekdayName,
} from "./calendar.ts";
import { dueOn, quickPicks, useDateContext } from "./dates.ts";

export interface DatePickerProps {
  value: TaskDue | null;
  onChange: (due: TaskDue | null) => void;
  /** A date was picked (quick pick or calendar day): the popover can close. */
  onDone?: () => void;
}

/**
 * The date picker (ui-design §6): Today / Tomorrow / Next week, "No due date" when one is set,
 * a month calendar (week starts per the user's setting, weekends shaded, today circled, the
 * selection filled with the accent) and an optional time. Remind me and Repeat join it with
 * reminders (M5.2) and recurring tasks (M5.1).
 */
export function DatePicker({ value, onChange, onDone }: DatePickerProps) {
  const ctx = useDateContext();
  const today = ctx.now.date;
  const picks = quickPicks(ctx);
  const [month, setMonth] = useState(() => monthOf(value?.date ?? today));
  const [cursor, setCursor] = useState(() => value?.date ?? today);
  const moved = useRef(false);
  const cells = useRef(new Map<string, HTMLButtonElement>());
  const labelId = useId();

  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    cells.current.get(cursor)?.focus();
  }, [cursor, month]);

  const pick = (date: string) => {
    onChange(dueOn(date, value, ctx.timeZone));
    onDone?.();
  };

  const moveTo = (date: string) => {
    moved.current = true;
    setCursor(date);
    setMonth(monthOf(date));
  };

  const onGridKey = (e: KeyboardEvent) => {
    const step: Record<string, () => string> = {
      ArrowLeft: () => addDays(cursor, -1),
      ArrowRight: () => addDays(cursor, 1),
      ArrowUp: () => addDays(cursor, -7),
      ArrowDown: () => addDays(cursor, 7),
      Home: () => startOfWeek(cursor, ctx.weekStart),
      End: () => endOfWeek(cursor, ctx.weekStart),
      PageUp: () => sameDayIn(shiftMonth(monthOf(cursor), -1), cursor),
      PageDown: () => sameDayIn(shiftMonth(monthOf(cursor), 1), cursor),
    };
    const next = step[e.key];
    if (!next) return;
    e.preventDefault();
    moveTo(next());
  };

  const weeks = monthGrid(month, ctx.weekStart);
  return (
    <div className="flex w-[272px] flex-col gap-1">
      <div className="flex flex-col">
        <PickRow
          icon={<CalendarCheck />}
          onClick={() => {
            pick(picks.today);
          }}
        >
          {t("due.today")}
        </PickRow>
        <PickRow
          icon={<CalendarArrowUp />}
          onClick={() => {
            pick(picks.tomorrow);
          }}
        >
          {t("due.tomorrow")}
        </PickRow>
        <PickRow
          icon={<CalendarRange />}
          onClick={() => {
            pick(picks.nextWeek);
          }}
        >
          {t("due.nextWeek")}
        </PickRow>
        {value && (
          <PickRow
            icon={<CalendarX />}
            onClick={() => {
              onChange(null);
              onDone?.();
            }}
          >
            {t("due.clear")}
          </PickRow>
        )}
      </div>

      <hr className="my-1 border-border" />

      <div className="flex items-center justify-between px-1">
        <span id={labelId} className="text-[13px] font-semibold" aria-live="polite">
          {formatMonth(month)}
        </span>
        <span className="flex gap-1">
          <IconButton
            label={t("due.prevMonth")}
            icon={<ChevronLeft />}
            variant="ghost"
            size="sm"
            onClick={() => {
              setMonth(shiftMonth(month, -1));
            }}
          />
          <IconButton
            label={t("due.nextMonth")}
            icon={<ChevronRight />}
            variant="ghost"
            size="sm"
            onClick={() => {
              setMonth(shiftMonth(month, 1));
            }}
          />
        </span>
      </div>

      <table
        role="grid"
        aria-labelledby={labelId}
        className="w-full table-fixed border-collapse"
        onKeyDown={onGridKey}
      >
        <thead>
          <tr>
            {weekdayColumns(ctx.weekStart).map((wd) => (
              <th
                key={wd}
                scope="col"
                abbr={weekdayName(wd)}
                className={cn(
                  "h-7 text-center text-meta font-medium text-text-subtle",
                  (wd === 0 || wd === 6) && "bg-surface-sunken",
                )}
              >
                {weekdayInitial(wd)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((date) => {
                const inMonth = monthOf(date) === month;
                const selected = value?.date === date;
                const isToday = date === today;
                // Roving focus: the cursor's day, or the 1st when the cursor is in another month.
                const focusable =
                  monthOf(cursor) === month ? date === cursor : date === `${month}-01`;
                return (
                  <td
                    key={date}
                    role="gridcell"
                    aria-selected={selected}
                    className={cn("p-0 text-center", isWeekend(date) && "bg-surface-sunken")}
                  >
                    <button
                      ref={(el) => {
                        if (el) cells.current.set(date, el);
                        else cells.current.delete(date);
                      }}
                      type="button"
                      tabIndex={focusable ? 0 : -1}
                      aria-label={formatDayLong(date)}
                      aria-current={isToday ? "date" : undefined}
                      onClick={() => {
                        setCursor(date);
                        pick(date);
                      }}
                      className={cn(
                        "mx-auto my-0.5 flex size-8 items-center justify-center rounded-full text-[13px] tabular-nums",
                        "outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
                        inMonth ? "text-text" : "text-text-subtle",
                        isToday && !selected && "ring-1 ring-text ring-inset",
                        selected
                          ? "bg-accent font-semibold text-on-accent"
                          : "hover:bg-surface-hover",
                      )}
                    >
                      {Number(date.slice(8))}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <hr className="my-1 border-border" />

      <TimeRow
        time={value?.time ?? null}
        onChange={(time) => {
          onChange({ date: value?.date ?? today, time, tz: value?.tz ?? ctx.timeZone });
        }}
      />
    </div>
  );
}

/** The same day of the month in `month`, clamped to its last day (31 Jan → 28 Feb). */
function sameDayIn(month: string, date: string): string {
  const last = Number(endOfMonth(`${month}-01`).slice(8));
  return `${month}-${String(Math.min(Number(date.slice(8)), last)).padStart(2, "0")}`;
}

function PickRow({
  icon,
  onClick,
  children,
}: {
  icon: ReactNode;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[30px] items-center gap-2 rounded-md px-2 text-left text-[13px] text-text outline-none hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus-ring [&_svg]:size-4 [&_svg]:text-text-muted"
    >
      {icon}
      {children}
    </button>
  );
}

/** "⏱ Time" with a native time field (works in the Tauri and Capacitor webviews). */
function TimeRow({
  time,
  onChange,
}: {
  time: string | null;
  onChange: (time: string | null) => void;
}) {
  const id = useId();
  return (
    <div className="flex h-[30px] items-center gap-2 px-2 text-[13px] [&>svg]:size-4 [&>svg]:text-text-muted">
      <Clock aria-hidden />
      <label htmlFor={id} className="flex-1">
        {t("due.time")}
      </label>
      <input
        id={id}
        type="time"
        step={60}
        value={time ?? ""}
        onChange={(e) => {
          const next = e.currentTarget.value.slice(0, 5);
          if (next === "") onChange(null);
          else if (dueTimeSchema.safeParse(next).success) onChange(next);
        }}
        className="h-7 rounded-md bg-chip px-2 text-[13px] text-text tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      />
      {time && (
        <IconButton
          label={t("due.removeTime")}
          icon={<X />}
          variant="ghost"
          size="sm"
          onClick={() => {
            onChange(null);
          }}
        />
      )}
    </div>
  );
}
