import { X } from "lucide-react";
import { Dialog as DialogPrimitive, VisuallyHidden } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../cn.ts";
import { IconButton } from "./IconButton.tsx";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

type ContentProps = Omit<ComponentProps<typeof DialogPrimitive.Content>, "title"> & {
  /** Required for screen readers; hide it visually with `hideTitle`. */
  title: ReactNode;
  description?: ReactNode;
  hideTitle?: boolean;
  /** Show the circular close X at the top-right. */
  showClose?: boolean;
};

function Heading({
  title,
  description,
  hideTitle,
}: Pick<ContentProps, "title" | "description" | "hideTitle">) {
  const titleEl = (
    <DialogPrimitive.Title className="text-[17px] font-bold">{title}</DialogPrimitive.Title>
  );
  const descEl = description ? (
    <DialogPrimitive.Description className="mt-1 text-body text-text-muted">
      {description}
    </DialogPrimitive.Description>
  ) : null;
  if (hideTitle) {
    return (
      <VisuallyHidden.Root>
        {titleEl}
        {descEl}
      </VisuallyHidden.Root>
    );
  }
  return (
    <div className="mb-4 pr-8">
      {titleEl}
      {descEl}
    </div>
  );
}

function CloseButton() {
  return (
    <DialogPrimitive.Close asChild>
      <IconButton
        label="Close"
        icon={<X />}
        variant="chip"
        tooltip={false}
        className="absolute top-3 right-3"
      />
    </DialogPrimitive.Close>
  );
}

/** Centred modal dialog. */
export function DialogContent({
  title,
  description,
  hideTitle = false,
  showClose = true,
  className,
  children,
  ...props
}: ContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay fl-fade" />
      <DialogPrimitive.Content
        className={cn(
          "fixed top-[12vh] left-1/2 z-50 w-[min(560px,calc(100vw-24px))] -translate-x-1/2 rounded-card bg-surface-raised p-5 shadow-popover outline-none fl-pop",
          className,
        )}
        {...(description ? {} : { "aria-describedby": undefined })}
        {...props}
      >
        <Heading title={title} description={description} hideTitle={hideTitle} />
        {children}
        {showClose && <CloseButton />}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export type SheetSide = "left" | "right" | "bottom";

const sheetSide: Record<SheetSide, string> = {
  left: "inset-y-0 left-0 w-[min(320px,88vw)] fl-sheet-left",
  right: "inset-y-0 right-0 w-full sm:w-[min(440px,92vw)] fl-sheet-right",
  bottom: "inset-x-0 bottom-0 max-h-[92vh] rounded-t-card fl-sheet-bottom",
};

/** Edge-anchored dialog: the mobile sidebar drawer, task details on tablet/phone. */
export function SheetContent({
  side = "left",
  title,
  description,
  hideTitle = true,
  showClose = false,
  className,
  children,
  ...props
}: ContentProps & { side?: SheetSide }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay fl-fade" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col bg-surface shadow-lifted outline-none",
          sheetSide[side],
          className,
        )}
        {...(description ? {} : { "aria-describedby": undefined })}
        {...props}
      >
        <Heading title={title} description={description} hideTitle={hideTitle} />
        {children}
        {showClose && <CloseButton />}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
