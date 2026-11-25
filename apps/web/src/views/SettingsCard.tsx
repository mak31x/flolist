import { cn } from "@flolist/ui";
import type { ReactNode } from "react";

/** One grey settings row/card (settings-and-account.md): title + description, control at the end. */
export function SettingsCard({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 rounded-settings bg-surface-sunken p-5",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-[15px] font-bold">{title}</h2>
        {description && <div className="mt-0.5 text-body text-text-muted">{description}</div>}
      </div>
      {children}
    </section>
  );
}
