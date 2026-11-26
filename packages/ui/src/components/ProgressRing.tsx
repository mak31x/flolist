import { cn } from "../cn.ts";

export interface ProgressRingProps {
  done: number;
  total: number;
  /** Accessible description, e.g. "2 of 5 subtasks done". */
  label: string;
  className?: string;
}

/** A small ring that fills with `done/total`, followed by the count (ui-design §4 task row). */
export function ProgressRing({ done, total, label, className }: ProgressRingProps) {
  const r = 5.5;
  const circumference = 2 * Math.PI * r;
  const share = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-1 text-meta text-text-muted tabular-nums",
        className,
      )}
    >
      <svg viewBox="0 0 14 14" aria-hidden className="size-3.5 -rotate-90">
        <circle
          cx="7"
          cy="7"
          r={r}
          fill="none"
          strokeWidth="1.5"
          className="stroke-border-strong"
        />
        <circle
          cx="7"
          cy="7"
          r={r}
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - share)}
          className="stroke-accent transition-[stroke-dashoffset] duration-(--motion-base)"
        />
      </svg>
      <span aria-hidden>
        {done}/{total}
      </span>
    </span>
  );
}
