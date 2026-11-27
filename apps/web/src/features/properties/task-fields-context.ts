import type { Block } from "@flolist/shared";
import { createContext, useContext } from "react";
import type { BlockFields } from "../editor/store.ts";

/** What task rows need to set their task's fields: the list's workspace and the store. */
export interface TaskFieldsContextValue {
  workspaceId: string;
  setFields: (block: Block, fields: Pick<BlockFields, "due" | "priority" | "labelIds">) => void;
}

export const TaskFieldsContext = createContext<TaskFieldsContextValue | null>(null);

export const useTaskFields = () => useContext(TaskFieldsContext);
