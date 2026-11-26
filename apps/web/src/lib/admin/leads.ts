import "server-only";
import { FieldPath, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { requirePlatformAdmin } from "@/lib/auth/guard";
import { normalizeLead, validLeadId } from "@/lib/admin/lead-view";
import { conversionView } from "@/lib/admin/lead-conversion-view";
const PAGE_SIZE = 25;
const FIELDS = ["name", "company", "email", "phone", "message", "source", "status", "createdAt", "serviceInterest", "followUpAt"] as const;
function mapLead(doc: DocumentSnapshot) {
  const data = doc.data() ?? {};
  return { ...normalizeLead(doc.id, data, data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : null), followUpAt: data.followUpAt instanceof Timestamp ? data.followUpAt.toMillis() : null };
}
export async function listLeads(cursor?: string) {
  await requirePlatformAdmin();
  // Document-ID pagination includes legacy documents without a createdAt field.
  const collection = adminDb().collection("leads");
  let query = collection.orderBy(FieldPath.documentId()).select(...FIELDS);
  if (validLeadId(cursor)) query = query.startAfter(cursor);
  const snapshot = await query.limit(PAGE_SIZE + 1).get();
  const docs = snapshot.docs.slice(0, PAGE_SIZE);
  const rows = docs.map(mapLead).map(({message, ...row}) => { void message; return row; });
  return { rows, next: snapshot.size > PAGE_SIZE ? docs[docs.length - 1].id : null };
}
export async function getLead(id: string) {
  await requirePlatformAdmin();
  if (!validLeadId(id)) return null;
  const [doc] = await adminDb().getAll(adminDb().collection("leads").doc(id), { fieldMask: [...FIELDS, "conversion"] });
  return doc.exists && doc.updateTime ? { ...mapLead(doc), conversion: conversionView(doc.get("conversion")), serviceInterest: typeof doc.get("serviceInterest") === "string" ? String(doc.get("serviceInterest")).slice(0, 160) : "", version: `${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}` } : null;
}
