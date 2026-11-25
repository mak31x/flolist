import { brand } from "@flolist/ui";
import type { ReactNode } from "react";

/** Centred card with the wordmark for every signed-out screen (settings-and-account.md → Authentication screens). */
export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10 pt-[max(2.5rem,env(safe-area-inset-top))]">
      <main className="w-full max-w-[400px] rounded-card bg-surface-raised p-6 shadow-popover sm:p-8">
        <p className="font-display text-[22px] font-bold text-accent">{brand.wordmark}</p>
        <h1 className="mt-6 font-display text-[24px] leading-tight font-bold text-text">{title}</h1>
        {description && <div className="mt-2 text-[14px] text-text-muted">{description}</div>}
        <div className="mt-6">{children}</div>
      </main>
      {footer && <div className="mt-6 text-center text-[14px] text-text-muted">{footer}</div>}
    </div>
  );
}

/** Inline form-level message (errors and confirmations), announced to screen readers. */
export function FormMessage({ tone, children }: { tone: "error" | "info"; children: ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "error"
          ? "rounded-[10px] bg-surface-sunken px-3 py-2 text-[13px] text-danger"
          : "rounded-[10px] bg-info-soft px-3 py-2 text-[13px] text-text"
      }
    >
      {children}
    </p>
  );
}

/** "or" between Google and the email form. */
export function OrDivider() {
  return (
    <div className="my-5 flex items-center gap-3 text-[12px] text-text-subtle" aria-hidden>
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
