import { z } from "zod";
import { mutationMetaSchema } from "./workspaces.ts";

/**
 * Theme preferences the server accepts (settings-and-account.md → Themes). Must match
 * `themes` in packages/ui/src/theme.ts; M6 adds the remaining token sets to both.
 */
export const themePreferenceSchema = z.enum(["system", "light", "dark"]);

export const weekStartSchema = z.enum(["system", "mon", "sun", "sat"]);
export type WeekStart = z.infer<typeof weekStartSchema>;

/** App language (settings-and-account.md → Profile). Only English exists so far. */
export const localePreferenceSchema = z.enum(["system", "en"]);
export type LocalePreference = z.infer<typeof localePreferenceSchema>;

/** True for any IANA zone name the runtime knows (aliases such as "Asia/Calcutta" included). */
export function isValidTimeZone(tz: string): boolean {
  if (tz === "" || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z.string().refine(isValidTimeZone, { error: "Unknown time zone" });

/** 0 = Sunday … 6 = Saturday, like `Date.getDay()`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const weekStartDay = { sun: 0, mon: 1, sat: 6 } as const satisfies Record<string, Weekday>;

/**
 * The first day of the week for a preference. "system" uses the locale's own first day
 * (`systemFirstDay`, from `Intl.Locale#getWeekInfo` where the runtime has it).
 */
export function resolveWeekStart(pref: WeekStart, systemFirstDay: Weekday): Weekday {
  return pref === "system" ? systemFirstDay : weekStartDay[pref];
}

/** Converts `Intl.Locale#getWeekInfo().firstDay` (1 = Monday … 7 = Sunday) to a `Weekday`. */
export function weekdayFromIso(isoDay: number): Weekday {
  return (((isoDay % 7) + 7) % 7) as Weekday;
}

const nameSchema = z.string().trim().max(100);

/** The signed-in user's own profile and preferences (`GET /api/v1/me`). */
export const meSchema = z.object({
  id: z.uuid(),
  /** Display name; kept equal to "first last" once either is set. */
  name: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.email(),
  emailVerified: z.boolean(),
  /** Uploaded photo (`/api/v1/files/:id`) or the OAuth provider's picture; null = initials. */
  avatarUrl: z.string().nullable(),
  avatarFileId: z.uuid().nullable(),
  theme: themePreferenceSchema,
  timezone: z.string(),
  weekStart: weekStartSchema,
  /** Play sounds (task completion); Settings → Sounds edits it in M6.2. */
  soundsEnabled: z.boolean(),
  locale: localePreferenceSchema,
  version: z.number().int(),
});
export type Me = z.infer<typeof meSchema>;

/** Every field is optional; send only what changed (field-level last-write-wins, D-006). */
export const updateMeSchema = mutationMetaSchema
  .extend({
    theme: themePreferenceSchema.optional(),
    firstName: nameSchema.optional(),
    lastName: nameSchema.optional(),
    timezone: timeZoneSchema.optional(),
    weekStart: weekStartSchema.optional(),
    locale: localePreferenceSchema.optional(),
    /** A ready image uploaded by the caller to their personal workspace; null removes it. */
    avatarFileId: z.uuid().nullable().optional(),
  })
  .refine(
    (v) =>
      [v.theme, v.firstName, v.lastName, v.timezone, v.weekStart, v.locale, v.avatarFileId].some(
        (f) => f !== undefined,
      ),
    { error: "Send at least one field to change" },
  )
  .refine((v) => v.firstName === undefined || v.firstName !== "", {
    error: "First name can't be empty",
    path: ["firstName"],
  });
export type UpdateMe = z.infer<typeof updateMeSchema>;

/** Public, unauthenticated app config (`GET /api/config`) the sign-in screens need. */
export const publicConfigSchema = z.object({
  /** "Continue with Google" is shown only when the server has Google OAuth keys. */
  googleSignIn: z.boolean(),
});
export type PublicConfig = z.infer<typeof publicConfigSchema>;
