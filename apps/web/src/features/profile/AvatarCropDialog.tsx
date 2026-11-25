import { Button, Dialog, DialogContent } from "@flolist/ui";
import { useState } from "react";
import Cropper, { type Area, type Point } from "react-easy-crop";
import { t } from "../../i18n/index.ts";

export interface AvatarCropDialogProps {
  /** Object URL of the picked image; null closes the dialog. */
  src: string | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (area: Area) => void;
}

/** Square crop with a round preview, zoom by slider, wheel or pinch (settings → Profile photo). */
export function AvatarCropDialog({ src, saving, onCancel, onSave }: AvatarCropDialogProps) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);

  return (
    <Dialog
      open={src !== null}
      onOpenChange={(open) => {
        if (!open && !saving) onCancel();
      }}
    >
      <DialogContent
        title={t("profile.photo.cropTitle")}
        className="w-[min(440px,calc(100vw-24px))]"
      >
        <div className="relative h-[min(320px,70vw)] overflow-hidden rounded-[12px] bg-surface-sunken">
          {src && (
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_area, pixels) => {
                setArea(pixels);
              }}
              style={{ cropAreaStyle: { boxShadow: "0 0 0 9999em var(--overlay)" } }}
            />
          )}
        </div>
        <label className="mt-4 flex items-center gap-3 text-[13px] text-text-muted">
          {t("profile.photo.zoom")}
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => {
              setZoom(Number(e.target.value));
            }}
            className="flex-1 accent-(--accent)"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={saving}
            disabled={!area}
            onClick={() => {
              if (area) onSave(area);
            }}
          >
            {t("profile.photo.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
