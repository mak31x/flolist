import type { ReactNode } from "react";
import { cn } from "../cn.ts";

export type EmptyStateProps = {
  /** One helpful sentence. */
  children: ReactNode;
  illustration?: ReactNode;
  action?: ReactNode;
  className?: string;
};

/** Hand-drawn style line illustration (grey) — the default when none is given. */
export function DefaultIllustration() {
  return (
    <svg
      viewBox="0 0 120 90"
      aria-hidden
      className="h-[90px] w-[120px] text-text-subtle"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 70c-6-1-9-6-7-11 2-6 9-7 13-4 1-9 10-15 19-12 5-9 18-11 26-4 8-4 19 1 20 11 8 0 13 6 11 13-1 5-6 8-11 8H24" />
      <path d="M44 52c3 3 6 3 9 0M66 52c3 3 6 3 9 0" />
      <path d="M54 62c3 2 8 2 11 0" />
      <path d="M96 18l3-6M104 24l6-2M90 14l-1-6" />
    </svg>
  );
}

export function EmptyState({ children, illustration, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn("flex flex-col items-center gap-3 px-6 py-12 text-center fl-fade", className)}
    >
      {illustration ?? <DefaultIllustration />}
      <p className="max-w-[320px] text-body text-text-muted">{children}</p>
      {action}
    </div>
  );
}
