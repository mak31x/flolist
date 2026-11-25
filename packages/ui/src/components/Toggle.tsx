import { motion, useReducedMotion } from "motion/react";
import { Switch } from "radix-ui";
import { useState } from "react";
import { cn } from "../cn.ts";
import { spring } from "../motion.ts";

export type ToggleProps = {
  label: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
};

const THUMB_TRAVEL = 14;

/** iOS-style switch, green when on, with a spring thumb. */
export function Toggle({
  label,
  checked,
  defaultChecked = false,
  onCheckedChange,
  disabled,
  className,
}: ToggleProps) {
  const [inner, setInner] = useState(defaultChecked);
  const isOn = checked ?? inner;
  const reduced = useReducedMotion() ?? false;

  return (
    <Switch.Root
      aria-label={label}
      checked={isOn}
      disabled={disabled}
      onCheckedChange={(next) => {
        if (checked === undefined) setInner(next);
        onCheckedChange?.(next);
      }}
      className={cn(
        "inline-flex h-5 w-[34px] shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-(--motion-fast)",
        "bg-toggle-off data-[state=checked]:bg-success disabled:cursor-default disabled:opacity-50",
        className,
      )}
    >
      <Switch.Thumb asChild>
        <motion.span
          className="block size-4 rounded-full bg-toggle-thumb shadow-sm"
          initial={false}
          animate={{ x: isOn ? THUMB_TRAVEL : 0 }}
          transition={reduced ? { duration: 0 } : spring.toggle}
        />
      </Switch.Thumb>
    </Switch.Root>
  );
}
