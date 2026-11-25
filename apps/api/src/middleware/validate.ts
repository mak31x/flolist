import type { ValidationIssue } from "@flolist/shared";
import type { ValidationTargets } from "hono";
import { validator } from "hono/validator";
import type { z } from "zod";
import { ApiException } from "../lib/errors.ts";

type Target = keyof Pick<ValidationTargets, "json" | "query" | "param" | "header">;

/**
 * zod-backed request validation. On failure it throws a VALIDATION error whose
 * `details` lists every issue as `{ source, path, message }`. Handlers read the
 * parsed value with `c.req.valid(target)`.
 */
export function validate<T extends Target, S extends z.ZodType>(target: T, schema: S) {
  return validator(target, async (value): Promise<z.output<S>> => {
    const result = await schema.safeParseAsync(value);
    if (result.success) return result.data;
    const details: ValidationIssue[] = result.error.issues.map((issue) => ({
      source: target,
      path: issue.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
      message: issue.message,
    }));
    throw new ApiException("VALIDATION", "The request is invalid", { details });
  });
}
