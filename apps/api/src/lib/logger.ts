import { pino, type Logger, type LoggerOptions } from "pino";

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

/**
 * JSON logs to stdout (Docker collects them in prod). In development they're
 * pretty-printed via pino-pretty. Secrets in headers are redacted.
 */
export function createLogger(options: { level: LogLevel; pretty: boolean }): Logger {
  const config: LoggerOptions = {
    level: options.level,
    base: { service: "api" },
    redact: {
      paths: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
      censor: "[redacted]",
    },
  };
  if (options.pretty) {
    config.transport = {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "HH:MM:ss.l", ignore: "pid,hostname,service" },
    };
  }
  return pino(config);
}

export const silentLogger: Logger = pino({ level: "silent" });
