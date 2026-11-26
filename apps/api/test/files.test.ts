import { files } from "@flolist/db";
import {
  apiErrorSchema,
  fileSchema,
  permissionFixtures,
  uploadTicketSchema,
  type CreateUpload,
} from "@flolist/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { createS3Storage, type Storage } from "../src/storage/storage.ts";
import { createTestDb, type TestDb } from "./db.ts";
import {
  addMember,
  as,
  buildFixture,
  makePersonalWorkspace,
  makeTeam,
  makeUser,
  testApp,
} from "./factories.ts";

let t: TestDb;
let storage: Storage;
beforeAll(async () => {
  t = await createTestDb();
  storage = createS3Storage(inject("s3"));
});
afterAll(async () => {
  await t.drop();
});

/** A PNG signature plus filler: enough for the server's byte sniffing. */
const PNG = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...new Array<number>(56).fill(7),
]);

/** Direct mode by default (browser → presigned URL); the relay tests turn it off. */
const app = (extra: Parameters<typeof testApp>[1] = {}) =>
  testApp(t.db, { storage, directUpload: true, ...extra });

const post = (body: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
  headers: { "content-type": "application/json" },
});

function uploadBody(workspaceId: string, over: Partial<CreateUpload> = {}): CreateUpload {
  return {
    id: crypto.randomUUID(),
    workspaceId,
    filename: "photo.png",
    mime: "image/png",
    sizeBytes: PNG.byteLength,
    width: 64,
    height: 64,
    ...over,
  };
}

async function putBytes(
  ticket: { upload: { url: string; headers: Record<string, string> } },
  bytes: Uint8Array,
) {
  const res = await fetch(ticket.upload.url, {
    method: "PUT",
    headers: ticket.upload.headers,
    body: bytes,
  });
  expect(res.status, await res.clone().text()).toBe(200);
}

/** Reserve, PUT and complete one file; returns the completed file. */
async function uploadFile(
  who: { id: string },
  workspaceId: string,
  bytes: Uint8Array = PNG,
  over: Partial<CreateUpload> = {},
) {
  const a = app();
  const res = await a.request(
    "/api/v1/uploads",
    as(who, post(uploadBody(workspaceId, { sizeBytes: bytes.byteLength, ...over }))),
  );
  expect(res.status).toBe(201);
  const ticket = uploadTicketSchema.parse(await res.json());
  await putBytes(ticket, bytes);
  const done = await a.request(
    `/api/v1/uploads/${ticket.file.id}/complete`,
    as(who, { method: "POST" }),
  );
  return { res: done, ticket };
}

describe("POST /api/v1/uploads", () => {
  it("returns 401 without a user", async () => {
    const res = await app().request("/api/v1/uploads", post(uploadBody(crypto.randomUUID())));
    expect(res.status).toBe(401);
  });

  it("reserves a pending file and returns a presigned PUT", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const body = uploadBody(ws.id);
    const res = await app().request("/api/v1/uploads", as(me, post(body)));
    expect(res.status).toBe(201);
    const ticket = uploadTicketSchema.parse(await res.json());
    expect(ticket.file).toMatchObject({ id: body.id, status: "pending", workspaceId: ws.id });
    expect(ticket.upload.headers).toEqual({ "content-type": "image/png" });
    const [row] = await t.db.select().from(files).where(eq(files.id, body.id));
    expect(row?.storageKey).toBe(`ws/${ws.id}/${body.id}`);
  });

  it("is idempotent for a retried reservation", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const body = uploadBody(ws.id);
    expect((await app().request("/api/v1/uploads", as(me, post(body)))).status).toBe(201);
    expect((await app().request("/api/v1/uploads", as(me, post(body)))).status).toBe(200);
    const other = await makeUser(t.db);
    const ows = await makePersonalWorkspace(t.db, other);
    const stolen = await app().request(
      "/api/v1/uploads",
      as(other, post({ ...body, workspaceId: ows.id })),
    );
    expect(stolen.status).toBe(409);
  });

  it("rejects files over the size limit and malformed types", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const big = await app({ maxUploadBytes: 10 }).request(
      "/api/v1/uploads",
      as(me, post(uploadBody(ws.id))),
    );
    expect(big.status).toBe(403);
    expect(apiErrorSchema.parse(await big.json()).error.code).toBe("LIMIT");

    const bad = await app().request(
      "/api/v1/uploads",
      as(me, post({ ...uploadBody(ws.id), mime: "not a mime" })),
    );
    expect(bad.status).toBe(400);
  });

  it("enforces the workspace storage limit", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const limited = app({ maxWorkspaceBytes: PNG.byteLength * 1.5 });
    expect((await limited.request("/api/v1/uploads", as(me, post(uploadBody(ws.id))))).status).toBe(
      201,
    );
    const second = await limited.request("/api/v1/uploads", as(me, post(uploadBody(ws.id))));
    expect(second.status).toBe(403);
    expect(apiErrorSchema.parse(await second.json()).error.code).toBe("LIMIT");
  });

  it("answers UNAVAILABLE when storage isn't configured", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const res = await testApp(t.db).request("/api/v1/uploads", as(me, post(uploadBody(ws.id))));
    expect(res.status).toBe(503);
    expect(apiErrorSchema.parse(await res.json()).error.code).toBe("UNAVAILABLE");
  });

  it("rate-limits reservations per user", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const limited = app({ uploadRateLimit: { limit: 2, windowMs: 60_000 } });
    for (let i = 0; i < 2; i += 1) {
      expect(
        (await limited.request("/api/v1/uploads", as(me, post(uploadBody(ws.id))))).status,
      ).toBe(201);
    }
    expect((await limited.request("/api/v1/uploads", as(me, post(uploadBody(ws.id))))).status).toBe(
      429,
    );
  });

  // Every workspace.uploadFile fixture, through the real route.
  const uploadCases = permissionFixtures.filter((f) => f.action === "workspace.uploadFile");
  it.each(uploadCases.map((f) => [f.name, f] as const))("fixture: %s", async (_n, f) => {
    const { actor, workspace } = await buildFixture(t.db, f.setup);
    const res = await app().request("/api/v1/uploads", as(actor, post(uploadBody(workspace.id))));
    const expected = { allow: 201, forbidden: 403, not_found: 404 }[f.expected];
    expect(res.status).toBe(expected);
  });
});

describe("POST /api/v1/uploads/:id/complete", () => {
  it("marks the file ready after checking the stored bytes", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const { res, ticket } = await uploadFile(me, ws.id);
    expect(res.status).toBe(200);
    expect(fileSchema.parse(await res.json())).toMatchObject({
      id: ticket.file.id,
      status: "ready",
      sizeBytes: PNG.byteLength,
    });
    // Completing twice is harmless.
    const again = await app().request(
      `/api/v1/uploads/${ticket.file.id}/complete`,
      as(me, { method: "POST" }),
    );
    expect(again.status).toBe(200);
  });

  it("says so when nothing was uploaded yet", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const body = uploadBody(ws.id);
    await app().request("/api/v1/uploads", as(me, post(body)));
    const res = await app().request(
      `/api/v1/uploads/${body.id}/complete`,
      as(me, { method: "POST" }),
    );
    expect(res.status).toBe(400);
    const [row] = await t.db.select().from(files).where(eq(files.id, body.id));
    expect(row?.status).toBe("pending");
  });

  it("rejects and removes bytes that aren't the declared image type", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    const { res, ticket } = await uploadFile(me, ws.id, html);
    expect(res.status).toBe(400);
    expect(await t.db.$count(files, eq(files.id, ticket.file.id))).toBe(0);
    expect(await storage.head(`ws/${ws.id}/${ticket.file.id}`)).toBeNull();
  });

  it("rejects an object larger than the limit even if the reservation was small", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const limit = PNG.byteLength + 8;
    const a = app({ maxUploadBytes: limit });
    const res = await a.request("/api/v1/uploads", as(me, post(uploadBody(ws.id))));
    const ticket = uploadTicketSchema.parse(await res.json());
    const big = new Uint8Array(limit * 4);
    big.set(PNG);
    await putBytes(ticket, big);
    const done = await a.request(
      `/api/v1/uploads/${ticket.file.id}/complete`,
      as(me, { method: "POST" }),
    );
    expect(done.status).toBe(403);
    expect(await t.db.$count(files, eq(files.id, ticket.file.id))).toBe(0);
  });

  it("is NOT_FOUND for someone else's upload", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const body = uploadBody(ws.id);
    await app().request("/api/v1/uploads", as(me, post(body)));
    const other = await makeUser(t.db);
    const res = await app().request(
      `/api/v1/uploads/${body.id}/complete`,
      as(other, { method: "POST" }),
    );
    expect(res.status).toBe(404);
  });

  it("is NOT_FOUND once the uploader has left the team", async () => {
    const owner = await makeUser(t.db);
    const me = await makeUser(t.db);
    const team = await makeTeam(t.db, owner);
    await addMember(t.db, team, me);
    const body = uploadBody(team.id);
    await app().request("/api/v1/uploads", as(me, post(body)));
    await t.db.execute(
      `delete from member where user_id = '${me.id}' and organization_id = '${team.organizationId ?? ""}'`,
    );
    const res = await app().request(
      `/api/v1/uploads/${body.id}/complete`,
      as(me, { method: "POST" }),
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/files/:id", () => {
  it("redirects a workspace member to a presigned download that serves the bytes", async () => {
    const owner = await makeUser(t.db);
    const mate = await makeUser(t.db);
    const team = await makeTeam(t.db, owner);
    await addMember(t.db, team, mate);
    const { ticket } = await uploadFile(owner, team.id);

    const res = await app().request(`/api/v1/files/${ticket.file.id}`, as(mate));
    expect(res.status).toBe(302);
    expect(res.headers.get("cache-control")).toContain("private");
    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    const download = await fetch(location ?? "");
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(PNG);
  });

  it("serves any non-image file (SVG included) as a download, never inline", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>");
    const { res: done, ticket } = await uploadFile(me, ws.id, svg, {
      filename: "logo.svg",
      mime: "image/svg+xml",
    });
    expect(done.status, await done.clone().text()).toBe(200);
    const res = await app().request(`/api/v1/files/${ticket.file.id}`, as(me));
    const download = await fetch(res.headers.get("location") ?? "");
    expect(download.headers.get("content-type")).toBe("application/octet-stream");
    expect(download.headers.get("content-disposition")).toMatch(/^attachment; filename="logo.svg"/);

    const { ticket: png } = await uploadFile(me, ws.id);
    const img = await app().request(`/api/v1/files/${png.file.id}`, as(me));
    const shown = await fetch(img.headers.get("location") ?? "");
    expect(shown.headers.get("content-disposition")).toMatch(/^inline;/);
  });

  it("is NOT_FOUND for outsiders, pending files and unknown ids", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const { ticket } = await uploadFile(me, ws.id);
    const stranger = await makeUser(t.db);
    expect((await app().request(`/api/v1/files/${ticket.file.id}`, as(stranger))).status).toBe(404);

    const pending = uploadBody(ws.id);
    await app().request("/api/v1/uploads", as(me, post(pending)));
    expect((await app().request(`/api/v1/files/${pending.id}`, as(me))).status).toBe(404);
    expect((await app().request(`/api/v1/files/${crypto.randomUUID()}`, as(me))).status).toBe(404);
    expect((await app().request(`/api/v1/files/${ticket.file.id}`)).status).toBe(401);
  });

  it("lets any signed-in user see a file that is someone's avatar", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const { ticket } = await uploadFile(me, ws.id);
    const patch = await app().request("/api/v1/me", {
      ...as(me),
      method: "PATCH",
      body: JSON.stringify({
        clientMutationId: crypto.randomUUID(),
        baseVersion: 1,
        avatarFileId: ticket.file.id,
      }),
      headers: { "content-type": "application/json", "x-test-user": me.id },
    });
    expect(patch.status).toBe(200);
    const stranger = await makeUser(t.db);
    expect((await app().request(`/api/v1/files/${ticket.file.id}`, as(stranger))).status).toBe(302);
  });
});

describe("relay mode: PUT /api/v1/uploads/:id/content", () => {
  const relay = (extra: Parameters<typeof testApp>[1] = {}) =>
    app({ directUpload: false, ...extra });
  const putContent = (who: { id: string }, id: string, body: Uint8Array, mime = "image/png") =>
    relay().request(
      `/api/v1/uploads/${id}/content`,
      as(who, { method: "PUT", body, headers: { "content-type": mime } }),
    );

  it("hands out a same-origin URL, stores the bytes and completes", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const res = await relay().request("/api/v1/uploads", as(me, post(uploadBody(ws.id))));
    const ticket = uploadTicketSchema.parse(await res.json());
    expect(ticket.upload.url).toBe(`/api/v1/uploads/${ticket.file.id}/content`);

    expect((await putContent(me, ticket.file.id, PNG)).status).toBe(204);
    const done = await relay().request(
      `/api/v1/uploads/${ticket.file.id}/complete`,
      as(me, { method: "POST" }),
    );
    expect(fileSchema.parse(await done.json()).status).toBe("ready");
    // Once ready, the content can't be replaced.
    expect((await putContent(me, ticket.file.id, PNG)).status).toBe(409);
  });

  it("only accepts the uploader, the declared type and the size limit", async () => {
    const me = await makeUser(t.db);
    const ws = await makePersonalWorkspace(t.db, me);
    const body = uploadBody(ws.id);
    await relay().request("/api/v1/uploads", as(me, post(body)));

    const stranger = await makeUser(t.db);
    expect((await putContent(stranger, body.id, PNG)).status).toBe(404);
    expect((await putContent(me, body.id, PNG, "image/jpeg")).status).toBe(400);

    const big = await relay({ maxUploadBytes: 16 }).request(
      `/api/v1/uploads/${body.id}/content`,
      as(me, { method: "PUT", body: PNG, headers: { "content-type": "image/png" } }),
    );
    expect(big.status).toBe(403);
    expect(apiErrorSchema.parse(await big.json()).error.code).toBe("LIMIT");
    expect(await storage.head(`ws/${ws.id}/${body.id}`)).toBeNull();
  });
});
