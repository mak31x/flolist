import type { ComponentProps, ReactNode } from "react";
import { cn } from "../cn.ts";

export type PillVariant = "chip" | "ghost" | "outline";

const variants: Record<PillVariant, string> = {
  chip: "bg-chip hover:bg-chip-hover",
  ghost: "bg-transparent hover:bg-chip",
  outline: "bg-transparent border border-border hover:bg-chip",
};

export type PillProps = ComponentProps<"button"> & {
  /** Leading icon (16px). */
  icon?: ReactNode;
  /** Trailing content, e.g. a chevron or an avatar stack. */
  trailing?: ReactNode;
  variant?: PillVariant;
  /** Pressed/selected look (filled darker grey). */
  active?: boolean;
};

/** 28px pill button (ui-design §4): "Share", "Due date ▾", "+ New task", "Sign out"… */
export function Pill({
  icon,
  trailing,
  variant = "chip",
  active = false,
  className,
  children,
  type = "button",
  ...props
}: PillProps) {
  return (
    <button
      type={type}
      data-active={active || undefined}
      className={cn(
        "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap text-text",
        "transition-colors duration-(--motion-fast) disabled:cursor-default disabled:opacity-50",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        variants[variant],
        active && "bg-chip-active hover:bg-chip-active",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
      {trailing}
    </button>
  );
}

export type ChipProps = ComponentProps<"span"> & { icon?: ReactNode };

/** Non-interactive chip, e.g. a label in a task's meta line. */
export function Chip({ icon, className, children, ...props }: ChipProps) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full bg-chip px-2 text-meta font-medium text-text-muted [&_svg]:size-3",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  );
}
