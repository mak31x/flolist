import { motion, useReducedMotion } from "motion/react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { useState } from "react";
import { cn } from "../cn.ts";
import { spring } from "../motion.ts";

export type CheckboxProps = {
  /** Accessible name, e.g. the task title. */
  label: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** 16px in rows, 20px in the details panel. */
  size?: "md" | "lg";
  disabled?: boolean;
  className?: string;
};

/** Rounded-square task checkbox with a spring fill and a drawn check mark (ui-design §4, §7). */
export function Checkbox({
  label,
  checked,
  defaultChecked = false,
  onCheckedChange,
  size = "md",
  disabled,
  className,
}: CheckboxProps) {
  const [inner, setInner] = useState(defaultChecked);
  const isChecked = checked ?? inner;
  const reduced = useReducedMotion() ?? false;
  const transition = reduced ? { duration: 0 } : spring.check;

  return (
    <CheckboxPrimitive.Root
      aria-label={label}
      checked={isChecked}
      disabled={disabled}
      onCheckedChange={(value) => {
        const next = value === true;
        if (checked === undefined) setInner(next);
        onCheckedChange?.(next);
      }}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-checkbox border-[1.5px] border-checkbox-border",
        "transition-colors duration-(--motion-fast) hover:border-text-muted disabled:cursor-default disabled:opacity-50",
        "data-[state=checked]:border-accent data-[state=checked]:bg-accent",
        size === "md" ? "size-4" : "size-5",
        className,
      )}
    >
      <motion.svg
        viewBox="0 0 16 16"
        aria-hidden
        className="absolute inset-0 size-full text-on-accent"
        initial={false}
        animate={{ scale: isChecked ? 1 : 0.6, opacity: isChecked ? 1 : 0 }}
        transition={transition}
      >
        <motion.path
          d="M4.2 8.4 6.8 11 11.8 5.4"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: isChecked ? 1 : 0 }}
          transition={transition}
        />
      </motion.svg>
    </CheckboxPrimitive.Root>
  );
}
