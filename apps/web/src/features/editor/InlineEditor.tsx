import type { InlineNode } from "@flolist/shared";
import { cn } from "@flolist/ui";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { openExternal } from "../../platform/index.ts";
import { docToInline, inlineToDoc, sameInline } from "./content.ts";
import { inlineExtensions } from "./extensions.ts";
import { registerEditor } from "./focus.ts";
import { isMod, isModKey } from "./keys.ts";

export interface InlineEditorProps {
  blockId: string;
  inline: readonly InlineNode[];
  placeholder?: string | undefined;
  ariaLabel: string;
  className?: string;
  onChange: (inline: InlineNode[]) => void;
  /** Return true when the key was handled (the block controller). */
  onKeyDown?: (event: KeyboardEvent, editor: Editor) => boolean;
  onRequestLink: (editor: Editor) => void;
  onFocus?: () => void;
  /** Return true when the paste was handled (several blocks); otherwise Tiptap pastes inline. */
  onPaste?: (event: ClipboardEvent, editor: Editor) => boolean;
  /** Undo/redo from outside the keyboard (Edit menu, touch-bar): the editor-wide stack. */
  onHistory?: ((action: "undo" | "redo") => void) | undefined;
}

/**
 * One block's text. The editor owns its text while it has focus: a remote change to the
 * focused block is shown once it loses focus [assumption]; editor commands (merge, undo) set
 * the content themselves through `editorFor()`.
 */
export function InlineEditor(props: InlineEditorProps) {
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  const editorRef = useRef<Editor | null>(null);
  const editor: Editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    content: inlineToDoc(props.inline),
    extensions: inlineExtensions(),
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": props.ariaLabel,
        "aria-multiline": "false",
        "data-block-id": props.blockId,
        class: "outline-none whitespace-pre-wrap break-words",
      },
      handleKeyDown: (_view, event): boolean => {
        const e = editorRef.current;
        if (!e) return false;
        if (isModKey(event, "l")) {
          event.preventDefault();
          latest.current.onRequestLink(e);
          return true;
        }
        return latest.current.onKeyDown?.(event, e) ?? false;
      },
      handleDOMEvents: {
        beforeinput: (_view, event): boolean => {
          if (event.inputType !== "historyUndo" && event.inputType !== "historyRedo") return false;
          event.preventDefault();
          latest.current.onHistory?.(event.inputType === "historyUndo" ? "undo" : "redo");
          return true;
        },
      },
      handlePaste: (_view, event): boolean => {
        const e = editorRef.current;
        return e ? (latest.current.onPaste?.(event, e) ?? false) : false;
      },
      // Links open with Mod+click; a plain click places the caret.
      handleClick: (_view, _pos, event) => {
        const anchor = (event.target as HTMLElement | null)?.closest("a");
        if (anchor && isMod(event)) {
          openExternal(anchor.href);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => {
      latest.current.onChange(docToInline(e.getJSON()));
    },
    onFocus: () => {
      latest.current.onFocus?.();
    },
    onBlur: ({ editor: e }) => {
      // Catch up with a change that arrived while we were typing.
      const incoming = latest.current.inline;
      if (!sameInline(incoming, docToInline(e.getJSON()))) {
        e.commands.setContent(inlineToDoc(incoming), { emitUpdate: false });
      }
    },
  });
  useLayoutEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => registerEditor(props.blockId, editor), [props.blockId, editor]);

  useEffect(() => {
    if (!editor.isDestroyed) editor.view.dom.setAttribute("aria-label", props.ariaLabel);
  }, [editor, props.ariaLabel]);

  // Show changes made elsewhere while this block isn't being edited.
  useEffect(() => {
    if (editor.isFocused || editor.isDestroyed) return;
    if (!sameInline(props.inline, docToInline(editor.getJSON()))) {
      editor.commands.setContent(inlineToDoc(props.inline), { emitUpdate: false });
    }
  }, [editor, props.inline]);

  const empty = props.inline.length === 0;
  return (
    <div className={cn("relative min-w-0 flex-1", props.className)}>
      {empty && props.placeholder && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 truncate text-text-subtle select-none"
        >
          {props.placeholder}
        </span>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
