export function eligibleConversionStatus(value: unknown): boolean {
  return value === "qualified" || value === "proposal sent" || value === "demo given";
}
export function validateConversion(input: unknown): {ok: true; name: string; trialDays: number; version: string} | {ok: false; error: string} {
  const fail = {ok: false as const, error: "Enter an organization name (2–80 characters), trial duration (1–90 days) and current version."};
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail;
  const v = input as Record<string, unknown>;
  if (Object.keys(v).length !== 3 || Object.keys(v).some(k => !["name","trialDays","version"].includes(k))) return fail;
  if (typeof v.name !== "string" || v.name.trim().length < 2 || v.name.length > 80 || /[\x00-\x1f\x7f]/.test(v.name)) return fail;
  if (typeof v.trialDays !== "number" || !Number.isInteger(v.trialDays) || v.trialDays < 1 || v.trialDays > 90) return fail;
  if (typeof v.version !== "string" || !/^\d{1,15}:\d{1,9}$/.test(v.version)) return fail;
  return {ok: true, name: v.name.trim(), trialDays: v.trialDays, version: v.version};
}
export function conversionView(value: unknown): {state: "none"|"pending"|"complete"|"review"; orgId: string|null} {
  if (value === undefined) return {state:"none",orgId:null};
  if (!value || typeof value !== "object" || Array.isArray(value)) return {state:"review",orgId:null};
  const v = value as Record<string,unknown>;
  const id = typeof v.orgId === "string" && /^[a-zA-Z0-9]{20}$/.test(v.orgId) ? v.orgId : null;
  if (id && v.state === "complete") return {state:"complete",orgId:id};
  if (id && (v.state === "reserved" || v.state === "provisioned")) return {state:"pending",orgId:id};
  return {state:"review",orgId:id};
}
