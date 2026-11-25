import {
  account,
  invitation,
  member,
  organization as organizationTable,
  session,
  user,
  verification,
  type Db,
} from "@flolist/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, organization } from "better-auth/plugins";
import { memberAc, ownerAc } from "better-auth/plugins/organization/access";
import type { Logger } from "pino";
import type { EmailMessage, Mailer } from "../email/mailer.ts";
import type { ResolveUser } from "../types.ts";
import { resetPasswordMessage, verifyEmailMessage } from "../email/templates.ts";
import { ensurePersonalWorkspace } from "./personal-workspace.ts";

/** Header the API sets from the real client IP (TRUST_PROXY-aware) before calling Better Auth. */
export const CLIENT_IP_HEADER = "x-flolist-client-ip";

export interface AuthConfig {
  db: Db;
  mailer: Mailer;
  logger: Logger;
  /** APP_URL: the public origin; the auth API lives at `${appUrl}/api/auth`. */
  appUrl: string;
  secret: string;
  google?: { clientId: string; clientSecret: string } | undefined;
}

/**
 * Better Auth (D-005): email/password with required verification and reset, Google OAuth,
 * Postgres sessions, bearer tokens for the native shells, and the organization plugin
 * for team workspaces (owner/member only, D-022).
 */
export function createAuth(config: AuthConfig) {
  const { db, mailer, logger } = config;

  /**
   * Emails go out in the background so response times don't reveal whether an account
   * exists (Better Auth's advice); failures are logged.
   */
  function sendInBackground(message: EmailMessage, kind: string) {
    mailer.send(message).catch((err: unknown) => {
      logger.error({ err, kind }, "sending email failed");
    });
  }

  return betterAuth({
    appName: "Flolist",
    baseURL: config.appUrl,
    basePath: "/api/auth",
    secret: config.secret,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user,
        session,
        account,
        verification,
        organization: organizationTable,
        member,
        invitation,
      },
      transaction: true,
    }),
    advanced: {
      // Ids come from Postgres' uuidv7() defaults (D-022).
      database: { generateId: false },
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
      useSecureCookies: config.appUrl.startsWith("https://"),
    },
    // The API's own limiter covers /api/auth with stricter limits (app.ts).
    rateLimit: { enabled: false },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user: u, url }) => {
        sendInBackground(resetPasswordMessage({ to: u.email, name: u.name, url }), "reset");
        return Promise.resolve();
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: ({ user: u, url }) => {
        sendInBackground(verifyEmailMessage({ to: u.email, name: u.name, url }), "verify");
        return Promise.resolve();
      },
    },
    socialProviders: config.google
      ? { google: { clientId: config.google.clientId, clientSecret: config.google.clientSecret } }
      : {},
    databaseHooks: {
      user: {
        create: {
          after: async (created) => {
            await ensurePersonalWorkspace(db, created.id);
          },
        },
      },
    },
    plugins: [
      bearer(),
      organization({
        // Team creation (and its `workspaces` row) arrives with Teams in M7.1 [assumption].
        allowUserToCreateOrganization: false,
        creatorRole: "owner",
        roles: { owner: ownerAc, member: memberAc },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** Resolves the signed-in user from the session cookie or `Authorization: Bearer`. */
export function sessionResolver(auth: Auth): ResolveUser {
  return async (req) => {
    const result = await auth.api.getSession({ headers: req.headers });
    return result ? { id: result.user.id } : null;
  };
}
