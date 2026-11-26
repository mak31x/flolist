import {
  Avatar,
  EmptyState,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Pill,
  Tooltip,
  cn,
} from "@flolist/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Lock, MoreHorizontal, Star, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMe } from "../auth/hooks.ts";
import { useListChannel } from "../sync/live-sync-context.ts";
import { t } from "../../i18n/index.ts";
import { useShell } from "../../shell/ui-store.ts";
import { BlockEditor } from "../editor/BlockEditor.tsx";
import { focusFirstBlock } from "../editor/focus.ts";
import { listQuery, listsKey, sidebarQuery } from "./api.ts";
import { DeleteListDialog } from "./DeleteListDialog.tsx";
import { EmojiPickerPopover } from "./EmojiPicker.tsx";
import { ListIcon } from "./ListIcon.tsx";
import { markOpened, useDeleteList, usePutEntry, useUnstar, useUpdateList } from "./mutations.ts";
import type { ListIndexItem } from "@flolist/shared";

/** `/lists/:listId` (lists-and-blocks.md → Lists): header, title and the block editor. */
export function ListPage() {
  const { listId } = useParams({ strict: false });
  if (!listId) return null;
  return <ListPageFor key={listId} listId={listId} />;
}

function ListPageFor({ listId }: { listId: string }) {
  const qc = useQueryClient();
  const fromIndex = qc.getQueryData<ListIndexItem[]>(listsKey)?.find((l) => l.id === listId);
  const { data: list, isPending } = useQuery({
    ...listQuery(listId),
    ...(fromIndex ? { initialData: fromIndex } : {}),
  });
  useListChannel(listId);

  const opened = useRef(false);
  useEffect(() => {
    if (list && !opened.current) {
      opened.current = true;
      markOpened(qc, listId);
    }
  }, [list, listId, qc]);

  if (isPending) return null;
  if (!list) {
    return (
      <div className="w-full max-w-[820px] px-5 pt-5 md:px-12 md:pt-14">
        <h1 className="sr-only">{t("lists.untitled")}</h1>
        <EmptyState
          action={
            <Link to="/all-lists" className="text-body font-semibold text-accent hover:underline">
              {t("allLists.tab.all")}
            </Link>
          }
        >
          {t("lists.notFound")}
        </EmptyState>
      </div>
    );
  }
  return <ListDocument list={list} />;
}

function ListDocument({ list }: { list: ListIndexItem }) {
  const updateList = useUpdateList(list.id);
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="w-full max-w-[820px] px-5 pt-5 pb-28 md:px-12 md:pt-10 md:pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <EmojiPickerPopover
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          canRemove={list.emoji !== null}
          onSelect={(emoji) => {
            updateList.mutate({ emoji });
          }}
        >
          <button
            type="button"
            aria-label={t("lists.changeEmoji")}
            className="group flex size-12 cursor-pointer items-center justify-center rounded-xl hover:bg-surface-hover"
          >
            <ListIcon emoji={list.emoji} size="lg" />
          </button>
        </EmojiPickerPopover>
        <ListHeaderActions list={list} />
      </div>
      <ListTitle list={list} />
      <div className="mt-6">
        <BlockEditor
          listId={list.id}
          rootListId={list.rootListId}
          onExitTop={() => {
            document.querySelector<HTMLTextAreaElement>("[data-list-title]")?.focus();
          }}
        />
      </div>
    </div>
  );
}

/**
 * The title edits in place and saves as you type (debounced), on Enter and on blur. A remote
 * change shows up unless the field has focus.
 */
function ListTitle({ list }: { list: ListIndexItem }) {
  const updateList = useUpdateList(list.id);
  const focusTitleOf = useShell((s) => s.focusTitleOf);
  const setFocusTitleOf = useShell((s) => s.setFocusTitleOf);
  const [draft, setDraft] = useState(list.title);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [seenTitle, setSeenTitle] = useState(list.title);

  if (list.title !== seenTitle) {
    // The title changed elsewhere (or our own save landed): show it unless we're typing.
    setSeenTitle(list.title);
    if (!focused) setDraft(list.title);
  }

  useEffect(() => {
    if (focusTitleOf === list.id) {
      ref.current?.focus();
      setFocusTitleOf(null);
    }
  }, [focusTitleOf, list.id, setFocusTitleOf]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${String(el.scrollHeight)}px`;
  }, [draft]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const save = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = value.replace(/\s+/g, " ").trim();
    if (next === list.title) return;
    updateList.mutate({ title: next });
  };

  return (
    <>
      <h1 className="sr-only">{list.title || t("lists.untitled")}</h1>
      <textarea
        ref={ref}
        aria-label={t("lists.titleLabel")}
        data-list-title
        rows={1}
        maxLength={200}
        value={draft}
        placeholder={t("lists.titlePlaceholder")}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
          save(draft);
        }}
        onChange={(e) => {
          const value = e.target.value.replace(/\n/g, " ");
          setDraft(value);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            save(value);
          }, 600);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || (e.key === "ArrowDown" && atEnd(e.currentTarget))) {
            // Enter and ↓ continue into the list's first block (keyboard-first writing).
            e.preventDefault();
            save(draft);
            if (!focusFirstBlock()) e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.currentTarget.blur();
          }
        }}
        className={cn(
          "mt-3 block w-full resize-none overflow-hidden bg-transparent font-display text-[30px] leading-[38px] font-extrabold tracking-[-0.02em] text-text outline-none md:text-page-title",
          "placeholder:text-text-subtle",
        )}
      />
    </>
  );
}

const atEnd = (el: HTMLTextAreaElement) =>
  el.selectionStart === el.value.length && el.selectionEnd === el.value.length;

function ListHeaderActions({ list }: { list: ListIndexItem }) {
  const me = useMe();
  const navigate = useNavigate();
  const { data: sidebar } = useQuery(sidebarQuery);
  const putEntry = usePutEntry();
  const unstar = useUnstar();
  const deleteList = useDeleteList();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const starred = sidebar?.entries.some((e) => e.listId === list.id) ?? false;
  const created = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(list.createdAt),
  );

  return (
    <div className="flex items-center gap-1.5">
      <Tooltip content={t("lists.privateHint")}>
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-text-muted [&_svg]:size-3.5">
          <Lock aria-hidden />
          {t("lists.private")}
        </span>
      </Tooltip>
      <Pill
        aria-pressed={starred}
        aria-label={starred ? t("lists.unstar") : t("lists.star")}
        active={starred}
        disabled={!sidebar}
        icon={<Star className={cn(starred && "fill-current text-accent")} />}
        onClick={() => {
          if (starred) unstar.mutate(list.id);
          else putEntry.star(list.id);
        }}
      />
      <Menu>
        <MenuTrigger asChild>
          <Pill aria-label={t("lists.moreActions")} icon={<MoreHorizontal />} />
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem
            icon={<Trash2 />}
            destructive
            onSelect={() => {
              setConfirmDelete(true);
            }}
          >
            {t("lists.delete")}
          </MenuItem>
          <MenuSeparator />
          <div className="flex items-center gap-1.5 px-2 py-1.5 text-meta text-text-subtle">
            <Avatar id={me.id} name={me.name} imageUrl={me.avatarUrl} size={16} />
            {t("lists.createdBy", { name: me.name, date: created })}
          </div>
        </MenuContent>
      </Menu>
      <DeleteListDialog
        title={list.title}
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onConfirm={() => {
          deleteList.mutate(list.id);
          void navigate({ to: "/all-lists" });
        }}
      />
    </div>
  );
}
