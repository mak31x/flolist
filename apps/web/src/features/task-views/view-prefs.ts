import { DEFAULT_LIST_VIEW_PREFS, type ListViewPrefs } from "@flolist/shared";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Filter/sort settings of the Inbox and Today views. Kept on this device (localStorage, which
 * every wrapper provides) `[assumption]`; syncing them per user is Backlog. Inbox defaults to
 * manual order with completed tasks hidden, Today to "Due date" (views.md → Today).
 */
export type TaskViewName = "inbox" | "today";

const DEFAULTS: Record<TaskViewName, ListViewPrefs> = {
  inbox: { ...DEFAULT_LIST_VIEW_PREFS, hideCompleted: true },
  today: { ...DEFAULT_LIST_VIEW_PREFS, sort: "due" },
};

interface ViewPrefsState {
  prefs: Record<TaskViewName, ListViewPrefs>;
  set: (view: TaskViewName, patch: Partial<ListViewPrefs>) => void;
}

export const useViewPrefs = create<ViewPrefsState>()(
  persist(
    (set) => ({
      prefs: DEFAULTS,
      set: (view, patch) => {
        set((s) => ({ prefs: { ...s.prefs, [view]: { ...s.prefs[view], ...patch } } }));
      },
    }),
    {
      name: "flolist.viewPrefs",
      storage: createJSONStorage(() => localStorage),
      merge: (stored, current) => {
        const saved = (stored as Partial<ViewPrefsState> | undefined)?.prefs;
        return {
          ...current,
          prefs: {
            inbox: { ...DEFAULTS.inbox, ...saved?.inbox },
            today: { ...DEFAULTS.today, ...saved?.today },
          },
        };
      },
    },
  ),
);
