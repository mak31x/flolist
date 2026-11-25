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
}));
