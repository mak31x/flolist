import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import { z } from "zod";

/**
 * Fractional-index position keys (D-008). Clients generate them, the server validates them.
 * Keys compare by plain code-unit order (`compareKeys`, or `collate "C"` in Postgres), never
 * by locale.
 */

const MAX_POSITION_LENGTH = 128;
/** The library's default (base 62) alphabet; it doesn't check fraction digits itself. */
const KEY_PATTERN = /^[0-9A-Za-z]+$/;

/** True for a base-62 key that `fractional-indexing` itself accepts. */
export function isValidPosition(key: string): boolean {
  if (key.length > MAX_POSITION_LENGTH || !KEY_PATTERN.test(key)) return false;
  try {
    generateKeyBetween(key, null);
    return true;
  } catch {
    return false;
  }
}

export const positionSchema = z
  .string()
  .refine(isValidPosition, { error: "Not a valid position key" });

/** Byte-order comparison, the order Postgres uses with `collate "C"`. */
export function compareKeys(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** A key between two neighbours (`null` = the start or end). */
export function positionBetween(before: string | null, after: string | null): string {
  // Equal neighbours (two clients picked the same key) can't take a key between them.
  if (before !== null && after !== null && before >= after) return generateKeyBetween(before, null);
  return generateKeyBetween(before, after);
}

export const positionAfter = (last: string | null): string => generateKeyBetween(last, null);
export const positionBefore = (first: string | null): string => generateKeyBetween(null, first);

export const positionsBetween = (before: string | null, after: string | null, n: number) =>
  generateNKeysBetween(before, after, n);

/** Sorts rows by `position`, then `id`, so equal keys from concurrent clients stay stable. */
export function byPosition<T extends { position: string; id?: string }>(a: T, b: T): number {
  return compareKeys(a.position, b.position) || compareKeys(a.id ?? "", b.id ?? "");
}

/**
 * The key for an item dropped at `index` in `siblings` (already sorted, without the item).
 */
export function positionAt(siblings: readonly { position: string }[], index: number): string {
  const before = index > 0 ? (siblings[index - 1]?.position ?? null) : null;
  const after = siblings[index]?.position ?? null;
  return positionBetween(before, after);
}
