import { create } from "zustand";

export interface MoveRequest {
  /** The list the items leave (it isn't offered). */
  fromListId: string;
  /** Only lists of this workspace are offered (moves stay inside one workspace). */
  workspaceId: string;
  onPick: (listId: string) => void;
}

interface MoveState {
  request: MoveRequest | null;
  open: (request: MoveRequest) => void;
  close: () => void;
}

/** Move to list… (tasks.md → Task actions): one dialog for every place that offers it. */
export const useMoveTo = create<MoveState>()((set) => ({
  request: null,
  open: (request) => {
    set({ request });
  },
  close: () => {
    set({ request: null });
  },
}));
