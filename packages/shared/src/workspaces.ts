import { z } from "zod";

export const workspaceKindSchema = z.enum(["personal", "team"]);
export const workspaceRoleSchema = z.enum(["owner", "member"]);

export const workspaceSchema = z.object({
  id: z.uuid(),
  kind: workspaceKindSchema,
  name: z.string(),
  emoji: z.string().nullable(),
  ownerId: z.uuid(),
  /** The caller's role in this workspace. */
  role: workspaceRoleSchema,
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const workspaceListSchema = z.object({ items: z.array(workspaceSchema) });
export type WorkspaceList = z.infer<typeof workspaceListSchema>;

export const workspaceIdParamSchema = z.object({ id: z.uuid() });

/** Every mutation carries these (architecture.md → API conventions). */
export const mutationMetaSchema = z.object({
  clientMutationId: z.uuid(),
  baseVersion: z.number().int().positive(),
});

export const updateWorkspaceSchema = mutationMetaSchema
  .extend({
    name: z.string().trim().min(1).max(100).optional(),
    emoji: z.string().max(16).nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.emoji !== undefined, {
    error: "Send at least one field to change",
  });
export type UpdateWorkspace = z.infer<typeof updateWorkspaceSchema>;
