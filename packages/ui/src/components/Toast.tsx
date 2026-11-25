import { X } from "lucide-react";
import { Toast as ToastPrimitive } from "radix-ui";
import { useSyncExternalStore } from "react";
import { dismissToast, getToasts, subscribeToasts } from "./toast-store.ts";

/** Renders queued toasts at the bottom-left: dark, with an optional Undo-style action. */
export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  return (
    <ToastPrimitive.Provider swipeDirection="left" label="Notifications">
      {toasts.map((t) => (
        <ToastPrimitive.Root
          key={t.id}
          duration={t.durationMs}
          onOpenChange={(open) => {
            if (!open) dismissToast(t.id);
          }}
          className="flex min-h-10 items-center gap-3 rounded-xl bg-toast py-2 pr-2 pl-4 text-body text-on-toast shadow-lifted fl-toast"
        >
          <ToastPrimitive.Description className="flex-1">{t.message}</ToastPrimitive.Description>
          {t.action && (
            <ToastPrimitive.Action altText={t.action.label} asChild>
              <button
                type="button"
                onClick={t.action.onAction}
                className="cursor-pointer rounded-full px-2 py-1 font-semibold text-toast-action hover:bg-on-toast/10"
              >
                {t.action.label}
              </button>
            </ToastPrimitive.Action>
          )}
          <ToastPrimitive.Close
            aria-label="Dismiss"
            className="inline-flex size-6 cursor-pointer items-center justify-center rounded-full text-on-toast/70 hover:bg-on-toast/10"
          >
            <X className="size-3.5" />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="fixed bottom-4 left-4 z-[60] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2 outline-none max-md:bottom-20" />
    </ToastPrimitive.Provider>
  );
}
