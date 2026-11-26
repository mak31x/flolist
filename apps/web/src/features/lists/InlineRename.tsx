import { cn } from "@flolist/ui";
import { useEffect, useRef, useState } from "react";

type InlineRenameProps = {
  value: string;
  label: string;
  placeholder?: string;
  /** Called with the trimmed text when it changed; empty values are refused when `required`. */
  onCommit: (value: string) => void;
  onDone: () => void;
  required?: boolean;
  className?: string;
};

/** A focused text field that replaces a title in place: Enter or blur saves, Escape cancels. */
export function InlineRename({
  value,
  label,
  placeholder,
  onCommit,
  onDone,
  required = false,
  className,
}: InlineRenameProps) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const finished = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const next = text.trim();
    if (save && next !== value.trim() && (!required || next !== "")) onCommit(next);
    onDone();
  };

  return (
    <input
      ref={ref}
      aria-label={label}
      value={text}
      placeholder={placeholder}
      maxLength={200}
      onChange={(e) => {
        setText(e.target.value);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => {
        finish(true);
      }}
      className={cn(
        "h-7 min-w-0 flex-1 rounded-md bg-surface-raised px-1.5 text-body text-text outline-none ring-2 ring-focus-ring",
        className,
      )}
    />
  );
}
