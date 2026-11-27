import { z } from "zod";
import { clientMutationSchema } from "./lists.ts";

/**
 * Labels (tasks.md → Labels): free text, unique per workspace ignoring case, with an optional
 * colour from the theme palette. Managed in Settings → Labels.
 */

/** Theme colour names; null shows the default grey chip `[assumption]`. Same set as dividers. */
export const LABEL_COLORS = ["gray", "red", "orange", "green", "blue", "purple"] as const;
export const labelColorSchema = z.enum(LABEL_COLORS);
export type LabelColor = z.infer<typeof labelColorSchema>;

/** Characters in a label name `[assumption]`. */
export const MAX_LABEL_NAME = 50;
/** Labels per workspace `[assumption]`. */
export const MAX_WORKSPACE_LABELS = 500;

/** Trimmed, inner whitespace collapsed, a leading `#` dropped ("#Work" → "Work"). */
export function normalizeLabelName(name: string): string {
  return name.trim().replace(/^#+/, "").replace(/\s+/g, " ").trim();
}

export const labelNameSchema = z
  .string()
  .transform(normalizeLabelName)
  .pipe(z.string().min(1, "A label needs a name").max(MAX_LABEL_NAME));

export const labelSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  name: z.string(),
  color: labelColorSchema.nullable(),
  /** Live tasks carrying the label (Settings → Labels). */
  taskCount: z.number().int().min(0),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Label = z.infer<typeof labelSchema>;

/** `GET /labels`: every label in the caller's workspaces, by name. */
export const labelPageSchema = z.object({ items: z.array(labelSchema) });
export type LabelPage = z.infer<typeof labelPageSchema>;

/**
 * `POST /labels`. Creating a name that already exists (ignoring case) answers the existing label
 * instead of failing, so typing a name and pressing Enter always ends with that label.
 */
export const createLabelSchema = clientMutationSchema.extend({
  id: z.uuid(),
  workspaceId: z.uuid(),
  name: labelNameSchema,
  color: labelColorSchema.nullable().optional(),
});
export type CreateLabel = z.infer<typeof createLabelSchema>;

/** `PATCH /labels/:id`. Renaming to another label's name merges this one into it. */
export const updateLabelSchema = clientMutationSchema
  .extend({
    name: labelNameSchema.optional(),
    color: labelColorSchema.nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.color !== undefined, {
    error: "Send at least one field to change",
  });
export type UpdateLabel = z.infer<typeof updateLabelSchema>;

/** The answer to `PATCH /labels/:id`: the surviving label, and the id that merged into it. */
export const updateLabelResultSchema = z.object({
  label: labelSchema,
  mergedFrom: z.uuid().nullable(),
});
export type UpdateLabelResult = z.infer<typeof updateLabelResultSchema>;

export const deleteLabelSchema = clientMutationSchema;
