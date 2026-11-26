import type { ListIndexItem } from "@flolist/shared";
import {
  EmptyState,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Pill,
  SegmentedTabs,
  cn,
} from "@flolist/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowDownUp,
  Check,
  ExternalLink,
  Lock,
  MoreHorizontal,
  Plus,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useMe } from "../auth/hooks.ts";
import { t, type MessageKey } from "../../i18n/index.ts";
import { Page } from "../../views/Page.tsx";
import { listsQuery, sidebarQuery } from "./api.ts";
import { DeleteListDialog } from "./DeleteListDialog.tsx";
import { ListIcon } from "./ListIcon.tsx";
import { useDeleteList, usePutEntry, useUnstar } from "./mutations.ts";
import { sortLists, type Sort } from "./sort-lists.ts";
import { useCreateAndOpenList } from "./use-create-and-open.ts";

type Tab = "all" | "shared" | "private";

const sorts: { id: Sort; label: MessageKey }[] = [
  { id: "created", label: "allLists.sort.created" },
  { id: "alphabetical", label: "allLists.sort.alphabetical" },
  { id: "opened", label: "allLists.sort.opened" },
];

const TIP_KEY = "flolist.tip.allLists";

function tipDismissed(): boolean {
  try {
    return localStorage.getItem(TIP_KEY) === "dismissed";
  } catch {
    return false;
  }
}

/** `/all-lists`, titled "Lists" (views.md → All lists). */
export function AllListsPage() {
  const { data: lists } = useQuery(listsQuery);
  const createList = useCreateAndOpenList();
  const [sort, setSort] = useState<Sort>("created");
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [showTip, setShowTip] = useState(() => !tipDismissed());

  const visible = useMemo(() => {
    // Sharing arrives in M7.2: every list is private until then.
    const roots = (lists ?? []).filter((l) => l.parentListId === null);
    const inTab = tab === "shared" ? [] : roots;
    const q = query.trim().toLocaleLowerCase();
    const matched = q
      ? inTab.filter((l) => (l.title || t("lists.untitled")).toLocaleLowerCase().includes(q))
      : inTab;
    return sortLists(matched, sort);
  }, [lists, tab, query, sort]);

  const currentSort = sorts.find((s) => s.id === sort);

  return (
    <Page
      title="Lists"
      actions={
        <div className="flex items-center gap-1.5">
          <Menu>
            <MenuTrigger asChild>
              <Pill icon={<ArrowDownUp />} aria-label={t("allLists.sort")}>
                {currentSort ? t(currentSort.label) : null}
              </Pill>
            </MenuTrigger>
            <MenuContent align="end">
              {sorts.map((s) => (
                <MenuItem
                  key={s.id}
                  onSelect={() => {
                    setSort(s.id);
                  }}
                  trailing={s.id === sort ? <Check aria-label={t("common.selected")} /> : undefined}
                >
                  {t(s.label)}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
          <Pill
            icon={<Plus />}
            onClick={() => {
              createList();
            }}
          >
            {t("allLists.addList")}
          </Pill>
        </div>
      }
    >
      {showTip && (
        <div className="mb-5 flex items-start gap-3 rounded-lg bg-info-soft px-4 py-3 text-body text-text">
          <Star aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
          <p className="flex-1">{t("allLists.tip")}</p>
          <IconButton
            size="sm"
            label={t("allLists.dismissTip")}
            icon={<X />}
            onClick={() => {
              setShowTip(false);
              try {
                localStorage.setItem(TIP_KEY, "dismissed");
              } catch {
                // Private mode: the tip comes back next time, which is fine.
              }
            }}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          label={t("allLists.filter")}
          tabs={[
            { value: "all", label: t("allLists.tab.all") },
            { value: "shared", label: t("allLists.tab.shared") },
            { value: "private", label: t("allLists.tab.private") },
          ]}
          value={tab}
          onValueChange={(v) => {
            setTab(v);
          }}
        />
        <label className="flex h-8 w-full items-center gap-2 rounded-full bg-chip px-3 sm:w-56">
          <Search aria-hidden className="size-3.5 shrink-0 text-text-muted" />
          <input
            type="search"
            aria-label={t("allLists.search")}
            placeholder={t("allLists.search")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            className="min-w-0 flex-1 bg-transparent text-body text-text outline-none placeholder:text-text-subtle"
          />
        </label>
      </div>

      {lists && visible.length === 0 ? (
        <EmptyState className="mt-6">
          {query.trim()
            ? t("allLists.noMatch", { query: query.trim() })
            : t(tab === "shared" ? "allLists.emptyShared" : "allLists.empty")}
        </EmptyState>
      ) : (
        <ul aria-label="Lists" className="mt-4 flex flex-col">
          {visible.map((list) => (
            <ListRow key={list.id} list={list} />
          ))}
        </ul>
      )}
    </Page>
  );
}

function ListRow({ list }: { list: ListIndexItem }) {
  const me = useMe();
  const navigate = useNavigate();
  const { data: sidebar } = useQuery(sidebarQuery);
  const putEntry = usePutEntry();
  const unstar = useUnstar();
  const deleteList = useDeleteList();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const starred = sidebar?.entries.some((e) => e.listId === list.id) ?? false;
  const title = list.title || t("lists.untitled");

  return (
    <li className="group flex h-11 items-center gap-3 border-b border-border px-1 last:border-b-0">
      <ListIcon emoji={list.emoji} />
      <Link
        to="/lists/$listId"
        params={{ listId: list.id }}
        className={cn(
          "min-w-0 flex-1 truncate text-body font-medium hover:underline",
          !list.title && "text-text-subtle",
        )}
      >
        {title}
      </Link>
      {list.createdBy !== me.id && (
        <span className="text-secondary text-text-subtle">{list.createdBy}</span>
      )}
      <Lock aria-label={t("lists.private")} className="size-3.5 shrink-0 text-text-subtle" />
      <IconButton
        size="sm"
        label={starred ? t("lists.unstar") : t("lists.star")}
        aria-pressed={starred}
        disabled={!sidebar}
        icon={<Star className={cn(starred && "fill-current text-accent")} />}
        onClick={() => {
          if (starred) unstar.mutate(list.id);
          else putEntry.star(list.id);
        }}
      />
      <Menu>
        <MenuTrigger asChild>
          <IconButton
            size="sm"
            label={`${t("lists.moreActions")}: ${title}`}
            icon={<MoreHorizontal />}
            tooltip={false}
            className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100"
          />
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem
            icon={<ExternalLink />}
            onSelect={() => {
              void navigate({ to: "/lists/$listId", params: { listId: list.id } });
            }}
          >
            {t("lists.open")}
          </MenuItem>
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
        </MenuContent>
      </Menu>
      <DeleteListDialog
        title={list.title}
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onConfirm={() => {
          deleteList.mutate(list.id);
        }}
      />
    </li>
  );
}
