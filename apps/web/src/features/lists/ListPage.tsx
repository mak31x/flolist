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
import {
  ArrowUpRight,
  ChevronRight,
  Copy,
  Lock,
  MoreHorizontal,
  Printer,
  Settings2,
  Star,
  Trash2,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMe } from "../auth/hooks.ts";
import { useListChannel } from "../sync/live-sync-context.ts";
import { t } from "../../i18n/index.ts";
import { useShell } from "../../shell/ui-store.ts";
import { BlockEditor } from "../editor/BlockEditor.tsx";
import { focusFirstBlock } from "../editor/focus.ts";
import { listPrefsQuery, listQuery, listsKey, listsQuery, sidebarQuery } from "./api.ts";
import { DeleteListDialog } from "./DeleteListDialog.tsx";
import { EmojiPickerPopover } from "./EmojiPicker.tsx";
import { ListIcon } from "./ListIcon.tsx";
import {
  markOpened,
  useDeleteList,
  useDuplicateList,
  usePutEntry,
  useUnstar,
  useUpdateList,
  useUpdateListPrefs,
} from "./mutations.ts";
import { CustomizeListDialog } from "./CustomizeList.tsx";
import { printPage } from "../../platform/index.ts";
import { workspacesQuery } from "../workspaces/api.ts";
import { DEFAULT_LIST_VIEW_PREFS, type ListIndexItem, type ListViewPrefs } from "@flolist/shared";
import { isSorted } from "./list-view.ts";
import { ListViewMenu } from "./ListViewMenu.tsx";

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
  // Sublists share their root's channel (blocks and lists of the whole tree go there).
  useListChannel(list?.rootListId ?? listId);

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
  const updatePrefs = useUpdateListPrefs(list.id);
  const [pickerOpen, setPickerOpen] = useState(false);
  const prefs = useQuery(listPrefsQuery(list.id)).data ?? DEFAULT_LIST_VIEW_PREFS;

  return (
    <div className="w-full max-w-[820px] px-5 pt-5 pb-28 md:px-12 md:pt-10 md:pb-16">
      {list.parentListId && <Breadcrumb list={list} />}
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
        <ListHeaderActions list={list} prefs={prefs} />
      </div>
      <ListTitle list={list} />
      {isSorted(prefs) && (
        <div className="mt-3 print:hidden">
          <Pill
            aria-label={`${t("lists.view.sortedBy", { sort: t(`lists.sort.${prefs.sort}`) })}, ${t("lists.view.reset")}`}
            onClick={() => {
              updatePrefs.mutate({ sort: "manual" });
            }}
          >
            {t("lists.view.sortedBy", { sort: t(`lists.sort.${prefs.sort}`) })} ·{" "}
            <span className="font-semibold text-accent">{t("lists.view.reset")}</span>
          </Pill>
        </div>
      )}
      <div className="mt-6">
        <BlockEditor
          listId={list.id}
          rootListId={list.rootListId}
          view={prefs}
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

function ListHeaderActions({ list, prefs }: { list: ListIndexItem; prefs: ListViewPrefs }) {
  const me = useMe();
  const navigate = useNavigate();
  const { data: sidebar } = useQuery(sidebarQuery);
  const putEntry = usePutEntry();
  const unstar = useUnstar();
  const deleteList = useDeleteList();
  const duplicateList = useDuplicateList();
  const { data: workspaces } = useQuery(workspacesQuery);
  const team = workspaces?.find((w) => w.id === list.workspaceId && w.kind === "team");
  const customizing = useShell((s) => s.customizing);
  const setCustomizing = useShell((s) => s.setCustomizing);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const starred = sidebar?.entries.some((e) => e.listId === list.id) ?? false;
  const created = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(list.createdAt),
  );

  return (
    <div className="flex items-center gap-1.5 print:hidden">
      <Tooltip content={t("lists.privateHint")}>
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-text-muted [&_svg]:size-3.5">
          <Lock aria-hidden />
          {t("lists.private")}
        </span>
      </Tooltip>
      <ListViewMenu listId={list.id} prefs={prefs} />
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
            icon={<Settings2 />}
            onSelect={() => {
              setCustomizing(list.id);
            }}
          >
            {t("lists.customize")}
          </MenuItem>
          <MenuItem
            icon={<Printer />}
            onSelect={() => {
              // After the menu has closed, so it isn't in the printout.
              setTimeout(printPage, 0);
            }}
          >
            {t("lists.print")}
          </MenuItem>
          <MenuItem
            icon={<Copy />}
            onSelect={() => {
              void duplicateList(list.id).then((copy) => {
                if (copy) void navigate({ to: "/lists/$listId", params: { listId: copy } });
              });
            }}
          >
            {t("lists.duplicate")}
          </MenuItem>
          {team && (
            <>
              <MenuSeparator />
              <MenuItem
                icon={<ArrowUpRight />}
                onSelect={() => {
                  void navigate({ to: "/team/$teamId", params: { teamId: team.id } });
                }}
              >
                {t("lists.goToTeam", { name: team.name })}
              </MenuItem>
            </>
          )}
          <MenuSeparator />
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
      <CustomizeListDialog
        list={list}
        open={customizing === list.id}
        onOpenChange={(open) => {
          setCustomizing(open ? list.id : null);
        }}
      />
      <DeleteListDialog
        title={list.title}
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onConfirm={() => {
          deleteList.mutate(list.id);
          // A deleted sublist lands on its parent, a root list on All lists [assumption].
          if (list.parentListId)
            void navigate({ to: "/lists/$listId", params: { listId: list.parentListId } });
          else void navigate({ to: "/all-lists" });
        }}
      />
    </div>
  );
}

/** How many levels the breadcrumb shows before it folds the middle into "…". */
const CRUMB_LEVELS = 3;

/**
 * `Parent › Sublist` above a sublist's header (lists-and-blocks.md → Sublists). Up to three
 * levels; deeper chains keep the root and the last two, with "…" between.
 */
function Breadcrumb({ list }: { list: ListIndexItem }) {
  const { data: index } = useQuery(listsQuery);
  const chain: ListIndexItem[] = [list];
  const byId = new Map((index ?? []).map((l) => [l.id, l]));
  for (let parent = list.parentListId; parent;) {
    const found = byId.get(parent);
    if (!found || chain.includes(found)) break;
    chain.unshift(found);
    parent = found.parentListId;
  }
  const items: (ListIndexItem | "gap")[] =
    chain.length > CRUMB_LEVELS
      ? [chain[0] as ListIndexItem, "gap", ...chain.slice(-(CRUMB_LEVELS - 1))]
      : chain;
  return (
    <nav aria-label={t("lists.breadcrumb")} className="mb-2">
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-[13px] text-text-muted">
        {items.map((item, i) => (
          <li key={item === "gap" ? "gap" : item.id} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight aria-hidden className="size-3.5 shrink-0 text-text-subtle" />}
            {item === "gap" ? (
              <span aria-hidden>…</span>
            ) : item.id === list.id ? (
              <span aria-current="page" className="truncate font-medium text-text">
                {item.title || t("lists.untitled")}
              </span>
            ) : (
              <Link
                to="/lists/$listId"
                params={{ listId: item.id }}
                className="flex min-w-0 items-center gap-1 rounded px-1 hover:bg-surface-hover hover:text-text focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
              >
                <ListIcon emoji={item.emoji} />
                <span className="truncate">{item.title || t("lists.untitled")}</span>
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
