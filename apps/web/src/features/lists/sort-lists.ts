import { compareKeys, type ListIndexItem } from "@flolist/shared";
import { t } from "../../i18n/index.ts";

export type Sort = "created" | "alphabetical" | "opened";

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Sorts a copy of the index (views.md → All lists: Creation date / Alphabetical / Last opened). */
export function sortLists(items: readonly ListIndexItem[], sort: Sort): ListIndexItem[] {
  const copy = [...items];
  if (sort === "alphabetical") {
    return copy.sort(
      (a, b) =>
        collator.compare(a.title || t("lists.untitled"), b.title || t("lists.untitled")) ||
        compareKeys(a.id, b.id),
    );
  }
  if (sort === "opened") {
    // Never-opened lists go last, newest first among themselves.
    return copy.sort(
      (a, b) =>
        compareKeys(b.lastOpenedAt ?? "", a.lastOpenedAt ?? "") ||
        compareKeys(b.createdAt, a.createdAt),
    );
  }
  return copy.sort((a, b) => compareKeys(b.createdAt, a.createdAt) || compareKeys(b.id, a.id));
}
