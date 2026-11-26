import { useNavigate } from "@tanstack/react-router";
import { useShell } from "../../shell/ui-store.ts";
import { useCreateList } from "./mutations.ts";

/**
 * "New list" everywhere (sidebar, Quick create, All lists): creates an untitled list, opens it,
 * and puts the cursor in its title (lists-and-blocks.md → Lists).
 */
export function useCreateAndOpenList() {
  const navigate = useNavigate();
  const { create } = useCreateList();
  const setFocusTitleOf = useShell((s) => s.setFocusTitleOf);
  return (options: { sectionId?: string } = {}) => {
    const id = create(options);
    setFocusTitleOf(id);
    void navigate({ to: "/lists/$listId", params: { listId: id } });
    return id;
  };
}
