import { ToggleGroup } from "radix-ui";
import { cn } from "../cn.ts";

export type SegmentedTab<T extends string> = { value: T; label: string };

export type SegmentedTabsProps<T extends string> = {
  /** Accessible name for the group, e.g. "Filter tasks". */
  label: string;
  tabs: readonly SegmentedTab<T>[];
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
};

/** A row of pills where exactly one is active (`Open | Completed`, `All | Shared | Private`…). */
export function SegmentedTabs<T extends string>({
  label,
  tabs,
  value,
  onValueChange,
  className,
}: SegmentedTabsProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        const tab = tabs.find((t) => t.value === next);
        // Ignore "deselect": one tab is always active.
        if (tab) onValueChange(tab.value);
      }}
      className={cn("flex flex-wrap items-center gap-1.5", className)}
    >
      {tabs.map((tab) => (
        <ToggleGroup.Item
          key={tab.value}
          value={tab.value}
          className={cn(
            "inline-flex h-7 cursor-pointer items-center rounded-full border px-3 text-[13px] font-medium whitespace-nowrap",
            "transition-colors duration-(--motion-fast)",
            "data-[state=off]:border-border data-[state=off]:text-text-muted data-[state=off]:hover:bg-chip",
            "data-[state=on]:border-transparent data-[state=on]:bg-chip-active data-[state=on]:text-text",
          )}
        >
          {tab.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
