import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  positionAt,
  positionBetween,
  type ListIndexItem,
  type Section,
  type Sidebar,
} from "@flolist/shared";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  IconButton,
  cn,
} from "@flolist/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronDown,
  ExternalLink,
  FolderPlus,
  Pencil,
  Plus,
  Smile,
  StarOff,
  Trash2,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { t } from "../../i18n/index.ts";
import { useShell } from "../../shell/ui-store.ts";
import { listsQuery, sidebarQuery } from "./api.ts";
import { entriesOf } from "./cache.ts";
import { DeleteListDialog } from "./DeleteListDialog.tsx";
import { EmojiPickerPopover } from "./EmojiPicker.tsx";
import { InlineRename } from "./InlineRename.tsx";
import { ListIcon } from "./ListIcon.tsx";
import {
  useCreateSection,
  useDeleteList,
  useDeleteSection,
  usePutEntry,
  useUnstar,
  useUpdateList,
  useUpdateSection,
} from "./mutations.ts";
import { useCreateAndOpenList } from "./use-create-and-open.ts";

const sectionDragId = (id: string) => `section:${id}`;
const entryDragId = (listId: string) => `entry:${listId}`;

type DragData =
  { type: "section"; sectionId: string } | { type: "entry"; sectionId: string; listId: string };

/** Menu items open rename fields and pickers that take focus; don't pull it back to the row. */
const keepFocusWhereItIs = (e: Event) => {
  e.preventDefault();
};

const dragData = (data: unknown) => data as DragData | undefined;

/** Section id → list ids, in display order. */
type Columns = Record<string, string[]>;

function columnsOf(sidebar: Sidebar): Columns {
  const cols: Columns = {};
  for (const s of sidebar.sections) cols[s.id] = entriesOf(sidebar, s.id).map((e) => e.listId);
  return cols;
}

/**
 * Entries prefer the entry under the pointer, then the section under it (an empty or collapsed
 * section takes the drop at its end). Sections only collide with sections. Keyboard drags have
 * no pointer and fall back to the closest centre.
 */
const collision: CollisionDetection = (args) => {
  const kind = dragData(args.active.data.current)?.type;
  const of = (type: DragData["type"]) =>
    args.droppableContainers.filter((c) => dragData(c.data.current)?.type === type);
  if (kind === "section") return closestCenter({ ...args, droppableContainers: of("section") });
  const hits = pointerWithin(args);
  const entryIds = new Set(of("entry").map((c) => c.id));
  const entryHits = hits.filter((h) => entryIds.has(h.id));
  if (entryHits.length > 0) return entryHits;
  if (hits.length > 0) return hits;
  return closestCenter({ ...args, droppableContainers: [...of("entry"), ...of("section")] });
};

/**
 * Favorites and the user's own sections (views.md → Sidebar §3): starred lists, collapse,
 * hover actions, context menus, and drag to reorder lists and sections or move lists between
 * sections. Everything is optimistic and syncs live.
 */
export function SidebarLists({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  const sidebar = useQuery(sidebarQuery).data;
  const lists = useQuery(listsQuery).data;
  const putEntry = usePutEntry();
  const updateSection = useUpdateSection();

  const byId = useMemo(() => new Map((lists ?? []).map((l) => [l.id, l])), [lists]);
  const [draft, setDraft] = useState<Columns | null>(null);
  const [active, setActive] = useState<DragData | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  );

  if (!sidebar) return null;
  const columns = draft ?? columnsOf(sidebar);
  const sectionIds = sidebar.sections.map((s) => s.id);

  const sectionOfOver = (overData: DragData | undefined) => overData?.sectionId;

  const onDragStart = ({ active: a }: DragStartEvent) => {
    setActive(dragData(a.data.current) ?? null);
    setDraft(columnsOf(sidebar));
  };

  /** Moves an entry into another section's column while dragging, so it previews there. */
  const onDragOver = ({ active: a, over }: DragOverEvent) => {
    const data = dragData(a.data.current);
    const overData = dragData(over?.data.current);
    if (data?.type !== "entry" || !over || !draft) return;
    const from = Object.keys(draft).find((k) => draft[k]?.includes(data.listId));
    const to = sectionOfOver(overData);
    if (!from || !to || from === to) return;
    const target = draft[to] ?? [];
    const index =
      overData?.type === "entry" ? Math.max(0, target.indexOf(overData.listId)) : target.length;
    setDraft({
      ...draft,
      [from]: (draft[from] ?? []).filter((id) => id !== data.listId),
      [to]: [...target.slice(0, index), data.listId, ...target.slice(index)],
    });
  };

  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    const data = dragData(a.data.current);
    const overData = dragData(over?.data.current);
    const cols = draft;
    setDraft(null);
    setActive(null);
    if (!data || !over || !cols) return;

    if (data.type === "section") {
      const to = overData?.sectionId;
      if (!to || to === data.sectionId) return;
      // Its index among all sections is also the slot among the others: dropping on a later
      // section lands after it, on an earlier one before it.
      const index = sectionIds.indexOf(to);
      const others = sidebar.sections.filter((s) => s.id !== data.sectionId);
      updateSection.mutate({ id: data.sectionId, position: positionAt(others, index) });
      return;
    }

    const sectionId = Object.keys(cols).find((k) => cols[k]?.includes(data.listId));
    if (!sectionId) return;
    let order = cols[sectionId] ?? [];
    if (overData?.type === "entry" && overData.listId !== data.listId) {
      const fromIndex = order.indexOf(data.listId);
      const toIndex = order.indexOf(overData.listId);
      if (fromIndex >= 0 && toIndex >= 0) order = arrayMove(order, fromIndex, toIndex);
    }
    const index = order.indexOf(data.listId);
    const positions = new Map(sidebar.entries.map((e) => [e.listId, e.position]));
    const before = index > 0 ? (positions.get(order[index - 1] ?? "") ?? null) : null;
    const after = positions.get(order[index + 1] ?? "") ?? null;
    const current = sidebar.entries.find((e) => e.listId === data.listId);
    const unchanged =
      current?.sectionId === sectionId &&
      (before === null || current.position > before) &&
      (after === null || current.position < after);
    if (unchanged) return;
    putEntry.move(data.listId, sectionId, positionBetween(before, after));
  };

  const overlayList = active?.type === "entry" ? (byId.get(active.listId) ?? null) : null;
  const overlaySection =
    active?.type === "section" ? sidebar.sections.find((s) => s.id === active.sectionId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDraft(null);
        setActive(null);
      }}
    >
      <SortableContext items={sectionIds.map(sectionDragId)} strategy={verticalListSortingStrategy}>
        <div className="mt-6 flex flex-col gap-3">
          {sidebar.sections.map((section, i) => (
            <SidebarSection
              key={section.id}
              section={section}
              next={sidebar.sections[i + 1]}
              listIds={columns[section.id] ?? []}
              byId={byId}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {overlayList ? (
          <div className="flex h-8 items-center gap-2.5 rounded-lg bg-surface-raised px-2 text-body font-medium shadow-lifted">
            <ListIcon emoji={overlayList.emoji} />
            <span className="truncate">{overlayList.title || t("lists.untitled")}</span>
          </div>
        ) : overlaySection ? (
          <div className="flex h-7 items-center rounded-md bg-surface-raised px-2 text-secondary font-semibold text-text-muted shadow-lifted">
            {overlaySection.title}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function SidebarSection({
  section,
  next,
  listIds,
  byId,
  onNavigate,
}: {
  section: Section;
  next: Section | undefined;
  listIds: string[];
  byId: Map<string, ListIndexItem>;
  onNavigate: (() => void) | undefined;
}) {
  const updateSection = useUpdateSection();
  const deleteSection = useDeleteSection();
  const createSection = useCreateSection();
  const createList = useCreateAndOpenList();
  const renaming = useShell((s) => s.renaming);
  const setRenaming = useShell((s) => s.setRenaming);
  const isRenaming = renaming?.kind === "section" && renaming.id === section.id;
  const { setNodeRef, setActivatorNodeRef, listeners, transform, transition, isDragging } =
    useSortable({
      id: sectionDragId(section.id),
      data: { type: "section", sectionId: section.id } satisfies DragData,
    });

  const headingId = `sidebar-section-${section.id}`;
  const visible = listIds.filter((id) => byId.has(id));
  const newSectionBelow = () => {
    const id = createSection.create(
      t("sidebar.defaultSectionTitle"),
      positionBetween(section.position, next?.position ?? null),
    );
    setRenaming({ kind: "section", id });
  };

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && "opacity-40")}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={setActivatorNodeRef}
            {...listeners}
            className="group/section flex h-7 items-center gap-1 rounded-md pr-1 outline-none"
          >
            {isRenaming ? (
              <InlineRename
                value={section.title}
                label={t("sidebar.sectionTitle")}
                required
                onCommit={(title) => {
                  updateSection.mutate({ id: section.id, title });
                }}
                onDone={() => {
                  setRenaming(null);
                }}
              />
            ) : (
              <button
                type="button"
                id={headingId}
                aria-expanded={!section.collapsed}
                aria-label={t(section.collapsed ? "sidebar.expand" : "sidebar.collapse", {
                  section: section.title,
                })}
                onClick={() => {
                  updateSection.mutate({ id: section.id, collapsed: !section.collapsed });
                }}
                onDoubleClick={() => {
                  setRenaming({ kind: "section", id: section.id });
                }}
                className="flex h-7 min-w-0 cursor-pointer items-center gap-1 rounded-md px-2 text-secondary font-semibold text-text-muted hover:text-text"
              >
                <span className="truncate">{section.title}</span>
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "size-3.5 shrink-0 transition-transform duration-(--motion-fast)",
                    section.collapsed && "-rotate-90",
                  )}
                />
              </button>
            )}
            <span className="flex-1" />
            {!isRenaming && (
              <span className="flex opacity-0 transition-opacity group-focus-within/section:opacity-100 group-hover/section:opacity-100 max-md:opacity-100">
                <IconButton
                  size="sm"
                  label={t("sidebar.newListIn", { section: section.title })}
                  icon={<Plus />}
                  onClick={() => {
                    onNavigate?.();
                    createList({ sectionId: section.id });
                  }}
                />
                <IconButton
                  size="sm"
                  label={t("sidebar.newSection")}
                  icon={<FolderPlus />}
                  onClick={newSectionBelow}
                />
              </span>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent onCloseAutoFocus={keepFocusWhereItIs}>
          <ContextMenuItem
            icon={<Pencil />}
            onSelect={() => {
              setRenaming({ kind: "section", id: section.id });
            }}
          >
            {t("sidebar.renameSection")}
          </ContextMenuItem>
          <ContextMenuItem icon={<FolderPlus />} onSelect={newSectionBelow}>
            {t("sidebar.newSectionBelow")}
          </ContextMenuItem>
          {!section.isDefault && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                icon={<Trash2 />}
                destructive
                onSelect={() => {
                  deleteSection.mutate(section.id);
                }}
              >
                {t("sidebar.deleteSection")}
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {!section.collapsed && (
        <SortableContext items={visible.map(entryDragId)} strategy={verticalListSortingStrategy}>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {visible.map((id) => {
              const list = byId.get(id);
              return list ? (
                <SidebarEntryRow
                  key={id}
                  list={list}
                  sectionId={section.id}
                  onNavigate={onNavigate}
                />
              ) : null;
            })}
          </ul>
          {visible.length === 0 && (
            <p className="px-2 py-1.5 text-secondary text-text-subtle">
              {t(section.isDefault ? "sidebar.emptyFavorites" : "sidebar.emptySection")}
            </p>
          )}
        </SortableContext>
      )}
    </section>
  );
}

function SidebarEntryRow({
  list,
  sectionId,
  onNavigate,
}: {
  list: ListIndexItem;
  sectionId: string;
  onNavigate: (() => void) | undefined;
}) {
  const navigate = useNavigate();
  const updateList = useUpdateList(list.id);
  const unstar = useUnstar();
  const deleteList = useDeleteList();
  const renaming = useShell((s) => s.renaming);
  const setRenaming = useShell((s) => s.setRenaming);
  const isRenaming = renaming?.kind === "list" && renaming.id === list.id;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: entryDragId(list.id),
    data: { type: "entry", sectionId, listId: list.id } satisfies DragData,
  });
  const title = list.title || t("lists.untitled");
  // The row stays a link for assistive tech; dnd-kit would make it a "button".
  const dragAttributes = { ...attributes, role: undefined };

  const menu: { icon: ReactNode; label: string; run: () => void; destructive?: boolean }[] = [
    {
      icon: <ExternalLink />,
      label: t("lists.open"),
      run: () => {
        onNavigate?.();
        void navigate({ to: "/lists/$listId", params: { listId: list.id } });
      },
    },
    {
      icon: <Pencil />,
      label: t("lists.rename"),
      run: () => {
        setRenaming({ kind: "list", id: list.id });
      },
    },
    {
      icon: <Smile />,
      label: t("lists.changeEmoji"),
      run: () => {
        setPickerOpen(true);
      },
    },
    {
      icon: <StarOff />,
      label: t("lists.removeFromSidebar"),
      run: () => {
        unstar.mutate(list.id);
      },
    },
  ];

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && "opacity-40")}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="group relative flex h-8 items-center gap-1.5 rounded-lg pl-1 hover:bg-surface-hover has-[a[data-status=active]]:bg-surface-selected">
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
                aria-label={`${t("lists.changeEmoji")}: ${title}`}
                className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-chip"
              >
                <ListIcon emoji={list.emoji} />
              </button>
            </EmojiPickerPopover>
            {isRenaming ? (
              <InlineRename
                value={list.title}
                label={t("sidebar.listTitle")}
                placeholder={t("lists.titlePlaceholder")}
                onCommit={(next) => {
                  updateList.mutate({ title: next });
                }}
                onDone={() => {
                  setRenaming(null);
                }}
              />
            ) : (
              <Link
                ref={setActivatorNodeRef}
                {...dragAttributes}
                {...listeners}
                to="/lists/$listId"
                params={{ listId: list.id }}
                onClick={onNavigate}
                className={cn(
                  "flex h-8 min-w-0 flex-1 items-center truncate pr-2 text-body font-medium outline-none",
                  list.title ? "text-text" : "text-text-subtle",
                )}
              >
                <span className="truncate">{title}</span>
              </Link>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent onCloseAutoFocus={keepFocusWhereItIs}>
          {menu.map((item) => (
            <ContextMenuItem key={item.label} icon={item.icon} onSelect={item.run}>
              {item.label}
            </ContextMenuItem>
          ))}
          <ContextMenuSeparator />
          <ContextMenuItem
            icon={<Trash2 />}
            destructive
            onSelect={() => {
              setConfirmDelete(true);
            }}
          >
            {t("lists.delete")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
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
