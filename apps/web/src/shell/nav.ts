import {
  Bell,
  CalendarDays,
  Inbox,
  LayoutGrid,
  ListChecks,
  Sun,
  type LucideIcon,
} from "lucide-react";

export type SystemView = {
  to: "/inbox" | "/today" | "/my-week" | "/all-tasks" | "/updates" | "/all-lists";
  label: string;
  icon: LucideIcon;
};

/** Sidebar system views, top to bottom (views.md → Sidebar). Meetings is excluded (D-001). */
export const systemViews: readonly SystemView[] = [
  { to: "/inbox", label: "Inbox", icon: Inbox },
  { to: "/today", label: "Today", icon: Sun },
  { to: "/my-week", label: "Week", icon: CalendarDays },
  { to: "/all-tasks", label: "All tasks", icon: ListChecks },
  { to: "/updates", label: "Updates", icon: Bell },
  { to: "/all-lists", label: "All lists", icon: LayoutGrid },
];
