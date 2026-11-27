import { PRIORITIES, type Priority, type PriorityName } from "@flolist/shared";
import { t } from "../../i18n/index.ts";

export const priorityName = (level: PriorityName) => t(`priority.${level}`);

/** Menu order: High first, "No priority" last. */
export const PRIORITY_MENU: readonly Priority[] = [3, 2, 1, 0];

export const priorityOf = (value: Priority): PriorityName => PRIORITIES[value] ?? "none";
