import { z } from "zod";

const booleanFlag = z
  .enum(["true", "false", "1", "0", ""])
  .default("false")
  .transform((v) => v === "true" || v === "1");

function optionalFlag(v: string): boolean | undefined {
  return v === "" ? undefined : v === "true" || v === "1";
}

/** Dev/test-only secret. Never valid in production (checked below). */
export const DEV_AUTH_SECRET = "flolist-dev-only-secret-change-me-0000";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_HOST: z.string().default("127.0.0.1"),
    API_PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().default("postgres://flolist:flolist@localhost:5433/flolist"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    /** Requests per client per window on /api/*. */
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    /** Trust X-Forwarded-For (set to true behind Caddy). */
    TRUST_PROXY: booleanFlag,
    /** Public origin of the app (web + /api behind one host, D-019/D-029). Better Auth's baseURL. */
    APP_URL: z.url().default("http://localhost:5174"),
    // Auth (D-005). The secret signs cookies and tokens; production refuses the dev default.
    BETTER_AUTH_SECRET: z.string().min(32).default(DEV_AUTH_SECRET),
    /** Google sign-in is enabled only when both are set. */
    GOOGLE_CLIENT_ID: z.string().default(""),
    GOOGLE_CLIENT_SECRET: z.string().default(""),
    /** Stricter limit for sign-in, sign-up, password reset and verification emails, per client IP. */
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    // Email (D-012, D-032): Mailpit in dev, Hostinger SMTP in prod.
    SMTP_HOST: z.string().default("localhost"),
    SMTP_PORT: z.coerce.number().int().positive().default(1026),
    /** Implicit TLS. Empty = on for port 465 only (465 is TLS-only; 587/1025 use STARTTLS or plain). */
    SMTP_SECURE: z.enum(["true", "false", "1", "0", ""]).default("").transform(optionalFlag),
    /** Leave both empty for an SMTP server without auth (Mailpit). */
    SMTP_USER: z.string().default(""),
    SMTP_PASS: z.string().default(""),
    MAIL_FROM: z.string().min(1).default("Flolist <no-reply@flolist.localhost>"),
    // Object storage (D-012, D-018, D-037). Uploads answer 503 until bucket + keys are set.
    S3_ENDPOINT: z.string().default(""),
    /** Host browsers use for presigned URLs, if it differs from S3_ENDPOINT (Docker networks). */
    S3_PUBLIC_ENDPOINT: z.string().default(""),
    S3_REGION: z.string().default("us-east-1"),
    S3_BUCKET: z.string().default(""),
    S3_ACCESS_KEY: z.string().default(""),
    S3_SECRET_KEY: z.string().default(""),
    /**
     * true = browsers PUT straight to presigned URLs (the bucket needs CORS for APP_URL).
     * false = the API relays upload bytes; works with any S3 server (D-037).
     */
    S3_DIRECT_UPLOAD: booleanFlag,
    /** Per-file limit (D-013). */
    MAX_UPLOAD_MB: z.coerce.number().positive().default(25),
    /** Empty = unlimited (D-013). */
    MAX_WORKSPACE_STORAGE_GB: z
      .string()
      .default("")
      .transform((v) => (v.trim() === "" ? undefined : Number(v)))
      .pipe(z.number().positive().optional()),
    /** Upload reservations per user per window. */
    UPLOAD_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
    UPLOAD_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.BETTER_AUTH_SECRET === DEV_AUTH_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["BETTER_AUTH_SECRET"],
        message: "Set a real secret in production (openssl rand -base64 32)",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** The S3 settings, or null when storage isn't configured (uploads then answer 503). */
export function s3ConfigFrom(env: Env) {
  if (!env.S3_ENDPOINT || !env.S3_BUCKET || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) return null;
  return {
    endpoint: env.S3_ENDPOINT,
    ...(env.S3_PUBLIC_ENDPOINT ? { publicEndpoint: env.S3_PUBLIC_ENDPOINT } : {}),
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  };
}

/** Validates process env at startup and fails fast with a readable message. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
