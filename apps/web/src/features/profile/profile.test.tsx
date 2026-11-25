import type { Me } from "@flolist/shared";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, renderApp, stubFetch, testMe, urlOf } from "../../test-utils.tsx";
import { meQuery } from "../auth/api.ts";
import { UploadError, uploadFile } from "../files/upload.ts";
import { modernZone, timeZones } from "../../platform/index.ts";
import { zoneLabel, zoneOffset } from "./zones.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Stubs PATCH /api/v1/me to echo the patch onto `testMe` and records the bodies. */
function stubPatchMe(status = 200) {
  const bodies: Record<string, unknown>[] = [];
  stubFetch({
    "PATCH /api/v1/me": async (req) => {
      const body = (await req.json()) as Record<string, unknown>;
      bodies.push(body);
      if (status !== 200)
        return jsonResponse({ error: { code: "INTERNAL", message: "x" } }, status);
      const patch = Object.fromEntries(
        Object.entries(body).filter(([k]) => k !== "clientMutationId" && k !== "baseVersion"),
      );
      const next = { ...testMe, ...patch, version: testMe.version + 1 };
      return jsonResponse({ ...next, name: `${next.firstName} ${next.lastName}`.trim() });
    },
  });
  return bodies;
}

describe("Settings → Profile", () => {
  it("shows the profile fields with the email read-only", async () => {
    renderApp("/settings/profile");
    expect(await screen.findByRole("heading", { name: "Personal info" })).toBeInTheDocument();
    expect(screen.getByLabelText("First name")).toHaveValue("Ada");
    expect(screen.getByLabelText("Last name")).toHaveValue("Lovelace");
    expect(screen.getByLabelText("Email")).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Upload photo" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "First day of the week" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "App language" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Time zone" })).toBeInTheDocument();
  });

  it("saves a name on blur and updates the cached user at once", async () => {
    const bodies = stubPatchMe();
    const { queryClient } = renderApp("/settings/profile");
    const first = await screen.findByLabelText("First name");
    await userEvent.clear(first);
    await userEvent.type(first, "Augusta{Enter}");
    await waitFor(() => {
      expect(bodies).toHaveLength(1);
    });
    expect(bodies[0]).toMatchObject({ firstName: "Augusta", baseVersion: 1 });
    expect(queryClient.getQueryData<Me | null>(meQuery.queryKey)?.name).toBe("Augusta Lovelace");
  });

  it("won't save an empty first name", async () => {
    const bodies = stubPatchMe();
    renderApp("/settings/profile");
    const first = await screen.findByLabelText("First name");
    await userEvent.clear(first);
    await userEvent.tab();
    expect(await screen.findByText("Enter your first name")).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
  });

  it("changes the first day of the week", async () => {
    const bodies = stubPatchMe();
    renderApp("/settings/profile");
    await userEvent.click(await screen.findByRole("button", { name: /First day of the week:/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Sunday" }));
    await waitFor(() => {
      expect(bodies[0]).toMatchObject({ weekStart: "sun" });
    });
  });

  it("rolls back and explains when saving fails", async () => {
    stubPatchMe(500);
    const { queryClient } = renderApp("/settings/profile");
    await userEvent.click(await screen.findByRole("button", { name: /App language:/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "English" }));
    expect(await screen.findByText("Couldn't save your changes. Try again.")).toBeInTheDocument();
    expect(queryClient.getQueryData<Me | null>(meQuery.queryKey)?.locale).toBe("system");
  });

  it("picks a time zone by searching", async () => {
    const bodies = stubPatchMe();
    renderApp("/settings/profile");
    await userEvent.click(await screen.findByRole("button", { name: "Time zone: UTC" }));
    await userEvent.type(screen.getByRole("combobox"), "kolkata{Enter}");
    await waitFor(() => {
      expect(bodies[0]).toMatchObject({ timezone: "Asia/Kolkata" });
    });
  });
});

describe("time zone names", () => {
  it("lists current IANA names, not the runtime's legacy ones", () => {
    const zones = timeZones();
    expect(zones[0]).toBe("UTC");
    expect(zones).toContain("Asia/Kolkata");
    expect(zones).toContain("Europe/Kyiv");
    expect(zones).not.toContain("Asia/Calcutta");
    expect(modernZone("Asia/Saigon")).toBe("Asia/Ho_Chi_Minh");
    expect(modernZone("Europe/Berlin")).toBe("Europe/Berlin");
  });
});

describe("time zone labels", () => {
  it("formats names and offsets", () => {
    expect(zoneLabel("America/Argentina/Buenos_Aires")).toBe("Buenos Aires (America/Argentina)");
    expect(zoneLabel("UTC")).toBe("UTC");
    expect(zoneOffset("Asia/Kolkata")).toBe("GMT+5:30");
  });
});

describe("uploadFile", () => {
  const ticketFor = (id: string) => ({
    file: {
      id,
      workspaceId: testMe.id,
      filename: "a.webp",
      mime: "image/webp",
      sizeBytes: 3,
      width: 512,
      height: 512,
      status: "pending",
      url: `/api/v1/files/${id}`,
      createdAt: new Date().toISOString(),
    },
    upload: {
      url: "https://s3.test.localhost/bucket/key?X-Amz-Signature=abc",
      method: "PUT",
      headers: { "content-type": "image/webp" },
      expiresAt: new Date().toISOString(),
    },
  });

  it("reserves, PUTs to the presigned URL, then completes", async () => {
    const calls: string[] = [];
    let id = "";
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = urlOf(input);
      calls.push(`${init?.method ?? "GET"} ${url.split("?")[0] ?? ""}`);
      if (url === "/api/v1/uploads") {
        id = (JSON.parse(init?.body as string) as { id: string }).id;
        return Promise.resolve(jsonResponse(ticketFor(id), 201));
      }
      if (url.startsWith("https://s3.test.localhost")) {
        expect(new Headers(init?.headers).get("content-type")).toBe("image/webp");
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      return Promise.resolve(jsonResponse({ ...ticketFor(id).file, status: "ready" }));
    });

    const file = await uploadFile(new Blob(["abc"], { type: "image/webp" }), {
      workspaceId: testMe.id,
      filename: "a.webp",
      mime: "image/webp",
    });
    expect(file.status).toBe("ready");
    expect(calls).toEqual([
      "POST /api/v1/uploads",
      "PUT https://s3.test.localhost/bucket/key",
      `POST /api/v1/uploads/${id}/complete`,
    ]);
  });

  it("surfaces the server's message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: { code: "LIMIT", message: "Files can be up to 25 MB" } }, 403),
    );
    await expect(
      uploadFile(new Blob(["x"]), { workspaceId: testMe.id, filename: "a.png", mime: "image/png" }),
    ).rejects.toEqual(new UploadError("Files can be up to 25 MB", "LIMIT"));
  });
});
