import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { requireAdminWrite } from "@/lib/admin/write-guard";
import { requirePlatformAdmin } from "@/lib/auth/guard";
import { validLeadId } from "@/lib/admin/lead-view";
import { testEmail } from "@/lib/admin/lead-validation";
import { validateActivity } from "@/lib/admin/lead-followup";
const fail = (error: string, status = 400) => ({ok: false as const, error, status});
const timestamp = (v: unknown) => v instanceof Timestamp ? v.toMillis() : null;
const str = (v: unknown, max: number) => typeof v === "string" ? v.slice(0,max) : "";
export async function getLeadActivity(id: string) {
  await requirePlatformAdmin();
  if (!validLeadId(id)) return {events: [], limited: false};
  // Query only this lead; no new composite index needed. If capped, explicitly disclose the subset.
  const snapshot = await adminDb().collection("platform").doc("leadManagement").collection("auditLogs").where("leadId", "==", id).select("action", "by", "at", "fields", "previousStatus", "nextStatus", "kind", "note", "previousFollowUp", "nextFollowUp").limit(201).get();
  const events = snapshot.docs.slice(0,200).map(d => {
    const v = d.data();
    return {id: d.id, action: str(v.action,80), by: str(v.by,128), at: timestamp(v.at),
      fields: Array.isArray(v.fields) ? v.fields.filter((f: unknown): f is string => typeof f === "string").slice(0,20).map(f => f.slice(0,80)) : [],
      previousStatus: str(v.previousStatus,80), nextStatus: str(v.nextStatus,80), kind: str(v.kind,40), note: str(v.note,2000), previousFollowUp: timestamp(v.previousFollowUp), nextFollowUp: timestamp(v.nextFollowUp)};
  }).sort((a,b) => (b.at ?? 0) - (a.at ?? 0) || b.id.localeCompare(a.id));
  return {events: events.slice(0,100), limited: snapshot.size > 100};
}
export async function saveLeadActivity(id: string, input: unknown) {
  const actor = await requireAdminWrite();
  if (!validLeadId(id)) return fail("Invalid lead ID.");
  const parsed = validateActivity(input);
  if (!parsed.ok) return fail(parsed.error);
  const data = parsed.data, db = adminDb(), ref = db.collection("leads").doc(id);
  const audit = db.collection("platform").doc("leadManagement").collection("auditLogs").doc();
  return db.runTransaction(async tx => {
    const doc = await tx.get(ref);
    if (!doc.exists || !doc.updateTime) return fail("Lead not found.",404);
    if (!testEmail(doc.get("email"))) return fail("Only fictional .test leads can be edited.",403);
    if (`${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}` !== data.version) return fail("Lead changed. Reload before editing.",409);
    if (doc.get("conversion") !== undefined && doc.get("conversion.state") !== "complete") return fail("Conversion requires review before recording activity.",409);
    const common = {leadId: id, by: actor.uid, at: FieldValue.serverTimestamp()};
    const updated = {updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid};
    if (data.action === "schedule") {
      const old = doc.get("followUpAt");
      if (old !== undefined && old !== null && !(old instanceof Timestamp)) return fail("Existing follow-up requires review.",409);
      const previous = timestamp(old);
      if (previous === data.ms) return {ok: true as const, changed: false};
      const next = data.ms === null ? null : Timestamp.fromMillis(data.ms);
      tx.update(ref, {...updated, followUpAt: next});
      tx.create(audit, {...common, action: "lead.followup_changed", previousFollowUp: old ?? null, nextFollowUp: next});
    } else {
      tx.update(ref, {...updated, lastActivityAt: FieldValue.serverTimestamp()});
      tx.create(audit, {...common, action: "lead.activity_recorded", kind: data.kind, note: data.note});
    }
    return {ok: true as const, changed: true};
  });
}
