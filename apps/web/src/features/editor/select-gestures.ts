import type { Block } from "@flolist/shared";
import { isApplePlatform } from "@flolist/ui";
import { useRef, type MouseEvent, type TouchEvent } from "react";

/** How long a touch must rest on a row to select it (views.md → Multiselect) [assumption]. */
export const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 8;

export type SelectMode = "toggle" | "range";

/** Clicks on these keep their own meaning (Mod+click opens a link, the checkbox completes). */
const OWN_CLICKS = "a, button, input, [role='checkbox'], [data-block-handle]";

/**
 * Multiselect gestures on a row: Mod-click toggles it, Shift-click selects a range, a
 * long-press toggles it on touch, and while a selection exists a tap toggles too. Shift-click
 * inside the block being edited stays a text selection.
 */
export function useSelectGestures(
  block: Block,
  enabled: boolean,
  selecting: boolean,
  onSelect: ((block: Block, mode: SelectMode) => void) | undefined,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  /** A select-click just happened (macOS turns Ctrl-click into a context-menu click too). */
  const selectedByClick = useRef(false);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  if (!enabled || !onSelect) return {};

  return {
    onMouseDownCapture: (e: MouseEvent) => {
      if (e.button !== 0) return;
      const mod = isApplePlatform() ? e.metaKey : e.ctrlKey;
      if (!mod && !e.shiftKey) return;
      if (e.target instanceof Element && e.target.closest(OWN_CLICKS)) return;
      if (!mod && !selecting) {
        const editing = document.activeElement?.closest<HTMLElement>("[data-block-id]");
        if (!editing || editing.dataset.blockId === block.id) return;
      }
      e.preventDefault();
      e.stopPropagation();
      selectedByClick.current = true;
      onSelect(block, mod ? "toggle" : "range");
    },
    onContextMenu: (e: MouseEvent) => {
      if (!selectedByClick.current) return;
      selectedByClick.current = false;
      // Runs before the row's menu trigger, which skips prevented events.
      e.preventDefault();
    },
    onMouseUp: () => {
      // The context-menu event (if any) comes before mouseup on macOS.
      setTimeout(() => {
        selectedByClick.current = false;
      }, 0);
    },
    onTouchStart: (e: TouchEvent) => {
      const touch = e.touches[0];
      if (e.touches.length !== 1 || !touch) return;
      fired.current = false;
      start.current = { x: touch.clientX, y: touch.clientY };
      timer.current = setTimeout(() => {
        fired.current = true;
        timer.current = null;
        onSelect(block, "toggle");
      }, LONG_PRESS_MS);
    },
    onTouchMove: (e: TouchEvent) => {
      const touch = e.touches[0];
      const from = start.current;
      if (!touch || !from) return;
      if (Math.hypot(touch.clientX - from.x, touch.clientY - from.y) > MOVE_TOLERANCE_PX) cancel();
    },
    onTouchEnd: (e: TouchEvent) => {
      const tapped = start.current !== null && timer.current !== null;
      cancel();
      if (fired.current) {
        // The long-press selected the row; don't also focus its text.
        e.preventDefault();
        fired.current = false;
      } else if (tapped && selecting) {
        e.preventDefault();
        onSelect(block, "toggle");
      }
    },
    onTouchCancel: cancel,
  };
}
