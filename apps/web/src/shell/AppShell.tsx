import { DateSuggestionPopup } from "../features/properties/DateSuggestionPopup.tsx";
import { MoveToListDialog } from "../features/tasks/MoveToListDialog.tsx";
import { Dialog, IconButton, SheetContent, brand } from "@flolist/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, Outlet, useLocation, useMatches, useParams } from "@tanstack/react-router";
import { Bell, Menu as MenuIcon, PanelLeft, PanelRightOpen, Plus, Search } from "lucide-react";
import { meQuery } from "../features/auth/api.ts";
import { useServerThemeSync } from "../features/auth/hooks.ts";
import { listQuery } from "../features/lists/api.ts";
import { coverSrc } from "../features/lists/cover.ts";
import { QuickCreate } from "../features/lists/QuickCreate.tsx";
import { covers } from "./covers.ts";
import { LiveSyncProvider } from "../features/sync/LiveSync.tsx";
import { RightPanel, type PanelCover, type PanelMode } from "./RightPanel.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { useShell } from "./ui-store.ts";

const noPanel: PanelMode = { kind: "none" };

/**
 * Signed-in layout. The route guard already checked the session; if it expires later
 * (`/api/v1/me` turns 401 on a refetch), go back to log in.
 */
export function AppShell() {
  const { data: me } = useQuery(meQuery);
  const location = useLocation();
  if (me) {
    return (
      <LiveSyncProvider>
        <Shell />
      </LiveSyncProvider>
    );
  }
  // `undefined` = refetching or failed: wait rather than bounce. Once on /login this layout is
  // about to unmount; redirecting again would nest `?redirect=` forever.
  if (me === null && location.pathname !== "/login") {
    return <Navigate to="/login" search={{ redirect: location.href }} replace />;
  }
  return null;
}

/** Three-column app shell (ui-design §1): sidebar · main card · right panel. */
function Shell() {
  useServerThemeSync();
  const matches = useMatches();
  const mode = matches.at(-1)?.staticData.panel ?? noPanel;
  const params = useParams({ strict: false });
  const task =
    params.listId && params.taskId ? { listId: params.listId, taskId: params.taskId } : null;

  const sidebarCollapsed = useShell((s) => s.sidebarCollapsed);
  const toggleSidebar = useShell((s) => s.toggleSidebar);
  const coverCollapsed = useShell((s) => s.coverCollapsed);
  const setCoverCollapsed = useShell((s) => s.setCoverCollapsed);
  const setCustomizing = useShell((s) => s.setCustomizing);
  const listId = mode.kind === "list" ? params.listId : undefined;
  const { data: list } = useQuery({ ...listQuery(listId ?? ""), enabled: listId !== undefined });
  const listCover = listId && list ? coverSrc(list.cover) : null;
  const cover: PanelCover | null =
    mode.kind === "cover"
      ? { key: mode.cover, src: covers[mode.cover] }
      : list && listCover
        ? {
            key: listCover,
            src: listCover,
            onCustomize: () => {
              setCustomizing(list.id);
            },
          }
        : null;
  const drawerOpen = useShell((s) => s.drawerOpen);
  const setDrawerOpen = useShell((s) => s.setDrawerOpen);

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas print:block print:h-auto print:overflow-visible print:bg-surface">
      <DateSuggestionPopup />
      <MoveToListDialog />
      {!sidebarCollapsed && (
        <aside className="hidden w-[260px] shrink-0 bg-surface md:block print:hidden">
          <Sidebar />
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col md:flex-row md:gap-2 md:p-2 print:block print:p-0">
        <MobileHeader
          onOpenDrawer={() => {
            setDrawerOpen(true);
          }}
        />
        <main className="relative min-h-0 min-w-0 flex-1 overflow-y-auto bg-surface md:rounded-card print:overflow-visible">
          {sidebarCollapsed && (
            <IconButton
              label="Show sidebar"
              icon={<PanelLeft />}
              shortcut="Mod+\"
              onClick={toggleSidebar}
              className="absolute top-3 left-3 z-10 max-md:hidden"
            />
          )}
          {cover && coverCollapsed && !task && (
            <IconButton
              label="Show cover"
              icon={<PanelRightOpen />}
              onClick={() => {
                setCoverCollapsed(false);
              }}
              className="absolute top-3 right-3 z-10 max-lg:hidden"
            />
          )}
          <Outlet />
        </main>
        <RightPanel cover={cover} task={task} />
      </div>

      <MobileBar />

      <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" title="Navigation">
          <Sidebar
            inDrawer
            onNavigate={() => {
              setDrawerOpen(false);
            }}
          />
        </SheetContent>
      </Dialog>
    </div>
  );
}

function MobileHeader({ onOpenDrawer }: { onOpenDrawer: () => void }) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between bg-surface px-2 pt-[env(safe-area-inset-top)] md:hidden print:hidden">
      <IconButton
        label="Open navigation"
        icon={<MenuIcon />}
        onClick={onOpenDrawer}
        tooltip={false}
      />
      <span className="font-display text-[18px] font-bold text-accent">{brand.wordmark}</span>
      <IconButton label="Search" icon={<Search />} tooltip={false} />
    </header>
  );
}

/** Phone only: Quick create FAB (bottom centre) and Updates (bottom right). */
function MobileBar() {
  const setDrawerOpen = useShell((s) => s.setDrawerOpen);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex items-end justify-center px-4 pb-[calc(16px+env(safe-area-inset-bottom))] md:hidden print:hidden">
      <QuickCreate
        align="center"
        revealSidebar={() => {
          setDrawerOpen(true);
        }}
        trigger={
          <button
            type="button"
            aria-label="Create"
            className="pointer-events-auto inline-flex size-12 cursor-pointer items-center justify-center rounded-full bg-accent text-on-accent shadow-lifted"
          >
            <Plus className="size-5" />
          </button>
        }
      />
      <Link
        to="/updates"
        aria-label="Updates"
        className="pointer-events-auto absolute right-4 bottom-[calc(20px+env(safe-area-inset-bottom))] inline-flex size-10 items-center justify-center rounded-full bg-surface-raised text-text shadow-lifted"
      >
        <Bell className="size-4" />
      </Link>
    </div>
  );
}
