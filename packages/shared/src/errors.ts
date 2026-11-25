import { z } from "zod";

/**
 * Error codes from docs/architecture.md → API conventions, plus `RATE_LIMITED` (429)
 * and `INTERNAL` (500), added in M0.2 (D-021), and `UNAVAILABLE` (503) for a dependency
 * that isn't configured or reachable, such as object storage (D-037).
 */
export const errorCodes = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION",
  "CONFLICT",
  "LIMIT",
  "RATE_LIMITED",
  "INTERNAL",
  "UNAVAILABLE",
] as const;

export const errorCodeSchema = z.enum(errorCodes);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** HTTP status for each error code. */
export const errorStatus = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  LIMIT: 403,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  UNAVAILABLE: 503,
} as const satisfies Record<ErrorCode, number>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
    /** Echo of the `X-Request-Id` header, so a user-reported error can be found in the logs. */
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** One entry in `details` for VALIDATION errors. */
export const validationIssueSchema = z.object({
  /** "json" | "query" | "param" | "header" */
  source: z.string(),
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof validationIssueSchema>;
