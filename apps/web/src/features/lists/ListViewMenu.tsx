import { AVAILABLE_LIST_SORTS, type ListSort, type ListViewPrefs } from "@flolist/shared";
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
import { isFiltered, isSorted } from "./list-view.ts";
import { useUpdateListPrefs } from "./mutations.ts";

/**
 * The header's funnel (lists-and-blocks.md → Filter/sort menu): two toggles and the sorts that
 * work so far (the task-field sorts join with M3). Settings are per user and per list.
 */
export function ListViewMenu({ listId, prefs }: { listId: string; prefs: ListViewPrefs }) {
  const update = useUpdateListPrefs(listId);
  const toggles: { key: "tasksOnly" | "hideCompleted"; label: string }[] = [
    { key: "tasksOnly", label: t("lists.view.tasksOnly") },
    { key: "hideCompleted", label: t("lists.view.hideCompleted") },
  ];
  const check = (on: boolean) => (on ? <Check aria-hidden className="size-4" /> : undefined);
  return (
    <Menu>
      <MenuTrigger asChild>
        <Pill
          aria-label={t("lists.view.menu")}
          active={isSorted(prefs) || isFiltered(prefs)}
          icon={<ListFilter />}
        />
      </MenuTrigger>
      <MenuContent align="end" className="w-60">
        {toggles.map(({ key, label }) => (
          <MenuItem
            key={key}
            role="menuitemcheckbox"
            aria-checked={prefs[key]}
            trailing={check(prefs[key])}
            onSelect={(e) => {
              e.preventDefault();
              update.mutate({ [key]: !prefs[key] });
            }}
          >
            {label}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuLabel>{t("lists.view.sortBy")}</MenuLabel>
        {AVAILABLE_LIST_SORTS.map((sort: ListSort) => (
          <MenuItem
            key={sort}
            role="menuitemradio"
            aria-checked={prefs.sort === sort}
            trailing={check(prefs.sort === sort)}
            onSelect={() => {
              if (prefs.sort !== sort) update.mutate({ sort });
            }}
          >
            {t(`lists.sort.${sort}`)}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
