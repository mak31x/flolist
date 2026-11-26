import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { meQuery } from "./features/auth/api.ts";
import { AFTER_AUTH_PATH } from "./features/auth/auth-client.ts";
import { ForgotPasswordView } from "./features/auth/components/ForgotPasswordView.tsx";
import { LoginView } from "./features/auth/components/LoginView.tsx";
import { ResetPasswordView } from "./features/auth/components/ResetPasswordView.tsx";
import { SignupView } from "./features/auth/components/SignupView.tsx";
import { VerifyEmailView } from "./features/auth/components/VerifyEmailView.tsx";
import type { PanelMode } from "./shell/RightPanel.tsx";
import { AppShell } from "./shell/AppShell.tsx";
import { AllListsPage } from "./features/lists/AllListsPage.tsx";
import { ListPage } from "./features/lists/ListPage.tsx";
import {
  AllTasksView,
  InboxView,
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

export interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFoundView,
});

const optionalString = (value: unknown) => (typeof value === "string" ? value : undefined);

/** Drops undefined keys so search objects stay clean (exactOptionalPropertyTypes). */
function compact<T extends Record<string, string | undefined>>(o: T) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: string;
  };
}

/**
 * Every app view sits under this layout: signed-out visitors go to /login and come back
 * afterwards. A failed email-verification link (`?error=` on its callback) goes to /verify-email.
 */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_app",
  component: AppShell,
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.query({ ...meQuery, staleTime: "static" });
    if (me) return { me };
    const error = optionalString((location.search as Record<string, unknown>).error);
    if (error) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router's redirect API
      throw redirect({ to: "/verify-email", search: { error } });
    }
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router's redirect API
    throw redirect({ to: "/login", search: { redirect: location.href } });
  },
});

/** Signed-in users skip the log-in and sign-up screens. */
async function redirectIfSignedIn({ context }: { context: RouterContext }) {
  const me = await context.queryClient.query({ ...meQuery, staleTime: "static" });
  if (me) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router's redirect API
    throw redirect({ href: AFTER_AUTH_PATH });
  }
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginView,
  validateSearch: (s: Record<string, unknown>) =>
    compact({
      redirect: optionalString(s.redirect),
      error: optionalString(s.error),
      reset: optionalString(s.reset),
    }),
  beforeLoad: redirectIfSignedIn,
});
const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/signup",
  component: SignupView,
  validateSearch: (s: Record<string, unknown>) => compact({ redirect: optionalString(s.redirect) }),
  beforeLoad: redirectIfSignedIn,
});
const verifyEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/verify-email",
  component: VerifyEmailView,
  validateSearch: (s: Record<string, unknown>) =>
    compact({ email: optionalString(s.email), error: optionalString(s.error) }),
});
const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot-password",
  component: ForgotPasswordView,
});
const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset-password",
  component: ResetPasswordView,
  validateSearch: (s: Record<string, unknown>) =>
    compact({ token: optionalString(s.token), error: optionalString(s.error) }),
});

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router's redirect API
    throw redirect({ to: "/today" });
  },
});

const inboxRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/inbox",
  component: InboxView,
  staticData: { panel: { kind: "cover", cover: "misty-mountains" } },
});
const todayRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/today",
  component: TodayView,
  staticData: { panel: { kind: "cover", cover: "pastel-ocean" } },
});
const weekRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/my-week",
  component: WeekView,
});
const allTasksRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/all-tasks",
  component: AllTasksView,
});
const updatesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/updates",
  component: UpdatesView,
  staticData: { panel: { kind: "cover", cover: "misty-marsh" } },
});
const allListsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/all-lists",
  component: AllListsPage,
});
const listRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/lists/$listId",
  component: ListPage,
  staticData: { panel: { kind: "list" } },
});
const taskRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/lists/$listId/tasks/$taskId",
  component: ListPage,
  staticData: { panel: { kind: "list" } },
});
const teamRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/team/$teamId",
  component: TeamView,
});
const trashRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/trash",
  component: TrashView,
});

const settingsIndexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router's redirect API
    throw redirect({ to: "/settings/$tab", params: { tab: "profile" } });
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
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
  loginRoute,
  signupRoute,
  verifyEmailRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  appRoute.addChildren([
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
  ]),
]);

export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  return createRouter({
    routeTree,
    context: { queryClient },
    ...(history ? { history } : {}),
    defaultPreload: "intent",
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;
