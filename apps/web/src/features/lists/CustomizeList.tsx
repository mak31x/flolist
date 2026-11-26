import type { ListCover, ListIndexItem } from "@flolist/shared";
import { Button, Dialog, DialogContent, cn, toast } from "@flolist/ui";
import { Check, ImageUp, Trash2 } from "lucide-react";
import { useState } from "react";
import { t } from "../../i18n/index.ts";
import { pickFile } from "../../platform/index.ts";
import { covers, LIST_COVER_CHOICES } from "../../shell/covers.ts";
import { downscaleImage } from "../files/resize.ts";
import { uploadFile, UploadError } from "../files/upload.ts";
import { IMAGE_ACCEPT } from "../editor/media.ts";
import { COVER_MAX_EDGE } from "./cover.ts";
import { EmojiPickerPopover } from "./EmojiPicker.tsx";
import { ListIcon } from "./ListIcon.tsx";
import { useUpdateList } from "./mutations.ts";

const sameCover = (a: ListCover, b: ListCover) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Customize (lists-and-blocks.md → Customize): the list's emoji (presets plus the full picker)
 * and its cover (six built-ins, an uploaded image up to 25 MB, or none).
 */
export function CustomizeListDialog({
  list,
  open,
  onOpenChange,
}: {
  list: ListIndexItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateList = useUpdateList(list.id);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const setCover = (cover: ListCover) => {
    if (!sameCover(cover, list.cover)) updateList.mutate({ cover });
  };

  const upload = async () => {
    const file = await pickFile(IMAGE_ACCEPT);
    if (!file) return;
    setUploading(true);
    try {
      const scaled = await downscaleImage(file, COVER_MAX_EDGE);
      const stored = await uploadFile(scaled.blob, {
        workspaceId: list.workspaceId,
        filename: `cover.${scaled.mime === "image/webp" ? "webp" : "jpg"}`,
        mime: scaled.mime,
        width: scaled.width,
        height: scaled.height,
      });
      setCover({ fileId: stored.id });
    } catch (err) {
      toast(err instanceof UploadError ? err.message : t("lists.cover.uploadError"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("lists.customize")}>
        <section className="mt-4">
          <h3 className="mb-2 text-secondary font-semibold text-text-muted">
            {t("lists.customize.icon")}
          </h3>
          <EmojiPickerPopover
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            canRemove={list.emoji !== null}
            onSelect={(emoji) => {
              updateList.mutate({ emoji });
            }}
          >
            <button
              type="button"
              aria-label={t("lists.changeEmoji")}
              className="flex size-12 cursor-pointer items-center justify-center rounded-xl border border-border hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
            >
              <ListIcon emoji={list.emoji} size="lg" />
            </button>
          </EmojiPickerPopover>
        </section>

        <section className="mt-5">
          <h3 className="mb-2 text-secondary font-semibold text-text-muted">
            {t("lists.customize.cover")}
          </h3>
          <ul className="grid grid-cols-3 gap-2" aria-label={t("lists.customize.cover")}>
            {LIST_COVER_CHOICES.map((id) => {
              const selected = sameCover(list.cover, { builtin: id });
              return (
                <li key={id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    aria-label={t("lists.cover.builtin", { name: id.replace("-", " ") })}
                    onClick={() => {
                      setCover({ builtin: id });
                    }}
                    className={cn(
                      "relative block aspect-[4/3] w-full overflow-hidden rounded-lg focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none",
                      selected && "ring-2 ring-accent",
                    )}
                  >
                    <img src={covers[id]} alt="" className="size-full object-cover" />
                    {selected && (
                      <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-accent text-on-accent [&_svg]:size-3.5">
                        <Check aria-hidden />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="outline"
              loading={uploading}
              icon={<ImageUp aria-hidden />}
              onClick={() => {
                void upload();
              }}
            >
              {t("lists.cover.upload")}
            </Button>
            {list.cover && (
              <Button
                variant="outline"
                icon={<Trash2 aria-hidden />}
                onClick={() => {
                  setCover(null);
                }}
              >
                {t("lists.cover.remove")}
              </Button>
            )}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
