import {
  FileImage,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTree,
  Minus,
  Paperclip,
  Pilcrow,
  Quote,
  type LucideIcon,
} from "lucide-react";

/** One icon per block type (slash menu, block-type button). */
export const BLOCK_ICONS: Record<string, LucideIcon> = {
  paragraph: Pilcrow,
  heading1: Heading1,
  heading2: Heading2,
  heading3: Heading3,
  divider: Minus,
  bullet: List,
  numbered: ListOrdered,
  quote: Quote,
  image: FileImage,
  attachment: Paperclip,
  sublist: ListTree,
};
