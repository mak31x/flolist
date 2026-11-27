import { normalizeLabelName, type Label } from "@flolist/shared";
import { cn } from "@flolist/ui";
import { useQuery } from "@tanstack/react-query";
import { Check, Plus } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import { t } from "../../i18n/index.ts";
import { LabelDot } from "./LabelChip.tsx";
import { labelsOf, labelsQuery, newLabelId, useCreateLabel } from "./labels-api.ts";

export interface LabelPickerProps {
  workspaceId: string;
  value: readonly string[];
  onChange: (labelIds: string[]) => void;
}

type Option = { kind: "label"; label: Label } | { kind: "create"; name: string };

/**
 * Search, toggle and create labels for one task (tasks.md → Labels). Typing filters; Enter
 * toggles the active option, or creates the typed name when no label has it.
 */
export function LabelPicker({ workspaceId, value, onChange }: LabelPickerProps) {
  const { data } = useQuery(labelsQuery);
  const create = useCreateLabel();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();

  const name = normalizeLabelName(query);
  const all = labelsOf(data, workspaceId);
  const needle = name.toLowerCase();
  const matches = needle ? all.filter((l) => l.name.toLowerCase().includes(needle)) : all;
  const exact = all.some((l) => l.name.toLowerCase() === needle);
  const options: Option[] = [
    ...matches.map((label) => ({ kind: "label" as const, label })),
    ...(name && !exact ? [{ kind: "create" as const, name }] : []),
  ];
  const current = Math.min(active, Math.max(0, options.length - 1));

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  const choose = async (option: Option) => {
    if (option.kind === "label") {
      toggle(option.label.id);
      return;
    }
    setQuery("");
    try {
      // Wait for the label to exist: the task can only reference saved labels.
      const label = await create.mutateAsync({ id: newLabelId(), workspaceId, name: option.name });
      if (!value.includes(label.id)) onChange([...value, label.id]);
    } catch {
      // The mutation rolled back and toasted.
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (options.length === 0) return;
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActive((current + delta + options.length) % options.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = options[current];
      if (option) void choose(option);
    }
  };

  const optionId = (i: number) => `${listId}-${String(i)}`;
  return (
    <div className="flex w-64 flex-col gap-1">
      <input
        autoFocus
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-activedescendant={options.length > 0 ? optionId(current) : undefined}
        aria-label={t("labels.search")}
        placeholder={t("labels.search")}
        value={query}
        onChange={(e) => {
          setQuery(e.currentTarget.value);
          setActive(0);
        }}
        onKeyDown={onKey}
        className="h-8 rounded-md bg-chip px-2 text-[13px] text-text outline-none placeholder:text-text-subtle focus-visible:ring-2 focus-visible:ring-focus-ring"
      />
      <ul
        id={listId}
        role="listbox"
        aria-multiselectable
        aria-label={t("labels.chip")}
        className="max-h-60 overflow-y-auto"
      >
        {options.length === 0 && (
          <li className="px-2 py-1.5 text-meta text-text-muted">
            {all.length === 0 ? t("labels.empty") : t("labels.noMatch")}
          </li>
        )}
        {options.map((option, i) => {
          const selected = option.kind === "label" && value.includes(option.label.id);
          return (
            <li
              key={option.kind === "label" ? option.label.id : "create"}
              id={optionId(i)}
              role="option"
              aria-selected={selected}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus in the search field
              }}
              onMouseEnter={() => {
                setActive(i);
              }}
              onClick={() => void choose(option)}
              className={cn(
                "flex h-[30px] cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] [&_svg]:size-4",
                i === current && "bg-surface-hover",
              )}
            >
              {option.kind === "label" ? (
                <>
                  <span className="flex size-4 items-center justify-center text-text-muted">
                    {selected && <Check aria-hidden />}
                  </span>
                  <LabelDot color={option.label.color} />
                  <span className="truncate">{option.label.name}</span>
                </>
              ) : (
                <>
                  <Plus aria-hidden className="text-text-muted" />
                  <span className="truncate">{t("labels.create", { name: option.name })}</span>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
