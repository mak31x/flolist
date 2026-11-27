import type { LabelColor } from "@flolist/shared";
import { Chip, cn } from "@flolist/ui";

const dotClass: Record<LabelColor, string> = {
  gray: "bg-divider-gray",
  red: "bg-divider-red",
  orange: "bg-divider-orange",
  green: "bg-divider-green",
  blue: "bg-divider-blue",
  purple: "bg-divider-purple",
};

/** The colour dot of a label (none for the default grey chip). */
export function LabelDot({ color, className }: { color: LabelColor | null; className?: string }) {
  if (!color) return null;
  return (
    <span aria-hidden className={cn("size-2 shrink-0 rounded-full", dotClass[color], className)} />
  );
}

/** A label in a task's meta line or chip row. */
export function LabelChip({ name, color }: { name: string; color: LabelColor | null }) {
  return (
    <Chip className="max-w-40">
      <LabelDot color={color} />
      <span className="truncate">{name}</span>
    </Chip>
  );
}
