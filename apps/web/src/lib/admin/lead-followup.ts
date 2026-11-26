export const ACTIVITY_TYPES = ["note", "call", "email", "meeting"] as const;
export type ActivityType = typeof ACTIVITY_TYPES[number];
const IST_OFFSET = 330 * 60_000;
export function parseFollowUp(value: unknown): number | null {
  if (typeof value !== "string" || !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const ms = Date.parse(value + ":00Z");
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0,16) !== value) return null;
  return ms - IST_OFFSET;
}
export function followUpInput(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || Math.abs(ms) > 8e15) return "";
  const value = new Date(ms + IST_OFFSET).toISOString().slice(0,16);
  return parseFollowUp(value) === null ? "" : value;
}
export function followUpStatus(ms: number | null, now: number): "None" | "Overdue" | "Today" | "Upcoming" {
  if (ms === null || !Number.isFinite(ms)) return "None";
  const day = (n: number) => Math.floor((n + IST_OFFSET) / 86400000);
  return day(ms) < day(now) ? "Overdue" : day(ms) === day(now) ? "Today" : "Upcoming";
}
export type ActivityInput = { action: "schedule"; version: string; ms: number | null } | { action: "record"; version: string; kind: ActivityType; note: string };
export function validateActivity(input: unknown): {ok: true; data: ActivityInput} | {ok: false; error: string} {
  const fail = (error: string) => ({ok: false as const, error});
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("Invalid activity data.");
  const raw = input as Record<string, unknown>;
  if (typeof raw.version !== "string" || !/^\d{1,15}:\d{1,9}$/.test(raw.version)) return fail("Invalid version. Reload the lead.");
  if (raw.action === "schedule") {
    if (Object.keys(raw).some(k => !["action", "version", "followUp"].includes(k))) return fail("Unexpected activity field.");
    const ms = raw.followUp === null ? null : parseFollowUp(raw.followUp);
    if (raw.followUp !== null && ms === null) return fail("Enter a valid follow-up date and time (IST, 2000–2099).");
    return {ok: true, data: {action: "schedule", version: raw.version, ms}};
  }
  if (raw.action === "record") {
    if (Object.keys(raw).some(k => !["action", "version", "kind", "note"].includes(k))) return fail("Unexpected activity field.");
    const kind = ACTIVITY_TYPES.find(k => k === raw.kind);
    if (!kind || typeof raw.note !== "string" || raw.note.length > 2000 || !raw.note.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(raw.note)) return fail("Select an activity type and enter a note (1–2000 characters).");
    return {ok: true, data: {action: "record", version: raw.version, kind, note: raw.note.trim()}};
  }
  return fail("Unknown activity action.");
}
