import { create } from "zustand";

export type PickerKind = "due" | "priority" | "labels";

/**
 * Which property picker is open, and where: `scope` tells a list row (`row`) from the details
 * panel (`details`), since both show the same task. Shortcuts (^D, ^L) open them from the title.
 */
interface PickerState {
  open: { blockId: string; scope: "row" | "details"; kind: PickerKind } | null;
  setOpen: (open: PickerState["open"]) => void;
}

export const usePicker = create<PickerState>()((set) => ({
  open: null,
  setOpen: (open) => {
    set({ open });
  },
}));

/** Whether the picker `kind` of this block in this scope is open, and its setter. */
export function usePickerOpen(blockId: string, scope: "row" | "details", kind: PickerKind) {
  const isOpen = usePicker(
    (s) => s.open?.blockId === blockId && s.open.scope === scope && s.open.kind === kind,
  );
  const setOpen = usePicker((s) => s.setOpen);
  return [
    isOpen,
    (open: boolean) => {
      if (open) setOpen({ blockId, scope, kind });
      else if (usePicker.getState().open?.blockId === blockId) setOpen(null);
    },
  ] as const;
}
