import { useId, type ComponentProps } from "react";
import { cn } from "../cn.ts";

export type TextFieldProps = Omit<ComponentProps<"input">, "id"> & {
  label: string;
  /** Shown under the field; replaced by `error` when there is one. */
  hint?: string | undefined;
  error?: string | undefined;
};

/** Labelled text input with an optional hint or error (wired up with aria-describedby). */
export function TextField({ label, hint, error, className, ...props }: TextFieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-text">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? noteId : undefined}
        className={cn(
          "h-10 w-full rounded-[10px] border border-border bg-surface-raised px-3 text-[15px] text-text",
          "placeholder:text-text-subtle hover:border-border-strong",
          "aria-invalid:border-danger",
        )}
        {...props}
      />
      {note && (
        <p id={noteId} className={cn("text-[12px]", error ? "text-danger" : "text-text-muted")}>
          {note}
        </p>
      )}
    </div>
  );
}
