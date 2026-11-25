import { z } from "zod";

const booleanFlag = z
  .enum(["true", "false", "1", "0", ""])
  .default("false")
  .transform((v) => v === "true" || v === "1");

function optionalFlag(v: string): boolean | undefined {
  return v === "" ? undefined : v === "true" || v === "1";
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().default("postgres://flolist:flolist@localhost:5433/flolist"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** Requests per client per window on /api/*. */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  /** Trust X-Forwarded-For (set to true behind Caddy). */
  TRUST_PROXY: booleanFlag,
  // Email (D-012, D-032): Mailpit in dev, Hostinger SMTP in prod.
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(1026),
  /** Implicit TLS. Empty = on for port 465 only (465 is TLS-only; 587/1025 use STARTTLS or plain). */
  SMTP_SECURE: z.enum(["true", "false", "1", "0", ""]).default("").transform(optionalFlag),
  /** Leave both empty for an SMTP server without auth (Mailpit). */
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  MAIL_FROM: z.string().min(1).default("Flolist <no-reply@flolist.localhost>"),
});

export type Env = z.infer<typeof envSchema>;

/** Validates process env at startup and fails fast with a readable message. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
