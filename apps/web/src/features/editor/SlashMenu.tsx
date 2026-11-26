import { Popover, PopoverAnchor, PopoverContent, cn } from "@flolist/ui";
import { Pilcrow } from "lucide-react";
import type { BlockType } from "@flolist/shared";
import { t } from "../../i18n/index.ts";
import { BLOCK_ICONS } from "./icons.ts";
import type { SlashItem } from "./slash.ts";

export interface SlashMenuProps {
  items: readonly SlashItem[];
  active: number;
  anchor: { left: number; top: number; height: number };
  listId: string;
  onPick: (type: BlockType) => void;
  onHover: (index: number) => void;
  onClose: () => void;
}

/**
 * The "/" menu (lists-and-blocks.md → Editor behaviour). Focus stays in the block: the block
 * controller moves the highlight with ↑/↓, picks with Enter and closes with Esc.
 */
export function SlashMenu({
  items,
  active,
  anchor,
  listId,
  onPick,
  onHover,
  onClose,
}: SlashMenuProps) {
  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverAnchor asChild>
        <span
          aria-hidden
          className="pointer-events-none fixed w-px"
          style={{ left: anchor.left, top: anchor.top, height: anchor.height }}
        />
      </PopoverAnchor>
      <PopoverContent
        side="bottom"
        className="w-60 p-1.5"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
        }}
      >
        {items.length === 0 ? (
          <p className="px-2 py-1.5 text-body text-text-muted">{t("editor.slash.empty")}</p>
        ) : (
          <div role="listbox" id={listId} aria-label={t("editor.slash.label")}>
            {items.map((item, index) => {
              const Icon = BLOCK_ICONS[item.type] ?? Pilcrow;
              return (
                <div
                  key={item.type}
                  id={`${listId}-${item.type}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                  onMouseEnter={() => {
                    onHover(index);
                  }}
                  onClick={() => {
                    onPick(item.type);
                  }}
                  className={cn(
                    "flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 text-body text-text [&_svg]:size-4 [&_svg]:text-text-muted",
                    index === active && "bg-surface-hover",
                  )}
                >
                  <Icon aria-hidden />
                  {t(item.label)}
                </div>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
