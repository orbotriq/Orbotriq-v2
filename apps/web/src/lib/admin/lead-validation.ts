import { LEAD_STATUSES, type LeadStatus } from "@/lib/admin/lead-view";
export type LeadFields = { name: string; company: string; email: string; phone: string; message: string; source: string; serviceInterest: string; status: Exclude<LeadStatus, "unknown"> };
export const EDITABLE_STATUSES = LEAD_STATUSES.filter((s): s is LeadFields["status"] => s !== "unknown");
export const LEAD_LIMITS = { name: 120, company: 160, email: 160, phone: 40, message: 2000, source: 120, serviceInterest: 160 } as const;
export function testEmail(value: unknown): boolean {
  return typeof value === "string" && value.length <= 160 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.test$/i.test(value) && !value.includes("..");
}
export function validateLead(input: unknown, edit: boolean): { ok: true; fields: LeadFields; version: string } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("Invalid lead data.");
  const raw = input as Record<string, unknown>;
  const allowed = [...Object.keys(LEAD_LIMITS), "status", ...(edit ? ["version"] : [])];
  if (Object.keys(raw).some(k => !allowed.includes(k))) return fail("Unexpected lead field.");
  const strings = {} as Record<keyof typeof LEAD_LIMITS, string>;
  for (const key of Object.keys(LEAD_LIMITS) as (keyof typeof LEAD_LIMITS)[]) {
    const value = raw[key];
    if (typeof value !== "string" || value.length > LEAD_LIMITS[key] || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) return fail(`Invalid ${key}.`);
    strings[key] = value.trim();
  }
  if (!strings.name || !testEmail(strings.email)) return fail("A name and fictional .test email are required.");
  strings.email = strings.email.toLowerCase();
  if (strings.phone && !/^\+?[0-9][0-9 ()-]{5,38}$/.test(strings.phone)) return fail("Invalid phone format.");
  if (strings.phone) { const n = strings.phone.replace(/\D/g, "").length; if (n < 7 || n > 15) return fail("Phone must contain 7 to 15 digits."); }
  const status = EDITABLE_STATUSES.find(s => s === raw.status);
  if (!status || (!edit && status !== "new")) return fail("Invalid lead status.");
  if (edit && (typeof raw.version !== "string" || !/^\d{1,15}:\d{1,9}$/.test(raw.version))) return fail("Invalid version. Reload the lead.");
  return { ok: true, fields: { ...strings, status }, version: edit ? raw.version as string : "" };
}
