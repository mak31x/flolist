import { imageMimes, resolveWeekStart, type Me, type WeekStart } from "@flolist/shared";
import {
  Avatar,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Pill,
  TextField,
  toast,
} from "@flolist/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import type { Area } from "react-easy-crop";
import { languages, t } from "../../i18n/index.ts";
import { pickFile, systemFirstDay, systemLocale, systemTimeZone } from "../../platform/index.ts";
import { SettingsCard } from "../../views/SettingsCard.tsx";
import { useMe, useUpdateMe } from "../auth/hooks.ts";
import { UploadError, uploadFile } from "../files/upload.ts";
import { workspacesQuery } from "../workspaces/api.ts";
import { AvatarCropDialog } from "./AvatarCropDialog.tsx";
import { AVATAR_SIZE, cropToAvatar } from "./crop.ts";
import { TimeZonePicker } from "./TimeZonePicker.tsx";

/** Settings → Profile (settings-and-account.md). Heatmap, export and deletion arrive in M6.3. */
export function ProfileTab() {
  const me = useMe();
  return (
    <>
      <PersonalInfoCard me={me} />
      <LanguageCard me={me} />
      <WeekStartCard me={me} />
      <TimeZoneCard me={me} />
    </>
  );
}

function PersonalInfoCard({ me }: { me: Me }) {
  return (
    <section
      aria-labelledby="personal-info"
      className="flex flex-col gap-5 rounded-settings bg-surface-sunken p-5"
    >
      <h2 id="personal-info" className="text-[15px] font-bold">
        {t("profile.personalInfo")}
      </h2>
      <PhotoEditor me={me} />
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Keyed on the saved value so a change from another tab or device resets the draft. */}
        <NameField
          key={`first:${me.firstName}`}
          me={me}
          field="firstName"
          label={t("profile.firstName")}
          required
        />
        <NameField
          key={`last:${me.lastName}`}
          me={me}
          field="lastName"
          label={t("profile.lastName")}
        />
      </div>
      <TextField
        label={t("profile.email")}
        value={me.email}
        readOnly
        hint={t("profile.emailHint")}
        className="[&_input]:bg-transparent [&_input]:text-text-muted"
      />
    </section>
  );
}

/** Saves on blur or Enter; Escape puts the saved value back. */
function NameField({
  me,
  field,
  label,
  required = false,
}: {
  me: Me;
  field: "firstName" | "lastName";
  label: string;
  required?: boolean;
}) {
  const saved = me[field];
  const [draft, setDraft] = useState(saved);
  const [error, setError] = useState<string>();
  const update = useUpdateMe(t("profile.saveError"));

  const commit = () => {
    const value = draft.trim();
    if (required && value === "") {
      setError(t("profile.firstNameRequired"));
      return;
    }
    setError(undefined);
    setDraft(value);
    if (value !== saved) update.mutate({ patch: { [field]: value } });
  };

  return (
    <TextField
      label={label}
      value={draft}
      maxLength={100}
      autoComplete={field === "firstName" ? "given-name" : "family-name"}
      error={error}
      onChange={(e) => {
        setDraft(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(saved);
          setError(undefined);
        }
      }}
    />
  );
}

function PhotoEditor({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const update = useUpdateMe(t("profile.photo.saveError"));
  const [src, setSrc] = useState<string | null>(null);
  const [filename, setFilename] = useState("photo");
  const [saving, setSaving] = useState(false);

  const close = () => {
    if (src) URL.revokeObjectURL(src);
    setSrc(null);
  };

  const choose = async () => {
    const file = await pickFile(imageMimes.join(","));
    if (!file) return;
    if (!(imageMimes as readonly string[]).includes(file.type)) {
      toast(t("profile.photo.wrongType"));
      return;
    }
    setFilename(file.name.replace(/\.[^.]+$/, "") || "photo");
    setSrc(URL.createObjectURL(file));
  };

  const save = async (area: Area) => {
    if (!src) return;
    setSaving(true);
    let file;
    try {
      const { blob, mime } = await cropToAvatar(src, area);
      const workspaces = await queryClient.query(workspacesQuery);
      const personal = workspaces.find((w) => w.kind === "personal");
      if (!personal) throw new UploadError(t("profile.photo.saveError"));
      file = await uploadFile(blob, {
        workspaceId: personal.id,
        filename: `${filename}.${mime === "image/webp" ? "webp" : "jpg"}`,
        mime,
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
      });
    } catch (err) {
      toast(err instanceof UploadError ? err.message : t("profile.photo.saveError"));
      setSaving(false);
      return;
    }
    // useUpdateMe rolls back and toasts on its own if saving the profile fails.
    update.mutate(
      { patch: { avatarFileId: file.id }, optimistic: { avatarUrl: file.url } },
      {
        onSettled: () => {
          setSaving(false);
          close();
        },
      },
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Avatar id={me.id} name={me.name} imageUrl={me.avatarUrl} size={72} />
      <div className="flex flex-wrap gap-2">
        <Pill onClick={() => void choose()}>
          {me.avatarUrl ? t("profile.photo.change") : t("profile.photo.upload")}
        </Pill>
        {me.avatarFileId && (
          <Pill
            variant="ghost"
            onClick={() => {
              update.mutate({ patch: { avatarFileId: null }, optimistic: { avatarUrl: null } });
            }}
          >
            {t("profile.photo.remove")}
          </Pill>
        )}
      </div>
      <AvatarCropDialog
        key={src ?? "closed"}
        src={src}
        saving={saving}
        onCancel={close}
        onSave={(area) => void save(area)}
      />
    </div>
  );
}

interface ChoiceOption<T extends string> {
  id: T;
  label: string;
}

function ChoiceMenu<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (value: T) => void;
}) {
  const current = options.find((o) => o.id === value);
  return (
    <Menu>
      <MenuTrigger asChild>
        <Pill trailing={<ChevronDown />} aria-label={`${label}: ${current?.label ?? value}`}>
          {current?.label ?? value}
        </Pill>
      </MenuTrigger>
      <MenuContent align="end">
        {options.map((o) => (
          <MenuItem
            key={o.id}
            onSelect={() => {
              if (o.id !== value) onChange(o.id);
            }}
            trailing={o.id === value ? <Check aria-label={t("common.selected")} /> : undefined}
          >
            {o.label}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

function LanguageCard({ me }: { me: Me }) {
  const update = useUpdateMe(t("profile.saveError"));
  const options = [
    { id: "system", label: t("profile.language.system") },
    ...languages.map((l) => ({ id: l.id, label: l.name })),
  ] as const;
  return (
    <SettingsCard title={t("profile.language")} description={t("profile.language.description")}>
      <ChoiceMenu
        label={t("profile.language")}
        value={me.locale}
        options={options}
        onChange={(locale) => {
          update.mutate({ patch: { locale } });
        }}
      />
    </SettingsCard>
  );
}

const dayName = (day: number, locale: string) =>
  // 2023-01-01 was a Sunday, so day 0…6 maps to the 1st…7th.
  new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2023, 0, 1 + day)),
  );

function WeekStartCard({ me }: { me: Me }) {
  const update = useUpdateMe(t("profile.saveError"));
  const locale = systemLocale();
  const system = dayName(resolveWeekStart("system", systemFirstDay(locale)), locale);
  const options: ChoiceOption<WeekStart>[] = [
    { id: "system", label: t("profile.weekStart.system", { day: system }) },
    { id: "mon", label: dayName(1, locale) },
    { id: "sun", label: dayName(0, locale) },
    { id: "sat", label: dayName(6, locale) },
  ];
  return (
    <SettingsCard title={t("profile.weekStart")} description={t("profile.weekStart.description")}>
      <ChoiceMenu
        label={t("profile.weekStart")}
        value={me.weekStart}
        options={options}
        onChange={(weekStart) => {
          update.mutate({ patch: { weekStart } });
        }}
      />
    </SettingsCard>
  );
}

function TimeZoneCard({ me }: { me: Me }) {
  const update = useUpdateMe(t("profile.saveError"));
  const device = systemTimeZone();
  const save = (timezone: string) => {
    update.mutate({ patch: { timezone } });
  };
  return (
    <SettingsCard
      title={t("profile.timezone")}
      description={
        device === me.timezone ? (
          t("profile.timezone.description")
        ) : (
          <>
            {t("profile.timezone.deviceDiffers", { zone: device })}{" "}
            <button
              type="button"
              className="cursor-pointer font-medium text-accent underline-offset-2 hover:underline"
              onClick={() => {
                save(device);
              }}
            >
              {t("profile.timezone.useDevice")}
            </button>
          </>
        )
      }
    >
      <TimeZonePicker value={me.timezone} onChange={save} />
    </SettingsCard>
  );
}
