/** "GMT+5:30" for a zone right now ("GMT" for UTC). */
export function zoneOffset(zone: string, at = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(at);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** "America/Argentina/Buenos_Aires" → "Buenos Aires (America/Argentina)". */
export function zoneLabel(zone: string): string {
  const i = zone.lastIndexOf("/");
  if (i === -1) return zone;
  return `${zone.slice(i + 1).replaceAll("_", " ")} (${zone.slice(0, i).replaceAll("_", " ")})`;
}
