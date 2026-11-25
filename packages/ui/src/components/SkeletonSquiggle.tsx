import { cn } from "../cn.ts";

/** Row widths in px (capped by the container). */
const widths = [340, 250, 400, 290, 210];
const STEP = 14;
const AMPLITUDE = 4;

function Wave({ width }: { width: number }) {
  // A gentle wave drawn with alternating quadratic curves.
  let d = "M2 6";
  for (let x = 2, up = true; x + STEP <= width - 2; x += STEP, up = !up) {
    d += ` q${STEP / 2} ${up ? -AMPLITUDE * 2 : AMPLITUDE * 2} ${STEP} 0`;
  }
  return (
    <svg
      viewBox={`0 0 ${width} 12`}
      width={width}
      height={12}
      aria-hidden
      className="max-w-full min-w-0 text-skeleton"
      preserveAspectRatio="xMinYMid slice"
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
    </svg>
  );
}

/** Faint placeholder rows (checkbox + wavy line) for empty task lists (ui-design §4). */
export function SkeletonSquiggle({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div
      aria-hidden
      data-testid="skeleton-squiggle"
      className={cn("flex flex-col gap-1", className)}
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-9 items-center gap-3 px-1">
          <span className="size-4 shrink-0 rounded-checkbox border-[1.5px] border-skeleton" />
          <Wave width={widths[i % widths.length] ?? 260} />
        </div>
      ))}
    </div>
  );
}
