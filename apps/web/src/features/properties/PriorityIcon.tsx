import type { Priority } from "@flolist/shared";
import { cn } from "@flolist/ui";
import { SignalHigh, SignalLow, SignalMedium, SignalZero } from "lucide-react";

const icons = [SignalZero, SignalLow, SignalMedium, SignalHigh] as const;

/** The "bars" priority icon (tasks.md → priority): more bars, higher priority; High in accent. */
export function PriorityIcon({ value, className }: { value: Priority; className?: string }) {
  const Icon = icons[value] ?? SignalZero;
  return <Icon aria-hidden className={cn(value === 3 && "text-accent", className)} />;
}
