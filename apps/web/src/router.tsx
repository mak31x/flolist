import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import type { PanelMode } from "./shell/RightPanel.tsx";
import { AppShell } from "./shell/AppShell.tsx";
import {
  AllListsView,
  AllTasksView,
  InboxView,
  ListView,
  NotFoundView,
  SettingsView,
  TeamView,
  TodayView,
  TrashView,
  UpdatesView,
  WeekView,
} from "./views/views.tsx";
import { isSettingsTab } from "./views/settings-tabs.ts";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** What the right column shows for this view (ui-design §1). Defaults to nothing. */
    panel?: PanelMode;
  }
  interface Register {
    router: AppRouter;
  }
}

const rootRoute = createRootRoute({ component: AppShell, notFoundComponent: NotFoundView });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router's redirect API
    throw redirect({ to: "/today" });
  },
});

const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/inbox",
  component: InboxView,
  staticData: { panel: { kind: "cover", cover: "misty-mountains" } },
});
const todayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/today",
  component: TodayView,
  staticData: { panel: { kind: "cover", cover: "pastel-ocean" } },
});
const weekRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/my-week",
  component: WeekView,
});
const allTasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/all-tasks",
  component: AllTasksView,
});
const updatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/updates",
  component: UpdatesView,
  staticData: { panel: { kind: "cover", cover: "misty-marsh" } },
});
const allListsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/all-lists",
  component: AllListsView,
});
const listRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/lists/$listId",
  component: ListView,
});
const taskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/lists/$listId/tasks/$taskId",
  component: ListView,
});
const teamRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/team/$teamId",
  component: TeamView,
});
const trashRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/trash",
  component: TrashView,
});

const settingsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router's redirect API
    throw redirect({ to: "/settings/$tab", params: { tab: "profile" } });
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/$tab",
  component: SettingsView,
  beforeLoad: ({ params }) => {
    if (!isSettingsTab(params.tab)) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router's redirect API
      throw redirect({ to: "/settings/$tab", params: { tab: "profile" } });
    }
  },
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  inboxRoute,
  todayRoute,
  weekRoute,
  allTasksRoute,
  updatesRoute,
  allListsRoute,
  listRoute,
  taskRoute,
  teamRoute,
  trashRoute,
  settingsIndexRoute,
  settingsRoute,
]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, ...(history ? { history } : {}), defaultPreload: "intent" });
}

export type AppRouter = ReturnType<typeof createAppRouter>;
