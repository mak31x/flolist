import { Button, Popover, PopoverAnchor, PopoverContent, TextField } from "@flolist/ui";
import { useState } from "react";
import { t } from "../../i18n/index.ts";
import { normalizeHref } from "./content.ts";
import type { LinkRequest } from "./link.ts";

/**
 * The ⌘L link prompt [assumption: a small popover with one field]. With a selection it links
 * the selection; on a bare caret it inserts the URL as linked text. An empty field removes the
 * link.
 */
export function LinkPrompt({ request, onClose }: { request: LinkRequest; onClose: () => void }) {
  const [value, setValue] = useState(request.href);
  const [error, setError] = useState<string | null>(null);

  const restore = () => {
    request.editor.chain().focus().setTextSelection({ from: request.from, to: request.to }).run();
  };

  const submit = () => {
    const { editor, from, to } = request;
    const chain = editor.chain().focus().setTextSelection({ from, to });
    if (value.trim() === "") {
      chain.extendMarkRange("link").unsetLink().run();
      onClose();
      return;
    }
    const href = normalizeHref(value);
    if (!href) {
      setError(t("editor.link.invalid"));
      return;
    }
    if (from === to && !request.href) {
      chain
        .insertContent({
          type: "text",
          text: value.trim(),
          marks: [{ type: "link", attrs: { href } }],
        })
        .run();
    } else {
      chain.extendMarkRange("link").setLink({ href }).run();
    }
    onClose();
  };

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          restore();
        }
      }}
    >
      <PopoverAnchor asChild>
        <span
          aria-hidden
          className="pointer-events-none fixed w-px"
          style={{
            left: request.anchor.left,
            top: request.anchor.top,
            height: request.anchor.height,
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        className="w-[min(320px,calc(100vw-24px))]"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
        }}
      >
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <TextField
            label={t("editor.link.label")}
            autoFocus
            value={value}
            placeholder="https://"
            error={error ?? undefined}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            className="flex-1"
          />
          <Button type="submit" variant="primary">
            {t("editor.link.save")}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
