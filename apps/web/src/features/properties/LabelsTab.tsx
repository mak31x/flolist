import { LABEL_COLORS, normalizeLabelName, type Label, type LabelColor } from "@flolist/shared";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  EmptyState,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  SkeletonSquiggle,
  toast,
} from "@flolist/ui";
import { useQuery } from "@tanstack/react-query";
import { Check, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { t } from "../../i18n/index.ts";
import { workspacesQuery } from "../workspaces/api.ts";
import { LabelDot } from "./LabelChip.tsx";
import { labelsQuery, useDeleteLabel, useUpdateLabel } from "./labels-api.ts";

/**
 * Settings → Labels (settings-and-account.md): every label across the user's workspaces, with
 * how many tasks use it. Rename (to another label's name merges the two), recolour, delete.
 */
export function LabelsTab() {
  const { data: labels } = useQuery(labelsQuery);
  const { data: workspaces } = useQuery(workspacesQuery);
  if (!labels) return <SkeletonSquiggle rows={3} />;
  if (labels.length === 0) return <EmptyState>{t("settings.labels.empty")}</EmptyState>;

  const groups = (workspaces ?? [])
    .map((ws) => ({ ws, labels: labels.filter((l) => l.workspaceId === ws.id) }))
    .filter((g) => g.labels.length > 0);
  const multiple = groups.length > 1;
  return (
    <section className="rounded-settings bg-surface-sunken p-5">
      <h2 className="text-[15px] font-bold">{t("settings.labels.title")}</h2>
      <p className="mt-0.5 text-body text-text-muted">{t("settings.labels.description")}</p>
      {groups.map((g) => (
        <div key={g.ws.id} className="mt-4">
          {multiple && (
            <h3 className="mb-1 text-meta font-semibold text-text-muted">{g.ws.name}</h3>
          )}
          <ul className="flex flex-col">
            {g.labels.map((label) => (
              <LabelRow key={label.id} label={label} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function LabelRow({ label }: { label: Label }) {
  const update = useUpdateLabel();
  const remove = useDeleteLabel();
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const count =
    label.taskCount === 1
      ? t("settings.labels.oneTask")
      : t("settings.labels.tasks", { count: label.taskCount });

  const setColor = (color: LabelColor | null) => {
    update.mutate({ id: label.id, color });
  };

  return (
    <li className="flex h-10 items-center gap-2 border-b border-border last:border-b-0">
      <LabelDot color={label.color ?? "gray"} />
      {renaming ? (
        <RenameField
          name={label.name}
          onDone={(name) => {
            setRenaming(false);
            if (name && name !== label.name) update.mutate({ id: label.id, name });
          }}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate text-body">{label.name}</span>
      )}
      <span className="shrink-0 text-meta text-text-muted">{count}</span>
      <Menu>
        <MoreTrigger label={t("settings.labels.more", { name: label.name })} />
        <MenuContent align="end">
          <MenuItem
            icon={<Pencil />}
            onSelect={() => {
              setRenaming(true);
            }}
          >
            {t("settings.labels.rename")}
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            trailing={label.color === null ? <Check aria-hidden /> : undefined}
            onSelect={() => {
              setColor(null);
            }}
          >
            {t("settings.labels.noColor")}
          </MenuItem>
          {LABEL_COLORS.map((color) => (
            <MenuItem
              key={color}
              icon={<LabelDot color={color} className="m-1" />}
              trailing={label.color === color ? <Check aria-hidden /> : undefined}
              onSelect={() => {
                setColor(color);
              }}
            >
              {t(`colors.${color}`)}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem
            icon={<Trash2 />}
            destructive
            onSelect={() => {
              setConfirming(true);
            }}
          >
            {t("settings.labels.delete")}
          </MenuItem>
        </MenuContent>
      </Menu>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent
          title={t("settings.labels.deleteTitle", { name: label.name })}
          description={t("settings.labels.deleteBody", { count: label.taskCount })}
        >
          <div className="mt-5 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">{t("common.cancel")}</Button>
            </DialogClose>
            <Button
              onClick={() => {
                setConfirming(false);
                remove.mutate(
                  { id: label.id },
                  { onSuccess: () => toast(t("settings.labels.deleted")) },
                );
              }}
            >
              {t("settings.labels.delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </li>
  );
}

function MoreTrigger({ label }: { label: string }) {
  return (
    <MenuTrigger asChild>
      <IconButton label={label} icon={<MoreVertical />} variant="ghost" size="sm" tooltip={false} />
    </MenuTrigger>
  );
}

function RenameField({ name, onDone }: { name: string; onDone: (name: string) => void }) {
  const [value, setValue] = useState(name);
  const finished = useRef(false);
  const finish = (next: string) => {
    if (finished.current) return;
    finished.current = true;
    onDone(next);
  };
  return (
    <input
      autoFocus
      aria-label={t("settings.labels.name")}
      value={value}
      onChange={(e) => {
        setValue(e.currentTarget.value);
      }}
      onBlur={() => {
        finish(normalizeLabelName(value));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(normalizeLabelName(value));
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(name);
        }
      }}
      className="h-7 min-w-0 flex-1 rounded-md bg-surface px-2 text-body text-text outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
    />
  );
}
