import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger, cn } from "@flolist/ui";
import { EmojiPicker as Picker } from "frimousse";
import type { ReactNode } from "react";
import { t } from "../../i18n/index.ts";

/** Where the picker's Emojibase data is served from (vite.config.ts → emojibase plugin). */
const EMOJIBASE_URL = "/emojibase";

/** Quick picks shown above the full picker (lists-and-blocks.md → Customize: presets). */
const presets = ["📋", "✅", "🛒", "🏠", "💼", "🎯", "📚", "✈️", "💡", "❤️", "🎉", "🧘"];

type EmojiPickerPopoverProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (emoji: string | null) => void;
  /** The element that opens it (rendered as the trigger), or omit and pass `anchor`. */
  children?: ReactNode;
  /** Anchor without making it a trigger (e.g. opened from a context menu). */
  anchor?: ReactNode;
  /** Show "Remove emoji" (the list has one). */
  canRemove?: boolean;
};

/** Emoji picker in a popover: presets, search and the full grid (frimousse). */
export function EmojiPickerPopover({
  open,
  onOpenChange,
  onSelect,
  children,
  anchor,
  canRemove = false,
}: EmojiPickerPopoverProps) {
  const pick = (emoji: string | null) => {
    onSelect(emoji);
    onOpenChange(false);
  };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {children && <PopoverTrigger asChild>{children}</PopoverTrigger>}
      {anchor && <PopoverAnchor asChild>{anchor}</PopoverAnchor>}
      <PopoverContent
        aria-label={t("emoji.pick")}
        className="w-[min(320px,calc(100vw-24px))] p-2"
        onCloseAutoFocus={(e) => {
          if (anchor) e.preventDefault();
        }}
      >
        <div className="flex flex-wrap gap-0.5 pb-2" role="group" aria-label={t("emoji.pick")}>
          {presets.map((e) => (
            <button
              key={e}
              type="button"
              aria-label={e}
              onClick={() => {
                pick(e);
              }}
              className="flex size-8 cursor-pointer items-center justify-center rounded-md text-[18px] hover:bg-surface-hover"
            >
              {e}
            </button>
          ))}
        </div>
        <Picker.Root
          className="flex h-[300px] flex-col"
          emojibaseUrl={EMOJIBASE_URL}
          columns={8}
          onEmojiSelect={({ emoji }) => {
            pick(emoji);
          }}
        >
          <Picker.Search
            aria-label={t("emoji.search")}
            placeholder={t("emoji.search")}
            className="h-8 w-full rounded-lg bg-chip px-2.5 text-body text-text outline-none placeholder:text-text-subtle focus-visible:ring-2 focus-visible:ring-focus-ring"
          />
          <Picker.Viewport className="relative mt-2 flex-1 outline-none">
            <Picker.Loading className="absolute inset-0 flex items-center justify-center text-secondary text-text-subtle">
              {t("emoji.loading")}
            </Picker.Loading>
            <Picker.Empty className="absolute inset-0 flex items-center justify-center text-secondary text-text-subtle">
              {t("emoji.none")}
            </Picker.Empty>
            <Picker.List
              className="pb-1 select-none"
              components={{
                CategoryHeader: ({ category, ...props }) => (
                  <div
                    {...props}
                    className="bg-surface-raised px-1 pt-2 pb-1 text-meta font-semibold text-text-subtle"
                  >
                    {category.label}
                  </div>
                ),
                Row: ({ children: row, ...props }) => (
                  <div {...props} className="scroll-my-1">
                    {row}
                  </div>
                ),
                Emoji: ({ emoji, ...props }) => (
                  <button
                    {...props}
                    className={cn(
                      "flex size-9 items-center justify-center rounded-md text-[20px]",
                      emoji.isActive && "bg-surface-hover",
                    )}
                  >
                    {emoji.emoji}
                  </button>
                ),
              }}
            />
          </Picker.Viewport>
        </Picker.Root>
        {canRemove && (
          <button
            type="button"
            onClick={() => {
              pick(null);
            }}
            className="mt-2 h-8 w-full cursor-pointer rounded-lg text-body text-text-muted hover:bg-surface-hover"
          >
            {t("emoji.remove")}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
