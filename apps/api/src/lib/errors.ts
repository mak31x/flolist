import { errorStatus, type ApiError, type ErrorCode } from "@flolist/shared";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../types.ts";

/** Throw from any handler or middleware; `onError` turns it into the standard error body. */
export class ApiException extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;
  readonly headers: Record<string, string>;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: unknown; headers?: Record<string, string>; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ApiException";
    this.code = code;
    this.details = options.details;
    this.headers = options.headers ?? {};
  }

  get status(): ContentfulStatusCode {
    return errorStatus[this.code];
  }
}

export const unauthenticated = () => new ApiException("UNAUTHENTICATED", "Sign in to continue");
export const forbidden = (message = "You don't have access to this") =>
  new ApiException("FORBIDDEN", message);
export const notFound = (what = "Resource") => new ApiException("NOT_FOUND", `${what} not found`);

export function errorResponse(
  c: Context<AppEnv>,
  code: ErrorCode,
  message: string,
  details?: unknown,
): Response {
  const body: ApiError = { error: { code, message } };
  if (details !== undefined) body.error.details = details;
  const requestId = c.get("requestId") as string | undefined;
  if (requestId) body.error.requestId = requestId;
  return c.json(body, errorStatus[code]);
}
