import type { ListIndexItem } from "@flolist/shared";
import { cn, Dialog, DialogContent } from "@flolist/ui";
import { useQuery } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { t } from "../../i18n/index.ts";
import { listsQuery } from "../lists/api.ts";
import { ListIcon } from "../lists/ListIcon.tsx";
import { useMoveTo, type MoveRequest } from "./move-store.ts";

/** "Parent › Child" for sublists, so same-named sublists can be told apart. */
function pathOf(list: ListIndexItem, byId: ReadonlyMap<string, ListIndexItem>): string {
  const parts: string[] = [];
  let current: ListIndexItem | undefined = list;
  while (current && parts.length < 4) {
    parts.unshift(current.title || t("lists.untitled"));
    current = current.parentListId ? byId.get(current.parentListId) : undefined;
  }
  return parts.join(" › ");
}

/** Mounted once in the app shell. A searchable list of the workspace's other lists. */
export function MoveToListDialog() {
  const request = useMoveTo((s) => s.request);
  const close = useMoveTo((s) => s.close);
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      {request && (
        <DialogContent title={t("tasks.move.title")} data-keep-selection>
          <Picker
            key={request.fromListId}
            request={request}
            onDone={(listId) => {
              close();
              request.onPick(listId);
            }}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}

function Picker({ request, onDone }: { request: MoveRequest; onDone: (id: string) => void }) {
  const { data } = useQuery(listsQuery);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listboxId = useId();
  const options = useMemo(() => {
    const items = data ?? [];
    const byId = new Map(items.map((l) => [l.id, l]));
    const needle = query.trim().toLocaleLowerCase();
    return items
      .filter((l) => l.workspaceId === request.workspaceId && l.id !== request.fromListId)
      .map((l) => ({ list: l, path: pathOf(l, byId) }))
      .filter((o) => needle === "" || o.path.toLocaleLowerCase().includes(needle))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [data, query, request]);
  const current = Math.min(active, Math.max(0, options.length - 1));
  const optionId = (i: number) => `${listboxId}-${String(i)}`;

  return (
    <div className="flex flex-col gap-2">
      <input
        autoFocus
        role="combobox"
        aria-expanded
        aria-controls={listboxId}
        aria-activedescendant={options.length > 0 ? optionId(current) : undefined}
        aria-label={t("tasks.move.search")}
        placeholder={t("tasks.move.search")}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const by = e.key === "ArrowDown" ? 1 : -1;
            setActive((current + by + options.length) % Math.max(1, options.length));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const picked = options[current];
            if (picked) onDone(picked.list.id);
          }
        }}
        className="h-10 rounded-lg border border-border bg-surface px-3 text-body text-text outline-none placeholder:text-text-subtle focus-visible:ring-2 focus-visible:ring-focus-ring"
      />
      <ul id={listboxId} role="listbox" className="max-h-[50vh] overflow-y-auto">
        {options.map((o, i) => (
          <li
            key={o.list.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === current}
            onMouseMove={() => {
              setActive(i);
            }}
            onClick={() => {
              onDone(o.list.id);
            }}
            className={cn(
              "flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-body text-text",
              i === current && "bg-surface-hover",
            )}
          >
            <ListIcon emoji={o.list.emoji} />
            <span className="truncate">{o.path}</span>
          </li>
        ))}
      </ul>
      {options.length === 0 && (
        <p className="px-2 py-3 text-body text-text-muted">
          {query.trim() ? t("tasks.move.noMatch", { query: query.trim() }) : t("tasks.move.empty")}
        </p>
      )}
    </div>
  );
}
