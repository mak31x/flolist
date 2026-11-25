import {
  Avatar,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  cn,
} from "@flolist/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronDown,
  FolderPlus,
  ListPlus,
  LogOut,
  PanelLeft,
  Plus,
  Search,
  Settings,
  SquarePlus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { systemViews } from "./nav.ts";
import { useShell } from "./ui-store.ts";
import { useMe, useSignOut } from "../features/auth/hooks.ts";

type SidebarProps = {
  /** Called after a navigation link is used (closes the phone drawer). */
  onNavigate?: () => void;
  /** Hide the collapse toggle inside the phone drawer. */
  inDrawer?: boolean;
};

export function Sidebar({ onNavigate, inDrawer = false }: SidebarProps) {
  const toggleSidebar = useShell((s) => s.toggleSidebar);

  return (
    <nav aria-label="Main" className="flex h-full flex-col px-3 pt-3 pb-3">
      <div className="flex h-8 items-center justify-end gap-0.5">
        <IconButton label="Search" icon={<Search />} shortcut="Mod+F" tooltip={!inDrawer} />
        {!inDrawer && (
          <IconButton
            label="Collapse sidebar"
            icon={<PanelLeft />}
            shortcut="Mod+\"
            onClick={toggleSidebar}
          />
        )}
      </div>

      <ul className="mt-3 flex flex-col gap-0.5">
        {systemViews.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <Link
              to={to}
              onClick={onNavigate}
              className={cn(
                "group relative flex h-8 items-center gap-2.5 rounded-lg px-2 text-body font-medium text-text",
                "transition-colors duration-(--motion-fast) hover:bg-surface-hover",
                "data-[status=active]:bg-surface-selected",
              )}
            >
              <span className="flex size-5 items-center justify-center rounded-[6px] bg-accent-soft text-accent">
                <Icon className="size-3.5" strokeWidth={2.25} aria-hidden />
              </span>
              {label}
              <span
                aria-hidden
                className="absolute top-1 -right-3 bottom-1 hidden w-[3px] rounded-l-full bg-accent group-data-[status=active]:block"
              />
            </Link>
          </li>
        ))}
      </ul>

      <FavoritesSection />

      <div className="flex-1" />

      <div className="flex items-center justify-between">
        <QuickCreate />
        <AvatarMenu {...(onNavigate ? { onNavigate } : {})} />
      </div>
    </nav>
  );
}

function FavoritesSection() {
  const [open, setOpen] = useState(true);
  return (
    <section className="mt-6" aria-labelledby="sidebar-favorites">
      <button
        type="button"
        id="sidebar-favorites"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
        }}
        className="flex h-7 w-full cursor-pointer items-center gap-1 rounded-md px-2 text-secondary font-semibold text-text-muted hover:text-text"
      >
        Favorites
        <ChevronDown
          aria-hidden
          className={cn(
            "size-3.5 transition-transform duration-(--motion-fast)",
            !open && "-rotate-90",
          )}
        />
      </button>
      {open && (
        <p className="px-2 py-1.5 text-secondary text-text-subtle">Star a list to pin it here.</p>
      )}
    </section>
  );
}

function QuickCreate() {
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label="Create" icon={<Plus />} variant="chip" tooltip={false} />
      </MenuTrigger>
      <MenuContent side="top" align="start">
        <MenuItem icon={<SquarePlus />} disabled>
          New task
        </MenuItem>
        <MenuItem icon={<ListPlus />} disabled>
          New list
        </MenuItem>
        <MenuItem icon={<FolderPlus />} disabled>
          New section
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function AvatarMenu({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const me = useMe();
  const signOut = useSignOut();
  const go = (to: "/settings/$tab" | "/trash") => {
    onNavigate?.();
    void (to === "/trash" ? navigate({ to }) : navigate({ to, params: { tab: "profile" } }));
  };
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-full p-0.5 pr-1.5 hover:bg-surface-hover"
        >
          <Avatar id={me.id} name={me.name} imageUrl={me.avatarUrl} size={24} />
          <ChevronDown aria-hidden className="size-3.5 text-text-muted" />
        </button>
      </MenuTrigger>
      <MenuContent side="top" align="end">
        <MenuItem
          icon={<Settings />}
          onSelect={() => {
            go("/settings/$tab");
          }}
        >
          Settings
        </MenuItem>
        <MenuItem
          icon={<Trash2 />}
          onSelect={() => {
            go("/trash");
          }}
        >
          Trash
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon={<LogOut />}
          onSelect={() => {
            onNavigate?.();
            void signOut();
          }}
        >
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
