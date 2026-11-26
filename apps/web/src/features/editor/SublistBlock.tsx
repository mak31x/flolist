import type { ListIndexItem } from "@flolist/shared";
import { cn } from "@flolist/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { t } from "../../i18n/index.ts";
import { listQuery, listsKey } from "../lists/api.ts";
import { openTaskCount } from "../lists/list-view.ts";
import { blocksQuery } from "./api.ts";
import { ListIcon } from "../lists/ListIcon.tsx";
import { useUpdateList } from "../lists/mutations.ts";
import type { AtomicProps } from "./MediaBlocks.tsx";

/**
 * A sublist row (lists-and-blocks.md → Sublists): list icon, a title you can rename in place,
 * its open-task count, and an arrow that opens the sublist as its own page. The title field is
 * the block's focus target. The count reads the sublist's blocks, which live sync keeps fresh
 * (sublists share their root's channel).
 */
export function SublistBlock({
  block,
  onKeyDown,
  ready,
}: AtomicProps & {
  /** Resolves once the block (and so the child list) is saved. */
  ready: () => Promise<void>;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const id = block.sublistId ?? "";
  const fromIndex = qc.getQueryData<ListIndexItem[]>(listsKey)?.find((l) => l.id === id);
  const { data: list } = useQuery({
    ...listQuery(id),
    enabled: id !== "",
    ...(fromIndex ? { initialData: fromIndex } : {}),
  });
  const updateList = useUpdateList(id, { ready });
  const { data: sublistBlocks } = useQuery({ ...blocksQuery(id), enabled: id !== "" });
  const open = sublistBlocks ? openTaskCount(sublistBlocks) : 0;
  const title = list?.title ?? "";
  const [draft, setDraft] = useState(title);
  const [focused, setFocused] = useState(false);
  const [seen, setSeen] = useState(title);
  if (title !== seen) {
    setSeen(title);
    if (!focused) setDraft(title);
  }

  const commit = () => {
    const next = draft.trim();
    if (next !== title) updateList.mutate({ title: next });
  };
  const openPage = () => {
    commit();
    void ready().then(() => navigate({ to: "/lists/$listId", params: { listId: id } }));
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    const atEnd = el.selectionStart === el.value.length;
    if (isModEnter(e)) {
      e.preventDefault();
      openPage();
      return;
    }
    switch (e.key) {
      case "Enter":
      case "ArrowUp":
      case "ArrowDown":
        commit();
        onKeyDown(e);
        return;
      case "ArrowLeft":
        if (atStart) onKeyDown(e);
        return;
      case "ArrowRight":
        if (atEnd) onKeyDown(e);
        return;
      case "Backspace":
      case "Delete":
        // Only an empty title passes the key on (deleting the block, with undo).
        if (el.value === "") onKeyDown(e);
        return;
      case "Escape":
        commit();
        onKeyDown(e);
        return;
      default:
        if (e.key === "z" && (e.metaKey || e.ctrlKey)) onKeyDown(e);
    }
  };

  return (
    <div
      data-drop-list-id={id}
      className="group/sublist my-0.5 flex items-center gap-2 rounded-md py-1 pr-1 hover:bg-surface-hover data-[drop-target]:bg-accent-soft data-[drop-target]:ring-2 data-[drop-target]:ring-accent"
    >
      <ListIcon emoji={list?.emoji ?? null} />
      <input
        data-atomic
        value={draft}
        maxLength={200}
        aria-label={t("editor.sublist.title")}
        placeholder={t("editor.sublist.placeholder")}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={onKey}
        className="min-w-0 flex-1 bg-transparent text-body font-medium text-text outline-none placeholder:text-text-subtle"
      />
      {open > 0 && (
        <span className="shrink-0 text-meta text-text-muted tabular-nums">
          <span aria-hidden>{open}</span>
          <span className="sr-only">{t("editor.sublist.openTasks", { count: open })}</span>
        </span>
      )}
      <button
        type="button"
        onClick={openPage}
        aria-label={t("editor.sublist.open", { title: draft || t("editor.sublist.placeholder") })}
        className={cn(
          "flex size-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-selected hover:text-text [&_svg]:size-4",
          "focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none",
        )}
      >
        <ChevronRight aria-hidden />
      </button>
    </div>
  );
}

const isModEnter = (e: KeyboardEvent) => e.key === "Enter" && (e.metaKey || e.ctrlKey);
