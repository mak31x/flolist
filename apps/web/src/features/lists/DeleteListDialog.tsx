import { Button, Dialog, DialogClose, DialogContent } from "@flolist/ui";
import { t } from "../../i18n/index.ts";

type DeleteListDialogProps = {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

/** "Delete '<title>', including all of its tasks and attachments?" (lists-and-blocks.md). */
export function DeleteListDialog({ title, open, onOpenChange, onConfirm }: DeleteListDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t("lists.deleteTitle")}
        description={t("lists.deleteConfirm", { title: title || t("lists.untitled") })}
        showClose={false}
        className="w-[min(420px,calc(100vw-24px))]"
      >
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="secondary">{t("common.cancel")}</Button>
          </DialogClose>
          <Button
            variant="primary"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {t("lists.deleteAction")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
