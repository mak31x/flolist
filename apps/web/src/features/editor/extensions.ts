import Bold from "@tiptap/extension-bold";
import Code from "@tiptap/extension-code";
import Document from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import Italic from "@tiptap/extension-italic";
import Link from "@tiptap/extension-link";
import Paragraph from "@tiptap/extension-paragraph";
import Strike from "@tiptap/extension-strike";
import Text from "@tiptap/extension-text";
import { normalizeHref } from "./content.ts";

/**
 * The inline editor of one block: a document of exactly one paragraph, with the marks from
 * lists-and-blocks.md (⌘B, ⌘I, ⌘⇧X, ⌘E; ⌘L opens the link prompt from `InlineEditor`). Block structure (Enter, Backspace, Tab, ↑/↓) is
 * the block controller's job, and undo is the editor-wide stack, so Tiptap's history is off.
 * Each mark extension brings its Markdown input rule (`**bold**`, `*italic*`, `~~strike~~`,
 * `` `code` ``).
 */
export function inlineExtensions() {
  return [
    Document.extend({ content: "paragraph" }),
    Paragraph,
    Text,
    // Shift+Enter only; Mod+Enter is left for task shortcuts (M3).
    HardBreak.extend({
      addKeyboardShortcuts() {
        return { "Shift-Enter": () => this.editor.commands.setHardBreak() };
      },
    }),
    Bold,
    Italic,
    Strike.extend({
      addKeyboardShortcuts() {
        return { "Mod-Shift-x": () => this.editor.commands.toggleStrike() };
      },
    }),
    Code,
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      defaultProtocol: "https",
      HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      isAllowedUri: (url, { defaultValidate }) =>
        defaultValidate(url) && normalizeHref(url) !== null,
    }),
  ];
}
