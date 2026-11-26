import { create } from "zustand";

/** Shell UI state (not server data). */
type ShellState = {
  /** Desktop/tablet: sidebar hidden. */
  sidebarCollapsed: boolean;
  /** Cover panel hidden by the user. */
  coverCollapsed: boolean;
  /** Phone: drawer open. */
  drawerOpen: boolean;
  toggleSidebar: () => void;
  setCoverCollapsed: (collapsed: boolean) => void;
  setDrawerOpen: (open: boolean) => void;
  /** A sidebar section or entry whose title is being edited in place. */
  renaming: { kind: "section" | "list"; id: string } | null;
  setRenaming: (renaming: { kind: "section" | "list"; id: string } | null) => void;
  /** A freshly created list whose page should focus its title (lists-and-blocks.md → Lists). */
  focusTitleOf: string | null;
  setFocusTitleOf: (id: string | null) => void;
  /** The list whose Customize dialog is open (from its ⋮ menu or the cover's gear). */
  customizing: string | null;
  setCustomizing: (id: string | null) => void;
};

export const useShell = create<ShellState>()((set) => ({
  sidebarCollapsed: false,
  coverCollapsed: false,
  drawerOpen: false,
  toggleSidebar: () => {
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }));
  },
  setCoverCollapsed: (coverCollapsed) => {
    set({ coverCollapsed });
  },
  setDrawerOpen: (drawerOpen) => {
    set({ drawerOpen });
  },
  renaming: null,
  setRenaming: (renaming) => {
    set({ renaming });
  },
  focusTitleOf: null,
  setFocusTitleOf: (focusTitleOf) => {
    set({ focusTitleOf });
  },
  customizing: null,
  setCustomizing: (customizing) => {
    set({ customizing });
  },
}));
