import { DIVIDER_COLORS, type Block, type BlockType, type DividerColor } from "@flolist/shared";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  cn,
} from "@flolist/ui";
import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import { Check, Copy, GripVertical, Pilcrow, Trash2 } from "lucide-react";
import { t } from "../../i18n/index.ts";
import { BLOCK_ICONS } from "./icons.ts";
import { SLASH_ITEMS } from "./slash.ts";

export type BlockAction =
  | { kind: "turnInto"; type: BlockType }
  | { kind: "color"; color: DividerColor }
  | { kind: "duplicate" }
  | { kind: "delete" };

const swatch: Record<DividerColor, string> = {
  gray: "bg-divider-gray",
  red: "bg-divider-red",
  orange: "bg-divider-orange",
  green: "bg-divider-green",
  blue: "bg-divider-blue",
  purple: "bg-divider-purple",
};

export interface BlockHandleProps {
  block: Block;
  dragRef: (el: HTMLElement | null) => void;
  dragAttributes: DraggableAttributes;
  dragListeners: DraggableSyntheticListeners;
  onAction: (block: Block, action: BlockAction) => void;
}

/**
 * The hover controls left of a block (ui-design.md: ⋮⋮ drag handle, then the dark circular
 * block-type button). The menu offers Turn into, Duplicate and Delete (lists-and-blocks.md);
 * Copy link arrives with tasks. Hidden on phones, where "/" and the keyboard cover it
 * [assumption].
 */
export function BlockHandle({
  block,
  dragRef,
  dragAttributes,
  dragListeners,
  onAction,
}: BlockHandleProps) {
  const Icon = BLOCK_ICONS[block.type] ?? Pilcrow;
  // Run after the menu has closed: its focus trap would pull back a caret placed now.
  const act = (action: BlockAction) => {
    setTimeout(() => {
      onAction(block, action);
    }, 0);
  };
  const current = "color" in block.content ? block.content.color : null;
  return (
    <div
      className={cn(
        "absolute top-0 -left-[54px] hidden h-full items-start gap-0.5 pt-[3px] md:flex",
        "opacity-0 transition-opacity group-hover/block:opacity-100 group-focus-within/block:opacity-100 focus-within:opacity-100",
      )}
    >
      <button
        ref={dragRef}
        type="button"
        aria-label={t("editor.handle.drag")}
        className="flex size-6 cursor-grab items-center justify-center rounded text-text-subtle hover:bg-surface-hover hover:text-text-muted active:cursor-grabbing [&_svg]:size-4"
        {...dragAttributes}
        {...dragListeners}
      >
        <GripVertical aria-hidden />
      </button>
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label={t("editor.handle.menu", { type: t(`editor.type.${block.type}`) })}
            className="flex size-6 items-center justify-center rounded-full bg-control-dark text-on-control-dark hover:opacity-90 [&_svg]:size-3.5"
          >
            <Icon aria-hidden />
          </button>
        </MenuTrigger>
        <MenuContent
          align="start"
          className="w-56"
          onCloseAutoFocus={(e) => {
            // The action moves focus itself (into the block, or its neighbour).
            e.preventDefault();
          }}
        >
          <MenuLabel>{t("editor.slash.label")}</MenuLabel>
          {SLASH_ITEMS.map((item) => {
            const ItemIcon = BLOCK_ICONS[item.type] ?? Pilcrow;
            return (
              <MenuItem
                key={item.type}
                icon={<ItemIcon />}
                trailing={
                  item.type === block.type ? <Check aria-hidden className="size-4" /> : undefined
                }
                onSelect={() => {
                  act({ kind: "turnInto", type: item.type });
                }}
              >
                {t(item.label)}
              </MenuItem>
            );
          })}
          {block.type === "divider" && (
            <>
              <MenuSeparator />
              <MenuLabel>{t("editor.handle.color")}</MenuLabel>
              {DIVIDER_COLORS.map((color) => (
                <MenuItem
                  key={color}
                  icon={<span aria-hidden className={cn("size-3.5 rounded-full", swatch[color])} />}
                  trailing={
                    color === current ? <Check aria-hidden className="size-4" /> : undefined
                  }
                  onSelect={() => {
                    act({ kind: "color", color });
                  }}
                >
                  {t(`editor.color.${color}`)}
                </MenuItem>
              ))}
            </>
          )}
          <MenuSeparator />
          <MenuItem
            icon={<Copy />}
            onSelect={() => {
              act({ kind: "duplicate" });
            }}
          >
            {t("editor.handle.duplicate")}
          </MenuItem>
          <MenuItem
            icon={<Trash2 />}
            destructive
            onSelect={() => {
              act({ kind: "delete" });
            }}
          >
            {t("editor.handle.delete")}
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
}
