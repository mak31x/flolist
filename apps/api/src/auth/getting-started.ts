import {
  activityEvents,
  blocks,
  lists,
  sidebarEntries,
  tasks,
  userSettings,
  type Executor,
} from "@flolist/db";
import { positionsBetween, textInline, uuidv7, type InlineNode } from "@flolist/shared";
import { and, eq, isNull } from "drizzle-orm";
import { nextEntryPosition, type ensureDefaultSection } from "../lists/dto.ts";

type Item =
  | { kind: "heading" | "paragraph"; text: string }
  | { kind: "task"; text: string; subtasks?: readonly string[] };

/**
 * The "Getting started" list (settings-and-account.md → Authentication screens): features
 * explained as tasks to tick off. Only what exists so far is described `[assumption: own
 * wording, Superlist's onboarding list not copied]`; later phases may add items for new users.
 */
export const GETTING_STARTED_TITLE = "Getting started";
export const GETTING_STARTED_EMOJI = "👋";
export const GETTING_STARTED: readonly Item[] = [
  {
    kind: "paragraph",
    text: "Welcome to Flolist! Lists hold tasks, notes and more. Tick these off as you try them.",
  },
  { kind: "task", text: "Complete a task by clicking its checkbox (or press ⌘/Ctrl + D)" },
  { kind: "task", text: "Press Enter at the end of a task to add the next one" },
  {
    kind: "task",
    text: "Press Tab on a task to make it a subtask of the one above",
    subtasks: ["Like this one. Shift + Tab moves it back out"],
  },
  { kind: "task", text: "Open a task's details with the arrow on its right (or ⌘/Ctrl + Enter)" },
  { kind: "task", text: "Type [] and a space to start a task anywhere" },
  { kind: "heading", text: "More than tasks" },
  {
    kind: "task",
    text: "Type / to add headings, lists, dividers, images, files or a sublist",
  },
  { kind: "task", text: "Drag a block by its handle to reorder it, or onto a list to move it" },
  { kind: "task", text: "Star a list to keep it in the sidebar" },
];

const inline = (text: string): InlineNode[] => textInline(text);

/**
 * Seeds the list once per user: `user_settings.getting_started_seeded_at` is claimed first, so
 * concurrent calls and later calls do nothing, and a deleted list never comes back. Accounts
 * from before M3.1 get it on their next `/me` (the backfill), starred at the end of Favorites.
 */
export async function seedGettingStarted(
  tx: Executor,
  userId: string,
  workspaceId: string,
  section: Awaited<ReturnType<typeof ensureDefaultSection>>,
): Promise<string | null> {
  const claimed = await tx
    .update(userSettings)
    .set({ gettingStartedSeededAt: new Date() })
    .where(and(eq(userSettings.userId, userId), isNull(userSettings.gettingStartedSeededAt)))
    .returning({ userId: userSettings.userId });
  if (claimed.length === 0) return null;

  const listId = uuidv7();
  await tx.insert(lists).values({
    id: listId,
    workspaceId,
    rootListId: listId,
    title: GETTING_STARTED_TITLE,
    emoji: GETTING_STARTED_EMOJI,
    createdBy: userId,
  });

  const positions = positionsBetween(null, null, GETTING_STARTED.length);
  for (const [i, item] of GETTING_STARTED.entries()) {
    const position = positions[i] ?? positions.at(-1) ?? "a0";
    if (item.kind !== "task") {
      await tx.insert(blocks).values({
        containerType: "list",
        containerId: listId,
        rootListId: listId,
        position,
        type: item.kind === "heading" ? "heading2" : "paragraph",
        content: { inline: inline(item.text) },
        createdBy: userId,
      });
      continue;
    }
    const taskId = await insertTask(
      tx,
      { userId, workspaceId, listId, parentTaskId: null },
      item.text,
    );
    await tx.insert(blocks).values({
      containerType: "list",
      containerId: listId,
      rootListId: listId,
      position,
      type: "task",
      content: { inline: inline(item.text) },
      taskId,
      createdBy: userId,
    });
    const subPositions = positionsBetween(null, null, item.subtasks?.length ?? 0);
    for (const [j, text] of (item.subtasks ?? []).entries()) {
      const subId = await insertTask(
        tx,
        { userId, workspaceId, listId, parentTaskId: taskId },
        text,
      );
      await tx.insert(blocks).values({
        containerType: "task",
        containerId: taskId,
        rootListId: listId,
        position: subPositions[j] ?? "a0",
        type: "task",
        content: { inline: inline(text) },
        taskId: subId,
        createdBy: userId,
      });
    }
  }

  await tx.insert(sidebarEntries).values({
    userId,
    listId,
    sectionId: section.id,
    position: await nextEntryPosition(tx, section.id),
  });
  return listId;
}

async function insertTask(
  tx: Executor,
  at: { userId: string; workspaceId: string; listId: string; parentTaskId: string | null },
  text: string,
): Promise<string> {
  const id = uuidv7();
  await tx.insert(tasks).values({
    id,
    workspaceId: at.workspaceId,
    rootListId: at.listId,
    listId: at.listId,
    parentTaskId: at.parentTaskId,
    title: text,
    titleInline: inline(text),
    createdBy: at.userId,
  });
  await tx.insert(activityEvents).values({
    workspaceId: at.workspaceId,
    rootListId: at.listId,
    entityType: "task",
    entityId: id,
    actorId: at.userId,
    action: "created",
    new: text,
  });
  return id;
}
