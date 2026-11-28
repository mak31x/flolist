import { isApplePlatform } from "@flolist/ui";
import { useEffect, useRef } from "react";

/** Focus is somewhere typing goes (single-letter shortcuts stay off there). */
function editing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']") !== null
  );
}

/**
 * "New task in Inbox/Today" (keyboard-shortcuts.md → Task views): ^N on the web on Apple
 * platforms (⌘N belongs to the browser; the Mac app maps ⌘N in M10), Alt+N elsewhere, and C
 * when focus isn't in an editable field. Keys match `event.code`, so layouts don't change them.
 * Active while the view using it is mounted.
 */
export function useNewTaskShortcut(onNew: () => void): void {
  const latest = useRef(onNew);
  useEffect(() => {
    latest.current = onNew;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const chord = isApplePlatform()
        ? event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
        : event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
      const single =
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        !editing(event.target);
      if ((chord && event.code === "KeyN") || (single && event.code === "KeyC")) {
        // Not while a dialog or menu is open over the view.
        if (document.querySelector("[role='dialog'], [role='menu']")) return;
        event.preventDefault();
        latest.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, []);
}
