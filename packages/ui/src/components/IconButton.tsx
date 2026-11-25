import type { ComponentProps, ReactNode } from "react";
import { cn } from "../cn.ts";
import { Tooltip } from "./Tooltip.tsx";

export type IconButtonVariant = "chip" | "ghost" | "dark";

const variants: Record<IconButtonVariant, string> = {
  chip: "bg-chip text-text hover:bg-chip-hover",
  ghost: "bg-transparent text-text-muted hover:bg-chip hover:text-text",
  dark: "bg-control-dark text-on-control-dark hover:opacity-90",
};

export type IconButtonProps = Omit<ComponentProps<"button">, "children"> & {
  /** Accessible name; also the tooltip text. */
  label: string;
  icon: ReactNode;
  /** Shortcut shown in the tooltip, e.g. "Mod+F". */
  shortcut?: string;
  variant?: IconButtonVariant;
  size?: "sm" | "md";
  /** Set false to skip the tooltip (e.g. when wrapped by a menu trigger that has its own). */
  tooltip?: boolean;
};

/** Circular icon-only button (28px; 24px for `sm`). */
export function IconButton({
  label,
  icon,
  shortcut,
  variant = "ghost",
  size = "md",
  tooltip = true,
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  const button = (
    <button
      type={type}
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-(--motion-fast) disabled:cursor-default disabled:opacity-50",
        size === "md" ? "size-7 [&_svg]:size-4" : "size-6 [&_svg]:size-3.5",
        variants[variant],
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip content={label} {...(shortcut ? { shortcut } : {})}>
      {button}
    </Tooltip>
  );
}
