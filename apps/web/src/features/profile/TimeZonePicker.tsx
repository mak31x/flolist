import { Pill, Popover, PopoverContent, PopoverTrigger, cn } from "@flolist/ui";
import { Check, ChevronDown, Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { t } from "../../i18n/index.ts";
import { timeZones } from "../../platform/index.ts";
import { zoneLabel, zoneOffset } from "./zones.ts";

interface Option {
  zone: string;
  label: string;
  offset: string;
  haystack: string;
}

/** Searchable time zone picker (a combobox in a popover). */
export function TimeZonePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (zone: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();

  const options = useMemo<Option[]>(() => {
    const now = new Date();
    return timeZones().map((zone) => {
      const label = zoneLabel(zone);
      const offset = zoneOffset(zone, now);
      return { zone, label, offset, haystack: `${zone} ${label} ${offset}`.toLowerCase() };
    });
  }, []);

  const filtered = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return words.length === 0
      ? options
      : options.filter((o) => words.every((w) => o.haystack.includes(w)));
  }, [options, query]);

  const choose = (zone: string) => {
    onChange(zone);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          setActive(
            Math.max(
              0,
              options.findIndex((o) => o.zone === value),
            ),
          );
        }
      }}
    >
      <PopoverTrigger asChild>
        <Pill trailing={<ChevronDown />} aria-label={t("profile.timezone.change", { zone: value })}>
          <span className="max-w-[46vw] truncate">{zoneLabel(value)}</span>
        </Pill>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(340px,calc(100vw-24px))] p-1.5">
        <div className="flex items-center gap-2 border-b border-border px-2 pb-1.5">
          <Search aria-hidden className="size-4 text-text-muted" />
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={filtered[active] ? `${listId}-${String(active)}` : undefined}
            aria-label={t("profile.timezone.search")}
            placeholder={t("profile.timezone.search")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(filtered.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const option = filtered[active];
                if (option) choose(option.zone);
              }
            }}
            className="h-8 flex-1 bg-transparent text-body text-text outline-none placeholder:text-text-subtle"
          />
        </div>
        <ul id={listId} role="listbox" className="mt-1 max-h-[280px] overflow-y-auto">
          {filtered.length === 0 && (
            <li className="px-2 py-2 text-body text-text-muted">{t("profile.timezone.none")}</li>
          )}
          {filtered.map((o, i) => (
            <li
              key={o.zone}
              id={`${listId}-${String(i)}`}
              role="option"
              aria-selected={o.zone === value}
              ref={i === active ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
              onMouseMove={() => {
                setActive(i);
              }}
              onClick={() => {
                choose(o.zone);
              }}
              className={cn(
                "flex h-[30px] cursor-pointer items-center gap-2 rounded-lg px-2 text-body",
                i === active && "bg-surface-hover",
              )}
            >
              <span className="flex-1 truncate">{o.label}</span>
              <span className="text-meta text-text-subtle">{o.offset}</span>
              {o.zone === value && <Check aria-hidden className="size-4 text-text-muted" />}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
