import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Calendar } from "lucide-react";
import { floatingSurface } from "@flolist/ui";
import { t } from "../../i18n/index.ts";
import { clearSuggestion, useSuggestion } from "./suggestion.ts";

/** The suggestion under the caret; mounted once by the shell. */
export function DateSuggestionPopup() {
  const current = useSuggestion((s) => s.current);
  const editorId = current?.editorId;
  useEffect(() => {
    if (!editorId) return;
    // Focus left the title (or the caret was moved by a click): hide it.
    const hide = (e: Event) => {
      const target = e.target as Element | null;
      if (!target?.closest(`[data-block-id="${editorId}"]`)) clearSuggestion(editorId);
    };
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
        clearSuggestion(editorId);
      }
    };
    document.addEventListener("focusin", hide);
    document.addEventListener("keydown", onKey, true);
    const onResize = () => {
      clearSuggestion(editorId);
    };
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("focusin", hide);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onResize);
    };
  }, [editorId]);
  return createPortal(
    <>
      <p aria-live="polite" className="sr-only">
        {current
          ? `${t("due.suggestion", { date: current.label })}. ${t("due.suggestionHint")}`
          : ""}
      </p>
      {current && (
        <div
          data-date-suggestion
          className={`${floatingSurface} fixed p-1`}
          style={{ left: current.left, top: current.top }}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-label={t("due.suggestion", { date: current.label })}
            onMouseDown={(e) => {
              e.preventDefault(); // keep the caret in the title
            }}
            onClick={() => {
              current.accept();
            }}
            className="flex h-[30px] items-center gap-2 rounded-md px-2 text-[13px] text-text hover:bg-surface-hover [&_svg]:size-4 [&_svg]:text-text-muted"
          >
            <Calendar aria-hidden />
            {current.label}
          </button>
        </div>
      )}
    </>,
    document.body,
  );
}
