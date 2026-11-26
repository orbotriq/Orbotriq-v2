import "server-only";
import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { requirePlatformAdmin } from "@/lib/auth/guard";
import { isAdminWriteEnabled } from "@/lib/admin/write-guard";
import { normalizeAudit, validAuditBoundary, type AuditRow } from "./global-audit-view";
const PAGE=25, SCAN=100;
function decode(cursor: string) {
  if (cursor.length>1800 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try { const v:unknown=JSON.parse(Buffer.from(cursor,"base64url").toString("utf8")); return validAuditBoundary(v)?v:null; } catch { return null; }
}
export async function listGlobalAudit(cursor?: string) {
  await requirePlatformAdmin();
  // New collection-group access is deliberately limited to the verified local environment.
  if (!isAdminWriteEnabled()) return {rows:[] as AuditRow[],next:null,notice:"Global audit is disabled outside the isolated emulator pending production index and access review."};
  const boundary=cursor?decode(cursor):null;
  if (cursor && !boundary) return {rows:[] as AuditRow[],next:null,notice:"Invalid page cursor. Return to the latest page."};
  const db=adminDb();
  let q=db.collectionGroup("auditLogs").orderBy("at","desc").orderBy(FieldPath.documentId(),"desc");
  if (boundary) q=q.startAfter(new Timestamp(boundary.seconds,boundary.nanos),db.doc(boundary.path));
  const snapshot=await q.select("action","by","at","orgId","uid","leadId","planId","number","previousPlan","nextPlan").limit(SCAN).get();
  const accepted: {row:AuditRow; boundary:{path:string;seconds:number;nanos:number}}[]=[];
  for (const doc of snapshot.docs) {
    const at=doc.get("at");
    if (!(at instanceof Timestamp)) continue;
    const row=normalizeAudit(doc.ref.path,doc.data(),at.toMillis());
    const b={path:doc.ref.path,seconds:at.seconds,nanos:at.nanoseconds};
    if (row && validAuditBoundary(b)) accepted.push({row,boundary:b});
  }
  const page=accepted.slice(0,PAGE);
  const more=accepted.length>PAGE || snapshot.size===SCAN;
  const next=more && page.length?Buffer.from(JSON.stringify(page[page.length-1].boundary)).toString("base64url"):null;
  return {rows:page.map(p=>p.row),next,notice:more&&!next?"This scan contained no supported events. Older history may exist; unsupported records are omitted.":""};
}
