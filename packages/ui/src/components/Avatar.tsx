import { Avatar as AvatarPrimitive } from "radix-ui";
import { cn } from "../cn.ts";
import { colourIndex, initials } from "./avatar-utils.ts";

export type AvatarPerson = { id?: string; name: string; imageUrl?: string | null };

export type AvatarSize = 16 | 20 | 24 | 32 | 72;

const sizeClass: Record<AvatarSize, string> = {
  16: "size-4 text-[8px]",
  20: "size-5 text-[9px]",
  24: "size-6 text-[10px]",
  32: "size-8 text-[12px]",
  72: "size-18 text-[24px]",
};

// Literal class names so Tailwind can see them.
const fallbackColours = [
  "bg-avatar-1",
  "bg-avatar-2",
  "bg-avatar-3",
  "bg-avatar-4",
  "bg-avatar-5",
  "bg-avatar-6",
] as const;

export type AvatarProps = AvatarPerson & { size?: AvatarSize; className?: string };

export function Avatar({ id, name, imageUrl, size = 24, className }: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full align-middle select-none",
        sizeClass[size],
        className,
      )}
    >
      {imageUrl && (
        <AvatarPrimitive.Image src={imageUrl} alt={name} className="size-full object-cover" />
      )}
      <AvatarPrimitive.Fallback
        aria-label={name}
        role="img"
        className={cn(
          "flex size-full items-center justify-center font-semibold text-on-avatar",
          fallbackColours[colourIndex(id ?? name)],
        )}
      >
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

export type AvatarStackProps = {
  people: readonly AvatarPerson[];
  /** Show at most this many avatars, then "+N". */
  max?: number;
  size?: AvatarSize;
  className?: string;
};

/** Overlapping avatars, the first in front. */
export function AvatarStack({ people, max = 3, size = 20, className }: AvatarStackProps) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span
      className={cn("inline-flex items-center", className)}
      aria-label={people.map((p) => p.name).join(", ")}
    >
      {shown.map((p, i) => (
        <Avatar
          key={p.id ?? p.name}
          {...p}
          size={size}
          className={cn("ring-2 ring-surface", i > 0 && "-ml-1.5")}
          // Earlier avatars sit on top.
          {...{ style: { zIndex: shown.length - i } }}
        />
      ))}
      {extra > 0 && (
        <span
          className={cn(
            "-ml-1.5 inline-flex items-center justify-center rounded-full bg-chip-active font-semibold text-text-muted ring-2 ring-surface",
            sizeClass[size],
          )}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
