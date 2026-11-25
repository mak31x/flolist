import { cn } from "../cn.ts";
import { shortcutKeys } from "../shortcuts.ts";

export type KbdHintProps = {
  /** e.g. "Mod+N", "Ctrl+N", "Mod+Shift+K". */
  shortcut: string;
  tone?: "default" | "inverse";
  className?: string;
};

/** Small shortcut badge. Hidden on touch devices (desktop only, ui-design §4). */
export function KbdHint({ shortcut, tone = "default", className }: KbdHintProps) {
  const keys = shortcutKeys(shortcut);
  return (
    <kbd
      aria-label={keys.join(" ")}
      className={cn(
        "hidden h-[18px] items-center gap-0.5 rounded-[5px] px-1.5 font-sans text-meta font-medium pointer-fine:inline-flex",
        tone === "default" ? "bg-kbd text-text-muted" : "bg-on-toast/15 text-on-toast",
        className,
      )}
    >
      {keys.map((k, i) => (
        <span key={i}>{k}</span>
      ))}
    </kbd>
  );
}
