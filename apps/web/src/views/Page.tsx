import { EmptyState, KbdHint, SkeletonSquiggle, cn, isApplePlatform } from "@flolist/ui";
import { CirclePlus } from "lucide-react";
import type { ReactNode } from "react";
import { t } from "../i18n/index.ts";

type PageProps = {
  title: string;
  /** Lighter text beside the title, e.g. Today's date. */
  secondary?: string;
  actions?: ReactNode;
  /** Use the full card width (Week). */
  wide?: boolean;
  children?: ReactNode;
};

/** Main-card page: big bold title top-left with generous padding (ui-design §1–2). */
export function Page({ title, secondary, actions, wide = false, children }: PageProps) {
  return (
    <div
      className={cn("w-full px-5 pt-5 pb-28 md:px-12 md:pt-14 md:pb-16", !wide && "max-w-[820px]")}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="font-display text-[30px] leading-[38px] font-extrabold tracking-[-0.02em] text-text md:text-page-title">
          {title}
          {secondary && (
            <span className="ml-2.5 text-[0.55em] font-bold tracking-normal text-text-subtle">
              {secondary}
            </span>
          )}
        </h1>
        {actions}
      </header>
      <div className="mt-6">{children}</div>
    </div>
  );
}

/**
 * "New task ^N" row at the top of task views (ui-design §2; keyboard-shortcuts.md: ⌘N in the
 * apps, ^N on the web, Alt+N off Apple platforms).
 */
export function NewTaskRow({
  onClick,
  disabled = false,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Off until the view has loaded, so the new row can show (and take typing) at once.
      disabled={disabled}
      className="flex h-9 w-full items-center gap-2.5 rounded-lg px-1 text-body text-text-muted outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-60 disabled:hover:text-text-muted"
    >
      <CirclePlus aria-hidden className="size-4 text-accent" />
      {t("taskViews.newTask")}
      <KbdHint shortcut={isApplePlatform() ? "Ctrl+N" : "Alt+N"} />
    </button>
  );
}

/** An empty task view: skeleton squiggles and a line of text (views.md → Inbox, Today). */
export function EmptyTasks({ message }: { message: string }) {
  return (
    <>
      <SkeletonSquiggle className="mt-1" />
      <EmptyState className="py-8">{message}</EmptyState>
    </>
  );
}
