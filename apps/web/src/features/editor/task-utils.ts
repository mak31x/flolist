import { inlineText, type Block } from "@flolist/shared";
import { t } from "../../i18n/index.ts";

/** A task block's title as plain text, or "Untitled task". */
export const taskTitle = (block: Block) =>
  inlineText("inline" in block.content ? block.content.inline : []).trim() ||
  t("editor.task.untitled");

export const isDone = (block: Block) => block.task?.completedAt != null;
