/**
 * Every animation duration and curve in Flolist (ui-design §7). Never inline magic numbers.
 * CSS transitions use the matching `--motion-*` variables in themes.css; a unit test keeps the two in sync.
 */

/** Durations in milliseconds. */
export const duration = {
  /** Hover states, small fades. */
  fast: 150,
  /** Popovers, menus, panel slides, cover ⇄ details cross-fade. */
  base: 200,
  /** Avatar-stack cross-fade and re-order. */
  avatarStack: 180,
  /** Rows collapsing/expanding when a workspace is hidden or shown. */
  collapse: 220,
  /** Delay between rows in a staggered collapse (top-down). */
  stagger: 20,
  /** Checkbox completion (spring settles in about this long). */
  check: 250,
} as const;

/** Cubic-bezier curves, as [x1, y1, x2, y2]. */
export const easing = {
  out: [0.16, 1, 0.3, 1],
  inOut: [0.65, 0, 0.35, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/** Spring presets for the Motion library. */
export const spring = {
  /** Checkbox fill and check mark. */
  check: { type: "spring", stiffness: 520, damping: 30, mass: 0.6 },
  /** Toggle thumb. */
  toggle: { type: "spring", stiffness: 700, damping: 36 },
  /** Small scale-pop, e.g. the sidebar team badge. */
  pop: { type: "spring", stiffness: 600, damping: 20 },
} as const;

/** Distance (px) the details card slides in from the right when it replaces the cover. */
export const panelSlideOffset = 12;

/** Seconds, for the Motion library (which takes seconds, not ms). */
export const seconds = (ms: number): number => ms / 1000;

/** `--motion-*` CSS custom properties, derived from the constants above. */
export const motionCssVars: Record<string, string> = {
  "--motion-fast": `${duration.fast}ms`,
  "--motion-base": `${duration.base}ms`,
  "--motion-collapse": `${duration.collapse}ms`,
  "--motion-ease-out": `cubic-bezier(${easing.out.join(", ")})`,
  "--motion-ease-in-out": `cubic-bezier(${easing.inOut.join(", ")})`,
};
