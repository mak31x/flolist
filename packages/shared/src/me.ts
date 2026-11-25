import { z } from "zod";
import { mutationMetaSchema } from "./workspaces.ts";

/**
 * Theme preferences the server accepts (settings-and-account.md → Themes). Must match
 * `themes` in packages/ui/src/theme.ts; M6 adds the remaining token sets to both.
 */
export const themePreferenceSchema = z.enum(["system", "light", "dark"]);

export const weekStartSchema = z.enum(["system", "mon", "sun", "sat"]);

/** The signed-in user's own profile and preferences (`GET /api/v1/me`). */
export const meSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  emailVerified: z.boolean(),
  image: z.string().nullable(),
  theme: themePreferenceSchema,
  timezone: z.string(),
  weekStart: weekStartSchema,
  version: z.number().int(),
});
export type Me = z.infer<typeof meSchema>;

/** Profile fields arrive in M1.2; M1.1 only moves the theme onto the user record. */
export const updateMeSchema = mutationMetaSchema.extend({ theme: themePreferenceSchema });
export type UpdateMe = z.infer<typeof updateMeSchema>;

/** Public, unauthenticated app config (`GET /api/config`) the sign-in screens need. */
export const publicConfigSchema = z.object({
  /** "Continue with Google" is shown only when the server has Google OAuth keys. */
  googleSignIn: z.boolean(),
});
export type PublicConfig = z.infer<typeof publicConfigSchema>;
