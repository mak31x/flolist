import { Popover as PopoverPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../cn.ts";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

/** Shared surface for popovers and menus (ui-design §3–4): 12px radius, soft large shadow. */
export const floatingSurface =
  "z-50 rounded-popover bg-surface-raised text-text shadow-popover outline-none fl-pop";

export type PopoverContentProps = ComponentProps<typeof PopoverPrimitive.Content>;

export function PopoverContent({
  className,
  sideOffset = 6,
  align = "start",
  ...props
}: PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(floatingSurface, "p-3", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
