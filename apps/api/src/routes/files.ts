import { files, user, workspaces } from "@flolist/db";
import {
  createUploadSchema,
  fileIdParamSchema,
  fileUrl,
  imageMimes,
  sniffImageMime,
  type FileDto,
  type UploadTicket,
} from "@flolist/shared";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { authorize } from "../authz/authorize.ts";
import { ApiException, notFound, unauthenticated } from "../lib/errors.ts";
import { validate } from "../middleware/validate.ts";
import type { Storage } from "../storage/storage.ts";
import { dbOf, type AppEnv } from "../types.ts";

type FileRow = typeof files.$inferSelect;

export interface FileRoutesOptions {
  /** Null when S3 isn't configured: every route then answers UNAVAILABLE. */
  storage: Storage | null;
  maxUploadBytes: number;
  /** Undefined = unlimited. */
  maxWorkspaceBytes?: number | undefined;
  /**
   * Browsers PUT straight to presigned storage URLs. Needs bucket CORS for the app's origin
   * (RustFS in dev has it). Off = the browser PUTs to the API, which relays the bytes (D-037).
   */
  directUpload?: boolean;
}

/** Presigned PUTs live 15 minutes; downloads 10, and the redirect itself is cached for 5. */
const PUT_TTL_S = 15 * 60;
const GET_TTL_S = 10 * 60;
const REDIRECT_CACHE_S = 5 * 60;
const SNIFF_BYTES = 16;

export function toFileDto(f: FileRow): FileDto {
  return {
    id: f.id,
    workspaceId: f.workspaceId,
    filename: f.filename,
    mime: f.mime,
    sizeBytes: f.sizeBytes,
    width: f.width,
    height: f.height,
    status: f.status,
    url: fileUrl(f.id),
    createdAt: f.createdAt.toISOString(),
  };
}

/** Bucket keys come from ids only, never from the filename. */
const storageKeyFor = (workspaceId: string, fileId: string) => `ws/${workspaceId}/${fileId}`;

function requireStorage(storage: Storage | null): Storage {
  if (!storage) {
    throw new ApiException("UNAVAILABLE", "File storage isn't configured on this server");
  }
  return storage;
}

const mb = (bytes: number) => `${String(Math.round((bytes / 1024 / 1024) * 10) / 10)} MB`;

/**
 * `POST /api/v1/uploads` reserves a file and returns a presigned PUT;
 * `POST /api/v1/uploads/:id/complete` checks what arrived and marks it ready.
 */
export function uploadRoutes(opts: FileRoutesOptions) {
  return (
    new Hono<AppEnv>()
      .post("/", validate("json", createUploadSchema), async (c) => {
        const storage = requireStorage(opts.storage);
        const input = c.req.valid("json");
        const db = dbOf(c);
        const { user: caller } = await authorize(db, c.get("user"), "workspace.uploadFile", {
          type: "workspace",
          id: input.workspaceId,
        });

        if (input.sizeBytes > opts.maxUploadBytes) {
          throw new ApiException("LIMIT", `Files can be up to ${mb(opts.maxUploadBytes)}`);
        }

        const [existing] = await db.select().from(files).where(eq(files.id, input.id));
        let row: FileRow;
        if (existing) {
          // A retried request: hand out a fresh URL for the same pending file.
          if (
            existing.uploadedBy !== caller.id ||
            existing.workspaceId !== input.workspaceId ||
            existing.status !== "pending"
          ) {
            throw new ApiException("CONFLICT", "A file with this id already exists");
          }
          row = existing;
        } else {
          if (opts.maxWorkspaceBytes !== undefined) {
            const [usage] = await db
              .select({ total: sql<string>`coalesce(sum(${files.sizeBytes}), 0)` })
              .from(files)
              .where(eq(files.workspaceId, input.workspaceId));
            if (Number(usage?.total ?? 0) + input.sizeBytes > opts.maxWorkspaceBytes) {
              throw new ApiException("LIMIT", "This workspace has run out of file storage");
            }
          }
          const [inserted] = await db
            .insert(files)
            .values({
              id: input.id,
              workspaceId: input.workspaceId,
              storageKey: storageKeyFor(input.workspaceId, input.id),
              filename: input.filename,
              mime: input.mime,
              sizeBytes: input.sizeBytes,
              width: input.width ?? null,
              height: input.height ?? null,
              uploadedBy: caller.id,
            })
            .onConflictDoNothing()
            .returning();
          if (!inserted) throw new ApiException("CONFLICT", "A file with this id already exists");
          row = inserted;
        }

        const put = opts.directUpload
          ? await storage.presignPut(row.storageKey, { mime: row.mime, expiresIn: PUT_TTL_S })
          : { url: `/api/v1/uploads/${row.id}/content`, headers: { "content-type": row.mime } };
        const body: UploadTicket = {
          file: toFileDto(row),
          upload: {
            url: put.url,
            method: "PUT",
            headers: put.headers,
            expiresAt: new Date(Date.now() + PUT_TTL_S * 1000).toISOString(),
          },
        };
        return c.json(body, existing ? 200 : 201);
      })

      /**
       * Relay mode: the bytes come to the API (same origin, so no bucket CORS) and are
       * stored under the file's key. Only the uploader, only while the file is pending.
       */
      .put(
        "/:id/content",
        validate("param", fileIdParamSchema),
        bodyLimit({
          maxSize: opts.maxUploadBytes,
          onError: () => {
            throw new ApiException("LIMIT", `Files can be up to ${mb(opts.maxUploadBytes)}`);
          },
        }),
        async (c) => {
          const storage = requireStorage(opts.storage);
          const caller = c.get("user");
          if (!caller) throw unauthenticated();
          const db = dbOf(c);
          const { id } = c.req.valid("param");
          const [row] = await db
            .select()
            .from(files)
            .where(and(eq(files.id, id), eq(files.uploadedBy, caller.id)));
          if (!row) throw notFound("File");
          await authorize(db, caller, "workspace.uploadFile", {
            type: "workspace",
            id: row.workspaceId,
          });
          if (row.status !== "pending") {
            throw new ApiException("CONFLICT", "This file has already been uploaded");
          }
          if (c.req.header("content-type") !== row.mime) {
            throw new ApiException("VALIDATION", `Send the file as ${row.mime}`);
          }
          const bytes = new Uint8Array(await c.req.arrayBuffer());
          await storage.put(row.storageKey, bytes, row.mime);
          return c.body(null, 204);
        },
      )

      .post("/:id/complete", validate("param", fileIdParamSchema), async (c) => {
        const storage = requireStorage(opts.storage);
        const caller = c.get("user");
        if (!caller) throw unauthenticated();
        const db = dbOf(c);
        const { id } = c.req.valid("param");

        // Only the uploader can complete; anyone else gets NOT_FOUND so ids don't leak.
        const [row] = await db
          .select()
          .from(files)
          .where(and(eq(files.id, id), eq(files.uploadedBy, caller.id)));
        if (!row) throw notFound("File");
        // Membership may have ended since the upload started.
        await authorize(db, caller, "workspace.uploadFile", {
          type: "workspace",
          id: row.workspaceId,
        });
        if (row.status === "ready") return c.json(toFileDto(row));

        const stored = await storage.head(row.storageKey);
        if (!stored) {
          throw new ApiException("VALIDATION", "The file hasn't been uploaded yet");
        }

        const reject = async (code: "LIMIT" | "VALIDATION", message: string) => {
          await storage.delete(row.storageKey);
          await db.delete(files).where(eq(files.id, row.id));
          return new ApiException(code, message);
        };

        if (stored.size > opts.maxUploadBytes) {
          throw await reject("LIMIT", `Files can be up to ${mb(opts.maxUploadBytes)}`);
        }
        if ((imageMimes as readonly string[]).includes(row.mime)) {
          const sniffed = sniffImageMime(await storage.readStart(row.storageKey, SNIFF_BYTES));
          if (sniffed !== row.mime) {
            throw await reject("VALIDATION", "The file isn't a valid image of the declared type");
          }
        }

        const [ready] = await db
          .update(files)
          .set({ status: "ready", sizeBytes: stored.size, readyAt: new Date() })
          .where(eq(files.id, row.id))
          .returning();
        if (!ready) throw notFound("File");
        return c.json(toFileDto(ready));
      })
  );
}

/**
 * `GET /api/v1/files/:id` redirects to a short-lived presigned download. Access follows
 * the file's workspace; a file that is someone's (or a workspace's) avatar is visible to
 * any signed-in user, because avatars show up wherever that person does [assumption].
 */
export function fileRoutes(opts: FileRoutesOptions) {
  return new Hono<AppEnv>().get("/:id", validate("param", fileIdParamSchema), async (c) => {
    const caller = c.get("user");
    if (!caller) throw unauthenticated();
    const storage = requireStorage(opts.storage);
    const db = dbOf(c);
    const { id } = c.req.valid("param");

    const [row] = await db
      .select()
      .from(files)
      .where(and(eq(files.id, id), eq(files.status, "ready")));
    if (!row) throw notFound("File");

    if (!(await isAvatar(db, row.id))) {
      try {
        await authorize(db, caller, "workspace.view", { type: "workspace", id: row.workspaceId });
      } catch (err) {
        if (err instanceof ApiException && err.code !== "UNAUTHENTICATED") throw notFound("File");
        throw err;
      }
    }

    const url = await storage.presignGet(row.storageKey, {
      expiresIn: GET_TTL_S,
      filename: row.filename,
      mime: row.mime,
    });
    c.header("Cache-Control", `private, max-age=${String(REDIRECT_CACHE_S)}`);
    return c.redirect(url, 302);
  });
}

async function isAvatar(db: ReturnType<typeof dbOf>, fileId: string): Promise<boolean> {
  const [hit] = await db
    .select({ one: sql<number>`1` })
    .from(user)
    .where(eq(user.avatarFileId, fileId))
    .union(
      db
        .select({ one: sql<number>`1` })
        .from(workspaces)
        .where(eq(workspaces.avatarFileId, fileId)),
    )
    .limit(1);
  return hit !== undefined;
}
