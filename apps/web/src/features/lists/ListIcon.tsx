import { cn } from "@flolist/ui";
import { List as ListGlyph } from "lucide-react";

/** A list's emoji, or the default list glyph when it has none. */
export function ListIcon({ emoji, size = "sm" }: { emoji: string | null; size?: "sm" | "lg" }) {
  if (emoji) {
    return (
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center leading-none",
          size === "sm" ? "size-5 text-[15px]" : "size-11 text-[34px]",
        )}
      >
        {emoji}
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[6px] bg-chip text-text-muted",
        size === "sm" ? "size-5 [&_svg]:size-3" : "size-11 rounded-[10px] [&_svg]:size-6",
      )}
    >
      <ListGlyph strokeWidth={2.25} />
    </span>
  );
}
