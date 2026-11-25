/** Tiny external store behind toast(); rendered by <Toaster/>. */

export type ToastAction = { label: string; onAction: () => void };
export type ToastItem = { id: number; message: string; action?: ToastAction; durationMs: number };

const DEFAULT_DURATION_MS = 5000;

let items: readonly ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToasts(): readonly ToastItem[] {
  return items;
}

/** Shows a snackbar ("Task moved to 1 Dec · Undo"). Returns its id. */
export function toast(
  message: string,
  options: { action?: ToastAction; durationMs?: number } = {},
): number {
  const id = nextId++;
  const item: ToastItem = { id, message, durationMs: options.durationMs ?? DEFAULT_DURATION_MS };
  if (options.action) item.action = options.action;
  items = [...items, item];
  emit();
  return id;
}

export function dismissToast(id: number): void {
  const next = items.filter((t) => t.id !== id);
  if (next.length === items.length) return;
  items = next;
  emit();
}

/** Test helper. */
export function clearToasts(): void {
  items = [];
  emit();
}
