import type { BuiltinCover } from "@flolist/shared";

/** Built-in cover images (apps/web/public/covers, credits in docs/credits.md). */
export const covers = {
  "misty-mountains": "/covers/misty-mountains.webp",
  "pastel-ocean": "/covers/pastel-ocean.webp",
  "misty-marsh": "/covers/misty-marsh.webp",
  "forest-river": "/covers/forest-river.webp",
  "still-rock": "/covers/still-rock.webp",
  "mountain-lake": "/covers/mountain-lake.webp",
  "dawn-river": "/covers/dawn-river.webp",
  "wooden-dock": "/covers/wooden-dock.webp",
} as const satisfies Record<BuiltinCover, string>;

export type CoverId = keyof typeof covers;

/**
 * The six built-ins offered for lists (lists-and-blocks.md → Customize): every one Inbox and
 * Today don't use [assumption].
 */
export const LIST_COVER_CHOICES: readonly CoverId[] = [
  "forest-river",
  "still-rock",
  "mountain-lake",
  "dawn-river",
  "wooden-dock",
  "misty-marsh",
];
