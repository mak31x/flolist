import { ContextMenu as ContextPrimitive, DropdownMenu as MenuPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../cn.ts";
import { KbdHint } from "./KbdHint.tsx";
import { floatingSurface } from "./Popover.tsx";

const contentClass = cn(floatingSurface, "min-w-[200px] p-1.5");
const itemClass = cn(
  "flex h-[30px] cursor-pointer items-center gap-2.5 rounded-lg px-2 text-body outline-none select-none",
  "data-[highlighted]:bg-surface-hover data-[disabled]:cursor-default data-[disabled]:opacity-45",
  "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-text-muted",
  "data-[destructive]:text-danger data-[destructive]:[&_svg]:text-danger",
);
const separatorClass = "my-1 h-px bg-border";
const labelClass =
  "px-2 pt-1.5 pb-1 text-meta font-semibold tracking-wide text-text-subtle uppercase";

type ItemExtras = {
  icon?: ReactNode;
  shortcut?: string | undefined;
  destructive?: boolean | undefined;
  trailing?: ReactNode;
};

function ItemBody({ icon, shortcut, trailing, children }: ItemExtras & { children?: ReactNode }) {
  return (
    <>
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {trailing}
      {shortcut && <KbdHint shortcut={shortcut} />}
    </>
  );
}

/* Dropdown menu (⋮ menus, avatar menu, Quick create). */
export const Menu = MenuPrimitive.Root;
export const MenuTrigger = MenuPrimitive.Trigger;
export const MenuGroup = MenuPrimitive.Group;

export function MenuContent({
  className,
  sideOffset = 6,
  align = "start",
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(contentClass, className)}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

export function MenuItem({
  icon,
  shortcut,
  destructive,
  trailing,
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.Item> & ItemExtras) {
  return (
    <MenuPrimitive.Item
      data-destructive={destructive || undefined}
      className={cn(itemClass, className)}
      {...props}
    >
      <ItemBody icon={icon} shortcut={shortcut} trailing={trailing}>
        {children}
      </ItemBody>
    </MenuPrimitive.Item>
  );
}

export function MenuSeparator(props: ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={separatorClass} {...props} />;
}

export function MenuLabel(props: ComponentProps<typeof MenuPrimitive.Label>) {
  return <MenuPrimitive.Label className={labelClass} {...props} />;
}

/* Context (right-click) menu, same look. */
export const ContextMenu = ContextPrimitive.Root;
export const ContextMenuTrigger = ContextPrimitive.Trigger;

export function ContextMenuContent({
  className,
  ...props
}: ComponentProps<typeof ContextPrimitive.Content>) {
  return (
    <ContextPrimitive.Portal>
      <ContextPrimitive.Content className={cn(contentClass, className)} {...props} />
    </ContextPrimitive.Portal>
  );
}

export function ContextMenuItem({
  icon,
  shortcut,
  destructive,
  trailing,
  className,
  children,
  ...props
}: ComponentProps<typeof ContextPrimitive.Item> & ItemExtras) {
  return (
    <ContextPrimitive.Item
      data-destructive={destructive || undefined}
      className={cn(itemClass, className)}
      {...props}
    >
      <ItemBody icon={icon} shortcut={shortcut} trailing={trailing}>
        {children}
      </ItemBody>
    </ContextPrimitive.Item>
  );
}

export function ContextMenuSeparator(props: ComponentProps<typeof ContextPrimitive.Separator>) {
  return <ContextPrimitive.Separator className={separatorClass} {...props} />;
}
