import { apiErrorSchema, type ErrorCode } from "@flolist/shared";
import type { z } from "zod";

/** A non-2xx answer from the API, with its error code when the body had one. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ErrorCode | null;

  constructor(status: number, code: ErrorCode | null, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface ApiOptions {
  /** Let the request outlive the page (a flush on `pagehide`). Bodies must stay under 64 KB. */
  keepalive?: boolean;
}

/**
 * Calls `/api/v1{path}` on the app's own origin (D-019/D-029) with the session cookie and
 * parses the answer with `schema`. Throws `ApiRequestError` on any non-2xx.
 */
export async function api<S extends z.ZodType>(
  method: Method,
  path: string,
  schema: S,
  body?: unknown,
  options?: ApiOptions,
): Promise<z.output<S>>;
export async function api(
  method: Method,
  path: string,
  schema?: undefined,
  body?: unknown,
  options?: ApiOptions,
): Promise<void>;
export async function api(
  method: Method,
  path: string,
  schema?: z.ZodType,
  body?: unknown,
  options: ApiOptions = {},
): Promise<unknown> {
  const init: RequestInit = { method, credentials: "include" };
  if (options.keepalive) init.keepalive = true;
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`/api/v1${path}`, init);
  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(await res.json().catch(() => null));
    const err = parsed.success ? parsed.data.error : null;
    throw new ApiRequestError(
      res.status,
      err?.code ?? null,
      err?.message ?? `${method} ${path} failed: ${String(res.status)}`,
    );
  }
  if (!schema || res.status === 204) return undefined;
  return schema.parse(await res.json());
}
