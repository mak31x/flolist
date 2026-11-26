import { z } from "zod";

/**
 * Upload rules shared by the API and the web app (D-012, D-013, D-037).
 * Images in `imageMimes` are checked by their magic bytes and shown inline; any other type is
 * accepted as an attachment (M2.3) and always downloads (`Content-Disposition: attachment`).
 */
export const imageMimes = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type ImageMime = (typeof imageMimes)[number];

export function isInlineImage(mime: string): mime is ImageMime {
  return (imageMimes as readonly string[]).includes(mime);
}

/** Fallback for files the browser can't type. */
export const GENERIC_MIME = "application/octet-stream";

/** A `type/subtype` MIME (parameters dropped by the client). */
export const uploadMimeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(255)
  .regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/, {
    error: "Not a valid MIME type",
  });
export type UploadMime = z.infer<typeof uploadMimeSchema>;

export const DEFAULT_MAX_UPLOAD_MB = 25;

export const fileSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  filename: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  status: z.enum(["pending", "ready"]),
  /** Same-origin URL that redirects to a short-lived presigned download. */
  url: z.string(),
  createdAt: z.iso.datetime(),
});
export type FileDto = z.infer<typeof fileSchema>;

/** `POST /api/v1/uploads`: reserve a file and get a presigned PUT. */
export const createUploadSchema = z.object({
  /** Client-generated UUIDv7 (D-006), so a retried request doesn't create two files. */
  id: z.uuid(),
  workspaceId: z.uuid(),
  filename: z.string().trim().min(1).max(255),
  mime: uploadMimeSchema,
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive().max(20_000).optional(),
  height: z.number().int().positive().max(20_000).optional(),
});
export type CreateUpload = z.infer<typeof createUploadSchema>;

export const uploadTicketSchema = z.object({
  file: fileSchema,
  upload: z.object({
    /**
     * A presigned object-storage URL (direct mode), or the same-origin
     * `/api/v1/uploads/:id/content` when the API relays the bytes (D-037).
     */
    url: z.string().min(1),
    method: z.literal("PUT"),
    /** Send exactly these headers with the PUT (they're part of the signature). */
    headers: z.record(z.string(), z.string()),
    expiresAt: z.iso.datetime(),
  }),
});
export type UploadTicket = z.infer<typeof uploadTicketSchema>;

export const fileIdParamSchema = z.object({ id: z.uuid() });

/** The same-origin download path for a file id. */
export const fileUrl = (id: string) => `/api/v1/files/${id}`;

/** Detects an image type from its first bytes (never trust the declared MIME). */
export function sniffImageMime(bytes: Uint8Array): (typeof imageMimes)[number] | null {
  const at = (i: number) => bytes[i] ?? -1;
  const ascii = (from: number, s: string) =>
    Array.from({ length: s.length }, (_, i) => s.charCodeAt(i)).every(
      (code, i) => at(from + i) === code,
    );
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (at(0) === 0x89 && ascii(1, "PNG\r\n\x1a\n")) return "image/png";
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "image/gif";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  return null;
}
