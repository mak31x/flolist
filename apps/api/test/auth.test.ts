import { workspaceListSchema, meSchema } from "@flolist/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensurePersonalWorkspace } from "../src/auth/personal-workspace.ts";
import { APP_URL, authTestApp, cookiesFrom, linkIn, post } from "./auth-helpers.ts";
import { createTestDb, type TestDb } from "./db.ts";
import { makeUser } from "./factories.ts";
import { userSettings, workspaces } from "@flolist/db";
import { eq } from "drizzle-orm";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.drop();
});

let n = 0;
const newEmail = () => `person${String((n += 1))}-${String(Date.now())}@test.localhost`;
const PASSWORD = "correct horse battery";

/** Signs up and follows the verification link; returns the session cookie. */
async function signUpVerified(ctx: ReturnType<typeof authTestApp>, email = newEmail()) {
  const res = await ctx.app.request(
    "/api/auth/sign-up/email",
    post({ name: "Ada Lovelace", email, password: PASSWORD, callbackURL: "/inbox" }),
  );
  expect(res.status).toBe(200);
  const link = linkIn(await ctx.emailTo(email, /verify/i));
  const verify = await ctx.app.request(link.pathname + link.search);
  return { email, verify, cookie: cookiesFrom(verify) };
}

describe("email/password sign-up and verification", () => {
  it("emails a link, refuses sign-in until verified, then signs in and lands in Inbox", async () => {
    const ctx = authTestApp(t.db);
    const email = newEmail();
    const signUp = await ctx.app.request(
      "/api/auth/sign-up/email",
      post({ name: "Ada Lovelace", email, password: PASSWORD, callbackURL: "/inbox" }),
    );
    expect(signUp.status).toBe(200);
    expect(cookiesFrom(signUp)).not.toContain("session_token");
    const message = await ctx.emailTo(email, /verify/i);

    // Signing in unverified is refused (and re-sends a verification email; sendOnSignIn).
    const early = await ctx.app.request(
      "/api/auth/sign-in/email",
      post({ email, password: PASSWORD }),
    );
    expect(early.status).toBe(403);
    expect(await early.json()).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
    await expect.poll(() => ctx.mailer.sent.filter((m) => m.to === email).length).toBe(2);

    expect(message.subject).toBe("Verify your email for Flolist");
    const link = linkIn(message);
    expect(link.origin).toBe(APP_URL);
    expect(link.pathname).toBe("/api/auth/verify-email");

    const verify = await ctx.app.request(link.pathname + link.search);
    expect(verify.status).toBe(302);
    expect(verify.headers.get("location")).toBe("/inbox");
    const cookie = cookiesFrom(verify);
    expect(cookie).toContain("session_token");

    const me = await ctx.app.request("/api/v1/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(meSchema.parse(await me.json())).toMatchObject({
      email,
      name: "Ada Lovelace",
      emailVerified: true,
      theme: "system",
    });
  });

  it("creates exactly one Personal workspace and the settings row at sign-up", async () => {
    const ctx = authTestApp(t.db);
    const { cookie } = await signUpVerified(ctx);
    const res = await ctx.app.request("/api/v1/workspaces", { headers: { cookie } });
    const { items } = workspaceListSchema.parse(await res.json());
    expect(items.map((w) => [w.kind, w.name, w.role])).toEqual([["personal", "Personal", "owner"]]);
    const me = meSchema.parse(
      await (await ctx.app.request("/api/v1/me", { headers: { cookie } })).json(),
    );
    expect(await t.db.$count(userSettings, eq(userSettings.userId, me.id))).toBe(1);
  });

  it("rejects a short password", async () => {
    const ctx = authTestApp(t.db);
    const res = await ctx.app.request(
      "/api/auth/sign-up/email",
      post({ name: "Short", email: newEmail(), password: "short" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("sessions", () => {
  it("returns 401 from /api/v1 without a session", async () => {
    const ctx = authTestApp(t.db);
    expect((await ctx.app.request("/api/v1/me")).status).toBe(401);
    expect((await ctx.app.request("/api/v1/me", { headers: { cookie: "x=y" } })).status).toBe(401);
  });

  it("issues a bearer token on sign-in for native shells", async () => {
    const ctx = authTestApp(t.db);
    const { email } = await signUpVerified(ctx);
    const signIn = await ctx.app.request(
      "/api/auth/sign-in/email",
      post({ email, password: PASSWORD }),
    );
    expect(signIn.status).toBe(200);
    const token = signIn.headers.get("set-auth-token");
    expect(token).toBeTruthy();
    const me = await ctx.app.request("/api/v1/me", {
      headers: { authorization: `Bearer ${token ?? ""}` },
    });
    expect(me.status).toBe(200);
  });

  it("signs out", async () => {
    const ctx = authTestApp(t.db);
    const { cookie } = await signUpVerified(ctx);
    const out = await ctx.app.request("/api/auth/sign-out", post({}, { cookie }));
    expect(out.status).toBe(200);
    expect((await ctx.app.request("/api/v1/me", { headers: { cookie } })).status).toBe(401);
  });

  it("sets HttpOnly, SameSite=Lax session cookies", async () => {
    const ctx = authTestApp(t.db);
    const { verify } = await signUpVerified(ctx);
    const sessionCookie = verify.headers.getSetCookie().find((c) => c.includes("session_token="));
    expect(sessionCookie).toMatch(/HttpOnly/i);
    expect(sessionCookie).toMatch(/SameSite=Lax/i);
  });
});

describe("password reset", () => {
  it("emails a reset link, changes the password and revokes old sessions", async () => {
    const ctx = authTestApp(t.db);
    const { email, cookie } = await signUpVerified(ctx);

    const ask = await ctx.app.request(
      "/api/auth/request-password-reset",
      post({ email, redirectTo: "/reset-password" }),
    );
    expect(ask.status).toBe(200);
    const link = linkIn(await ctx.emailTo(email, /reset/i));
    const token = link.pathname.split("/").at(-1) ?? "";

    // Following the link redirects to the web page with the token.
    const follow = await ctx.app.request(link.pathname + link.search);
    expect(follow.status).toBe(302);
    expect(follow.headers.get("location")).toBe(`${APP_URL}/reset-password?token=${token}`);

    const newPassword = "a whole new password";
    const reset = await ctx.app.request("/api/auth/reset-password", post({ token, newPassword }));
    expect(reset.status).toBe(200);

    expect((await ctx.app.request("/api/v1/me", { headers: { cookie } })).status).toBe(401);
    const oldPw = await ctx.app.request(
      "/api/auth/sign-in/email",
      post({ email, password: PASSWORD }),
    );
    expect(oldPw.status).toBe(401);
    const newPw = await ctx.app.request(
      "/api/auth/sign-in/email",
      post({ email, password: newPassword }),
    );
    expect(newPw.status).toBe(200);
  });

  it("answers the same for an unknown email and sends nothing", async () => {
    const ctx = authTestApp(t.db);
    const res = await ctx.app.request(
      "/api/auth/request-password-reset",
      post({ email: "nobody@test.localhost", redirectTo: "/reset-password" }),
    );
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(ctx.mailer.sent).toHaveLength(0);
  });
});

describe("/api/v1/me", () => {
  it("saves the theme on the user record for cookie requests from the app's origin", async () => {
    const ctx = authTestApp(t.db);
    const { cookie } = await signUpVerified(ctx);
    const body = JSON.stringify({
      theme: "dark",
      clientMutationId: crypto.randomUUID(),
      baseVersion: 1,
    });
    const headers = { cookie, "content-type": "application/json" };

    const blocked = await ctx.app.request("/api/v1/me", { method: "PATCH", body, headers });
    expect(blocked.status).toBe(403);
    const crossSite = await ctx.app.request("/api/v1/me", {
      method: "PATCH",
      body,
      headers: { ...headers, origin: "https://evil.example" },
    });
    expect(crossSite.status).toBe(403);

    const ok = await ctx.app.request("/api/v1/me", {
      method: "PATCH",
      body,
      headers: { ...headers, origin: APP_URL },
    });
    expect(ok.status).toBe(200);
    expect(meSchema.parse(await ok.json()).theme).toBe("dark");
  });

  it("rejects an unknown theme", async () => {
    const ctx = authTestApp(t.db);
    const { cookie } = await signUpVerified(ctx);
    const res = await ctx.app.request("/api/v1/me", {
      method: "PATCH",
      body: JSON.stringify({
        theme: "neon",
        clientMutationId: crypto.randomUUID(),
        baseVersion: 1,
      }),
      headers: { cookie, origin: APP_URL, "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
  });
});

describe("guards", () => {
  it("rate-limits sign-in attempts per IP", async () => {
    const ctx = authTestApp(t.db, { authRateLimit: 3 });
    const attempt = () =>
      ctx.app.request(
        "/api/auth/sign-in/email",
        post(
          { email: "x@test.localhost", password: "wrong-password" },
          { "x-test-ip": "203.0.113.9" },
        ),
      );
    for (let i = 0; i < 3; i += 1) expect((await attempt()).status).toBe(401);
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
  });

  it("doesn't let users create organizations before Teams exist (M7.1)", async () => {
    const ctx = authTestApp(t.db);
    const { cookie } = await signUpVerified(ctx);
    const res = await ctx.app.request(
      "/api/auth/organization/create",
      post({ name: "Acme", slug: `acme-${String(Date.now())}` }, { cookie }),
    );
    expect(res.status).toBe(403);
  });
});

describe("ensurePersonalWorkspace", () => {
  it("is idempotent", async () => {
    const u = await makeUser(t.db);
    await ensurePersonalWorkspace(t.db, u.id);
    await ensurePersonalWorkspace(t.db, u.id);
    expect(await t.db.$count(workspaces, eq(workspaces.ownerId, u.id))).toBe(1);
    expect(await t.db.$count(userSettings, eq(userSettings.userId, u.id))).toBe(1);
  });
});
