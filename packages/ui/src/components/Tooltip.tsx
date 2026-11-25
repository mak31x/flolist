import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ReactNode } from "react";
import { KbdHint } from "./KbdHint.tsx";

export type TooltipProps = {
  content: ReactNode;
  /** Shown after the content, e.g. "Mod+D" → "Due date ⌘D". */
  shortcut?: string;
  side?: "top" | "right" | "bottom" | "left";
  children: ReactNode;
};

/** Hover/focus tooltip. Requires <UiProvider> (Tooltip.Provider) above it. */
export function Tooltip({ content, shortcut, side = "bottom", children }: TooltipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-50 flex items-center gap-2 rounded-lg bg-toast px-2 py-1 text-secondary text-on-toast shadow-popover fl-fade"
        >
          {content}
          {shortcut && <KbdHint shortcut={shortcut} tone="inverse" />}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
