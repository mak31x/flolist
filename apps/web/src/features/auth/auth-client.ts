import { createAuthClient } from "better-auth/client";

/**
 * Better Auth client (D-005). The SPA and the API share one origin (D-019/D-029), so it talks
 * to `/api/auth` on the current origin with the session cookie. Native shells (M10/M11) will
 * switch to bearer tokens through a `platform/` adapter.
 */
export const authClient = createAuthClient({
  basePath: "/api/auth",
  // Resolve fetch per call (not at import), so tests can stub it.
  fetchOptions: { customFetchImpl: (input, init) => globalThis.fetch(input, init) },
});

/** Where a verified user lands (roadmap M1.1: sign-up → verify → Inbox). */
export const AFTER_AUTH_PATH = "/inbox";

/**
 * Only same-app paths are allowed as post-login targets, so `?redirect=` can't send users
 * to another site (open redirect).
 */
export function safeRedirect(target: unknown): string {
  if (typeof target !== "string" || !target.startsWith("/") || target.startsWith("//")) {
    return AFTER_AUTH_PATH;
  }
  if (target.startsWith("/api/") || target === "/login" || target === "/signup") {
    return AFTER_AUTH_PATH;
  }
  return target;
}

/** Better Auth error → a sentence for the form. */
export function authErrorMessage(error: {
  code?: string | undefined;
  message?: string | undefined;
  status: number;
}): string {
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "That email and password don't match.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "An account with this email already exists. Log in instead.";
    case "PASSWORD_TOO_SHORT":
      return "Use at least 8 characters.";
    case "PASSWORD_TOO_LONG":
      return "Use at most 128 characters.";
    case "INVALID_TOKEN":
      return "This link has expired or was already used.";
    default:
      if (error.status === 429) return "Too many attempts. Wait a minute and try again.";
      return "Something went wrong. Try again.";
  }
}
