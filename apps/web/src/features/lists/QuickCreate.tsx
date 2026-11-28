import { positionAfter } from "@flolist/shared";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@flolist/ui";
import { useQuery } from "@tanstack/react-query";
import { FolderPlus, ListPlus, SquarePlus } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { t } from "../../i18n/index.ts";
import { useShell } from "../../shell/ui-store.ts";
import { sidebarQuery } from "./api.ts";
import { useCreateSection } from "./mutations.ts";
import { useCreateAndOpenList } from "./use-create-and-open.ts";
import { useQuickNewTask } from "../task-views/new-task.ts";

type QuickCreateProps = {
  /** The button that opens the menu (sidebar "+", or the phone FAB). */
  trigger: ReactNode;
  /** Called before navigating (closes the phone drawer). */
  onNavigate?: () => void;
  /** Phone: the sidebar is in a drawer, so open it to show the new section's name field. */
  revealSidebar?: () => void;
  align?: "start" | "center" | "end";
};

/**
 * Quick create (views.md → Sidebar §5): New task (into the Inbox, M4.1) · New list · New section.
 */
export function QuickCreate({
  trigger,
  onNavigate,
  revealSidebar,
  align = "start",
}: QuickCreateProps) {
  const createList = useCreateAndOpenList();
  const newTask = useQuickNewTask();
  const createSection = useCreateSection();
  const setRenaming = useShell((s) => s.setRenaming);
  const { data: sidebar } = useQuery(sidebarQuery);
  // A new list (its title) or section (its name field) takes focus; the menu mustn't hand it
  // back to its trigger.
  const keepFocus = useRef(false);
  return (
    <Menu>
      <MenuTrigger asChild>{trigger}</MenuTrigger>
      <MenuContent
        side="top"
        align={align}
        onCloseAutoFocus={(e) => {
          if (keepFocus.current) e.preventDefault();
          keepFocus.current = false;
        }}
      >
        <MenuItem
          icon={<SquarePlus />}
          disabled={!newTask}
          onSelect={() => {
            keepFocus.current = true;
            onNavigate?.();
            void newTask?.();
          }}
        >
          {t("sidebar.newTask")}
        </MenuItem>
        <MenuItem
          icon={<ListPlus />}
          onSelect={() => {
            keepFocus.current = true;
            onNavigate?.();
            createList();
          }}
        >
          {t("sidebar.newList")}
        </MenuItem>
        <MenuItem
          icon={<FolderPlus />}
          disabled={!sidebar}
          onSelect={() => {
            keepFocus.current = true;
            revealSidebar?.();
            const last = sidebar?.sections.at(-1);
            const id = createSection.create(
              t("sidebar.defaultSectionTitle"),
              positionAfter(last?.position ?? null),
            );
            setRenaming({ kind: "section", id });
          }}
        >
          {t("sidebar.newSection")}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
