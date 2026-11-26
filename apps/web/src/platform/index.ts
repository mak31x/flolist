/**
 * Platform adapters (D-003). Everything here works in a browser, Tauri's webview and
 * Capacitor's webview today; native shells may swap an implementation (e.g. the photo
 * picker on iOS/Android) without touching feature code.
 */
import { weekdayFromIso, type Weekday } from "@flolist/shared";

/** Opens the system file picker and resolves with the chosen file, or null if cancelled. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    const done = (file: File | null) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => {
      done(input.files?.[0] ?? null);
    });
    input.addEventListener("cancel", () => {
      done(null);
    });
    document.body.append(input);
    input.click();
  });
}

/**
 * V8 and WebKit report CLDR's legacy names for zones IANA has since renamed
 * (Asia/Calcutta, Europe/Kiev…). Both forms are valid; Flolist stores and shows the current one.
 */
const renamedZones: Record<string, string> = {
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Mendoza": "America/Argentina/Mendoza",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Godthab": "America/Nuuk",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
  "Etc/UTC": "UTC",
  "Etc/GMT": "UTC",
};

/** The current IANA name for a zone the runtime may report under an old name. */
export function modernZone(zone: string): string {
  return renamedZones[zone] ?? zone;
}

/** The device's IANA time zone ("UTC" if the runtime can't tell). */
export function systemTimeZone(): string {
  try {
    return modernZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  } catch {
    return "UTC";
  }
}

/** Every IANA zone the runtime knows (current names), falling back to the device's one. */
export function timeZones(): string[] {
  const zones =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const all = new Set(["UTC", ...zones.map(modernZone), systemTimeZone()]);
  return [...all].sort((a, b) => (a === "UTC" ? -1 : b === "UTC" ? 1 : a.localeCompare(b)));
}

/** The user's preferred locale tag (e.g. "en-GB"). */
export function systemLocale(): string {
  return typeof navigator === "undefined" ? "en-US" : navigator.language || "en-US";
}

type WeekInfoLocale = Intl.Locale & {
  getWeekInfo?: () => { firstDay: number };
  weekInfo?: { firstDay: number };
};

/**
 * The locale's first day of the week. `Intl.Locale#getWeekInfo` is missing in some
 * engines (older WebKit used a `weekInfo` getter, Firefox has neither): Monday then.
 */
export function systemFirstDay(locale = systemLocale()): Weekday {
  try {
    const loc = new Intl.Locale(locale) as WeekInfoLocale;
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    if (info) return weekdayFromIso(info.firstDay);
  } catch {
    // fall through
  }
  return 1;
}

/**
 * The live-sync socket URL. The web app talks to its own origin (Caddy routes /ws to the API);
 * native shells point at the configured server in M10/M11.
 */
export function socketUrl(): string {
  const { protocol, host } = window.location;
  return `${protocol === "https:" ? "wss" : "ws"}://${host}/ws`;
}

/** Opens a WebSocket (Tauri and Capacitor webviews provide the browser API). */
export const openSocket = (url: string): WebSocket => new WebSocket(url);
