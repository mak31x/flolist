import type { Block } from "@flolist/shared";
import { createContext, useContext } from "react";
import type { TaskActionHost } from "./actions.tsx";

/**
 * What a list editor gives its task rows for the context menu: the action host, and which
 * blocks a right-click on a row acts on (the whole selection when the row is part of it).
 */
export interface TaskActionsContextValue {
  host: TaskActionHost;
  targetsFor: (block: Block) => Block[];
}

export const TaskActionsContext = createContext<TaskActionsContextValue | null>(null);
export const useTaskActions = () => useContext(TaskActionsContext);
