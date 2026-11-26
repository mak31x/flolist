import { fileUrl, type Block, type MediaContent } from "@flolist/shared";
import { Dialog, DialogContent, cn } from "@flolist/ui";
import {
  Download,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  type LucideIcon,
} from "lucide-react";
import { createElement, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { t } from "../../i18n/index.ts";
import { downloadFile } from "../../platform/index.ts";
import { formatBytes, type PendingUpload } from "./media.ts";

const mediaOf = (block: Block): MediaContent =>
  "caption" in block.content ? (block.content as MediaContent) : { file: null, caption: "" };

/** Shared focus ring for blocks that are focused as a whole (`data-atomic`). */
const atomicFocus =
  "outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

export interface AtomicProps {
  block: Block;
  /** Arrow keys, Backspace/Delete and Enter go to the editor's controller. */
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/**
 * An image block (lists-and-blocks.md → Block types): the image inline at its own aspect ratio,
 * a full-screen view on click (or Space), and an optional caption below.
 */
export function ImageBlock({
  block,
  onKeyDown,
  onCaption,
}: AtomicProps & { onCaption: (caption: string) => void }) {
  const { file, caption } = mediaOf(block);
  const [open, setOpen] = useState(false);
  const src = block.fileId ? fileUrl(block.fileId) : null;
  const ratio =
    file?.width && file.height ? `${String(file.width)} / ${String(file.height)}` : undefined;
  const name = file?.name ?? t("editor.type.image");
  return (
    <figure className="my-1.5">
      <button
        type="button"
        data-atomic
        aria-label={t("editor.image.open", { name })}
        onClick={() => {
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === " ") {
            e.preventDefault();
            setOpen(true);
            return;
          }
          onKeyDown(e);
        }}
        className={cn(
          "block max-w-full cursor-zoom-in overflow-hidden rounded-lg bg-surface-sunken",
          atomicFocus,
        )}
        style={{
          aspectRatio: ratio,
          width: file?.width ? `min(100%, ${String(file.width)}px)` : undefined,
        }}
      >
        {src && (
          <img
            src={src}
            alt={caption || name}
            loading="lazy"
            decoding="async"
            draggable={false}
            className="block h-full w-full object-contain"
          />
        )}
      </button>
      <CaptionField caption={caption} onCommit={onCaption} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={caption || name}
          hideTitle
          className="top-1/2 flex h-[min(92vh,100%)] w-[min(96vw,1600px)] -translate-y-1/2 items-center justify-center bg-transparent p-0 shadow-none"
        >
          {src && (
            <img
              src={src}
              alt={caption || name}
              className="max-h-full max-w-full rounded-lg object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </figure>
  );
}

/** The caption under an image: edits in place, saved on blur and Enter. */
function CaptionField({
  caption,
  onCommit,
}: {
  caption: string;
  onCommit: (caption: string) => void;
}) {
  const [draft, setDraft] = useState(caption);
  const [focused, setFocused] = useState(false);
  const [seen, setSeen] = useState(caption);
  const ref = useRef<HTMLTextAreaElement>(null);
  if (caption !== seen) {
    setSeen(caption);
    if (!focused) setDraft(caption);
  }
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${String(el.scrollHeight)}px`;
  }, [draft]);
  const commit = () => {
    const next = draft.trim();
    if (next !== caption) onCommit(next);
  };
  return (
    <figcaption>
      <textarea
        ref={ref}
        rows={1}
        value={draft}
        maxLength={2000}
        aria-label={t("editor.image.caption")}
        placeholder={t("editor.image.captionPlaceholder")}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        className="mt-1 block w-full resize-none bg-transparent text-secondary text-text-muted outline-none placeholder:text-text-subtle placeholder:opacity-0 focus:placeholder:opacity-100"
      />
    </figcaption>
  );
}

const FILE_ICON_CLASS = "size-5 shrink-0 text-text-muted";

function iconFor(mime: string): LucideIcon {
  if (mime.startsWith("image/")) return FileImage;
  if (mime.startsWith("video/")) return FileVideo;
  if (mime.startsWith("audio/")) return FileAudio;
  if (mime.startsWith("text/") || mime === "application/pdf" || mime.includes("document"))
    return FileText;
  if (mime.includes("sheet") || mime.includes("csv") || mime.includes("excel"))
    return FileSpreadsheet;
  if (mime.includes("zip") || mime.includes("compressed") || mime.includes("tar"))
    return FileArchive;
  return FileIcon;
}

/** An attachment block: file icon, name, size and a download button. */
export function AttachmentBlock({ block, onKeyDown }: AtomicProps) {
  const { file } = mediaOf(block);
  const icon = createElement(iconFor(file?.mime ?? ""), {
    "aria-hidden": true,
    className: FILE_ICON_CLASS,
  });
  const name = file?.name ?? t("editor.type.attachment");
  const download = () => {
    if (block.fileId) downloadFile(fileUrl(block.fileId), name);
  };
  return (
    <div
      data-atomic
      tabIndex={-1}
      role="group"
      aria-label={t("editor.attachment.label", { name })}
      onKeyDown={(e) => {
        if (e.key === " " && e.target === e.currentTarget) {
          e.preventDefault();
          download();
          return;
        }
        if (e.target === e.currentTarget) onKeyDown(e);
      }}
      className={cn(
        "my-1 flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5",
        atomicFocus,
      )}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium text-text">{name}</p>
        {file && <p className="text-secondary text-text-muted">{formatBytes(file.sizeBytes)}</p>}
      </div>
      <button
        type="button"
        onClick={download}
        aria-label={t("editor.attachment.download", { name })}
        className="flex size-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none [&_svg]:size-4"
      >
        <Download aria-hidden />
      </button>
    </div>
  );
}

/** A file on its way up: name and progress, until its block is created. */
export function PendingUploadRow({ upload }: { upload: PendingUpload }) {
  const percent = Math.round(upload.progress * 100);
  return (
    <div
      data-pending-upload
      className="my-1 flex items-center gap-3 rounded-lg border border-dashed border-border px-3 py-2.5"
    >
      <p className="min-w-0 flex-1 truncate text-body text-text-muted">
        {t("editor.upload.uploading", { name: upload.name })}
      </p>
      <div
        role="progressbar"
        aria-label={t("editor.upload.progress", { name: upload.name })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-sunken"
      >
        <div
          className="h-full bg-accent transition-[width]"
          style={{ width: `${String(percent)}%` }}
        />
      </div>
    </div>
  );
}
