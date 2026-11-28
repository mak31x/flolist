import type { Block } from "@flolist/shared";
import type { DragEndEvent, DragMoveEvent } from "@dnd-kit/core";

/**
 * Where a dragged row would land outside its own editor or view (D-054, M4.1): a sublist row
 * (the middle half of its resting rect), a sidebar list (`data-drop-list-id`) or the sidebar's
 * Inbox (`data-drop-inbox`). Found by hit-testing the pointer.
 */

export function pointerOf(event: DragMoveEvent | DragEndEvent): { x: number; y: number } | null {
  const start = event.activatorEvent;
  let x: number | undefined;
  let y: number | undefined;
  if (start instanceof MouseEvent) {
    x = start.clientX;
    y = start.clientY;
  } else if (typeof TouchEvent !== "undefined" && start instanceof TouchEvent) {
    x = start.touches[0]?.clientX;
    y = start.touches[0]?.clientY;
  }
  if (x === undefined || y === undefined) return null;
  return { x: x + event.delta.x, y: y + event.delta.y };
}

/**
 * A list that takes the dragged block: a sublist row whose middle the pointer is over (judged
 * by the row's resting place, since sorting may have shifted it), or a sidebar list.
 */
export function dropTargetAt(
  event: DragMoveEvent | DragEndEvent,
  blocks: readonly Block[] = [],
): HTMLElement | null {
  const point = pointerOf(event);
  if (!point) return null;
  const { over, active } = event;
  const overBlock = over && over.id !== active.id ? blocks.find((b) => b.id === over.id) : null;
  if (over && overBlock?.type === "sublist") {
    const band = over.rect.height / 4;
    if (point.y > over.rect.top + band && point.y < over.rect.top + over.rect.height - band) {
      return document.querySelector<HTMLElement>(
        `[data-block-id="${overBlock.id}"] [data-drop-list-id]`,
      );
    }
  }
  if (typeof document.elementsFromPoint !== "function") return null;
  for (const el of document.elementsFromPoint(point.x, point.y)) {
    if (el.closest("[data-block-editor], [data-task-view]")) continue;
    const target = el.closest<HTMLElement>("[data-drop-list-id], [data-drop-inbox]");
    if (target) return target;
  }
  return null;
}

let marked: HTMLElement | null = null;
export function markDropTarget(el: HTMLElement | null) {
  if (marked === el) return;
  marked?.removeAttribute("data-drop-target");
  el?.setAttribute("data-drop-target", "");
  marked = el;
}
