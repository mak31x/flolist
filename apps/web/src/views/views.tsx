import {
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Pill,
  SegmentedTabs,
  EmptyState,
  cn,
  themes,
} from "@flolist/ui";
import { Link, useParams } from "@tanstack/react-router";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { useThemeStore } from "../shell/theme-store.ts";
import { EmptyTasks, Page } from "./Page.tsx";
import { LabelsTab } from "../features/properties/LabelsTab.tsx";
import { settingsTabs } from "./settings-tabs.ts";
import { SettingsCard } from "./SettingsCard.tsx";
import { ProfileTab } from "../features/profile/ProfileTab.tsx";
import { useMe, useSaveTheme, useSignOut } from "../features/auth/hooks.ts";
import { systemFirstDay } from "../platform/index.ts";
import { resolveWeekStart } from "@flolist/shared";
import { currentWeek } from "./week.ts";

export function InboxView() {
  return (
    <Page title="Inbox">
      <EmptyTasks message="Tasks you capture without a list land here." />
    </Page>
  );
}

export function TodayView() {
  const date = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(
    new Date(),
  );
  return (
    <Page title="Today" secondary={date}>
      <EmptyTasks message="Nothing due today. Enjoy the calm." />
    </Page>
  );
}

export function WeekView() {
  const me = useMe();
  const firstDay = resolveWeekStart(me.weekStart, systemFirstDay());
  const today = new Date().toDateString();
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });
  return (
    <Page title="My Week" wide>
      <div className="-mx-5 flex snap-x gap-4 overflow-x-auto px-5 pb-2 md:mx-0 md:px-0">
        {currentWeek(firstDay).map((day) => {
          const isToday = day.toDateString() === today;
          return (
            <section
              key={day.toISOString()}
              className="w-[220px] shrink-0 snap-start md:w-auto md:min-w-[150px] md:flex-1"
            >
              <h2 className={cn("text-[20px] font-bold", isToday ? "text-accent" : "text-text")}>
                {weekday.format(day)}{" "}
                <span className={cn(isToday ? "text-accent/70" : "text-text-subtle")}>
                  {day.getDate()}
                </span>
              </h2>
              <div className="mt-3 h-24 rounded-lg border border-dashed border-border" />
            </section>
          );
        })}
      </div>
    </Page>
  );
}

function TabbedView({
  title,
  label,
  tabs,
  message,
}: {
  title: string;
  label: string;
  tabs: readonly { value: string; label: string }[];
  message: string;
}) {
  const [value, setValue] = useState(tabs[0]?.value);
  return (
    <Page title={title}>
      {value !== undefined && (
        <SegmentedTabs label={label} tabs={tabs} value={value} onValueChange={setValue} />
      )}
      <EmptyState className="mt-6">{message}</EmptyState>
    </Page>
  );
}

export function AllTasksView() {
  return (
    <TabbedView
      title="Tasks"
      label="Filter tasks"
      tabs={[
        { value: "mine", label: "Tasks for me" },
        { value: "others", label: "Others" },
        { value: "upcoming", label: "Upcoming" },
        { value: "done", label: "Done" },
      ]}
      message="Tasks assigned to you will show up here."
    />
  );
}

export function UpdatesView() {
  return (
    <TabbedView
      title="Updates"
      label="Filter updates"
      tabs={[
        { value: "all", label: "All" },
        { value: "tasks", label: "Tasks" },
        { value: "messages", label: "Messages" },
        { value: "lists", label: "Lists" },
      ]}
      message="You're all caught up."
    />
  );
}

export function TeamView() {
  return (
    <Page title="Team">
      <EmptyState>Team members and lists will show up here.</EmptyState>
    </Page>
  );
}

export function TrashView() {
  return (
    <Page title="Trash">
      <EmptyState>Trash is empty.</EmptyState>
    </Page>
  );
}

export function NotFoundView() {
  return (
    <Page title="Not found">
      <EmptyState
        action={
          <Link to="/today" className="text-body font-semibold text-accent hover:underline">
            Go to Today
          </Link>
        }
      >
        This page doesn't exist.
      </EmptyState>
    </Page>
  );
}

export function SettingsView() {
  const { tab } = useParams({ from: "/_app/settings/$tab" });
  return (
    <Page title="Settings" actions={<SignOutPill />}>
      <nav
        aria-label="Settings sections"
        className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-1 md:mx-0 md:px-0"
      >
        {settingsTabs.map((t) => (
          <Link
            key={t.id}
            to="/settings/$tab"
            params={{ tab: t.id }}
            className={cn(
              "inline-flex h-7 shrink-0 items-center rounded-full border px-3 text-[13px] font-medium",
              "border-border text-text-muted hover:bg-chip",
              "data-[status=active]:border-transparent data-[status=active]:bg-chip-active data-[status=active]:text-text",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="mt-6 flex flex-col gap-3">
        {tab === "profile" ? (
          <ProfileTab />
        ) : tab === "features" ? (
          <AppearanceCard />
        ) : tab === "labels" ? (
          <LabelsTab />
        ) : (
          <SettingsPlaceholder />
        )}
      </div>
    </Page>
  );
}

function SignOutPill() {
  const signOut = useSignOut();
  return <Pill onClick={() => void signOut()}>Sign out</Pill>;
}

function AppearanceCard() {
  const preference = useThemeStore((s) => s.preference);
  const saveTheme = useSaveTheme();
  const current = themes.find((t) => t.id === preference);
  return (
    <SettingsCard title="Appearance" description="Active theme">
      <Menu>
        <MenuTrigger asChild>
          <Pill trailing={<ChevronDown />}>{current?.name}</Pill>
        </MenuTrigger>
        <MenuContent align="end">
          {themes.map((t) => (
            <MenuItem
              key={t.id}
              onSelect={() => {
                saveTheme.mutate(t.id);
              }}
              trailing={t.id === preference ? <Check aria-label="Selected" /> : undefined}
            >
              {t.name}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
    </SettingsCard>
  );
}

function SettingsPlaceholder() {
  return <EmptyState>These settings arrive with their features.</EmptyState>;
}
