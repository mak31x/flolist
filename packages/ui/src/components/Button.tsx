import type { ComponentProps, ReactNode } from "react";
import { cn } from "../cn.ts";

export type ButtonVariant = "primary" | "secondary" | "outline";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  secondary: "bg-chip text-text hover:bg-chip-hover",
  outline: "border border-border bg-surface-raised text-text hover:bg-surface-hover",
};

export type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  /** Leading icon (16px). */
  icon?: ReactNode;
  /** Shows a busy state and blocks clicks. */
  loading?: boolean;
  /** Stretch to the container's width (forms). */
  block?: boolean;
};

/** 40px rounded button for forms and dialogs ("Log in", "Continue with Google"). */
export function Button({
  variant = "primary",
  icon,
  loading = false,
  block = false,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full px-5 text-[14px] font-semibold whitespace-nowrap",
        "transition-colors duration-(--motion-fast) disabled:cursor-default disabled:opacity-60",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        variants[variant],
        block && "w-full",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
