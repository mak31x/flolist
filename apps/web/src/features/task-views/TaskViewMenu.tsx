import { AVAILABLE_LIST_SORTS, type ListSort } from "@flolist/shared";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Pill,
} from "@flolist/ui";
import { Check, ListFilter } from "lucide-react";
import { t } from "../../i18n/index.ts";
import { useViewPrefs, type TaskViewName } from "./view-prefs.ts";

/**
 * The filter/sort pill of a task view (views.md → Inbox: Hide completed, sort options). Uses the
 * list sorts; "Manual" is the view's own order (Inbox order, Today's per-day order).
 */
export function TaskViewMenu({ view }: { view: TaskViewName }) {
  const prefs = useViewPrefs((s) => s.prefs[view]);
  const set = useViewPrefs((s) => s.set);
  const check = (on: boolean) => (on ? <Check aria-hidden className="size-4" /> : undefined);
  const active = prefs.hideCompleted || prefs.sort !== (view === "today" ? "due" : "manual");
  return (
    <Menu>
      <MenuTrigger asChild>
        <Pill aria-label={t("lists.view.menu")} active={active} icon={<ListFilter />} />
      </MenuTrigger>
      <MenuContent align="end" className="w-60">
        {view === "inbox" && (
          <>
            <MenuItem
              role="menuitemcheckbox"
              aria-checked={prefs.hideCompleted}
              trailing={check(prefs.hideCompleted)}
              onSelect={(e) => {
                e.preventDefault();
                set(view, { hideCompleted: !prefs.hideCompleted });
              }}
            >
              {t("lists.view.hideCompleted")}
            </MenuItem>
            <MenuSeparator />
          </>
        )}
        <MenuLabel>{t("lists.view.sortBy")}</MenuLabel>
        {AVAILABLE_LIST_SORTS.filter((s) => s !== "completed").map((sort: ListSort) => (
          <MenuItem
            key={sort}
            role="menuitemradio"
            aria-checked={prefs.sort === sort}
            trailing={check(prefs.sort === sort)}
            onSelect={() => {
              set(view, { sort });
            }}
          >
            {t(`lists.sort.${sort}`)}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
