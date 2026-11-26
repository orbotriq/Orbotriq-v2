import "server-only";
import { randomBytes } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { requireAdminWrite } from "@/lib/admin/write-guard";
import { validLeadId } from "@/lib/admin/lead-view";
import { testEmail } from "@/lib/admin/lead-validation";
import { eligibleConversionStatus, validateConversion } from "@/lib/admin/lead-conversion-view";
const fail = (error: string, status = 400) => ({ok:false as const,error,status});
const review = () => fail("Conversion outcome requires administrator review. Do not retry or delete records.",409);
export async function convertLead(id: string, input: unknown) {
  const actor = await requireAdminWrite();
  const data = validateConversion(input);
  if (!validLeadId(id) || !data.ok) return fail("Invalid lead conversion request.");
  const db = adminDb(), auth = adminAuth();
  if (auth.app.options.projectId !== "demo-orbotriq-v2" || process.env.FIREBASE_PROJECT_ID !== "demo-orbotriq-v2") throw new Error("Unsafe provisioning project.");
  const ref = db.collection("leads").doc(id), org = db.collection("orgs").doc(), uid = `owner-${org.id}`;
  const audits = db.collection("platform").doc("leadManagement").collection("auditLogs");
  const initial = await ref.get();
  if (!initial.exists || !initial.updateTime) return fail("Lead not found.",404);
  const email = initial.get("email");
  if (typeof email !== "string" || !testEmail(email)) return fail("Only fictional .test leads can be converted.",403);
  const ownerEmail = email.toLowerCase();
  if (initial.get("conversion") !== undefined) return fail("Lead already converted or conversion requires review.",409);
  if (!eligibleConversionStatus(initial.get("status"))) return fail("Qualify the lead before converting.",409);
  if (`${initial.updateTime.seconds}:${initial.updateTime.nanoseconds}` !== data.version) return fail("Lead changed. Reload before converting.",409);
  try { await auth.getUserByEmail(ownerEmail); return fail("An account already exists with this email.",409); }
  catch (error) { if ((error as {code?:string}).code !== "auth/user-not-found") throw error; }
  // Reserve once. Never automatically retry a partially completed cross-service operation.
  const reservation = {state:"reserved",orgId:org.id,ownerUid:uid};
  const previousStatus = initial.get("status") as string;
  const common = {leadId:id,orgId:org.id,by:actor.uid,at:FieldValue.serverTimestamp()};
  try {
    const reserved = await db.runTransaction(async tx => {
      const doc = await tx.get(ref);
      if (!doc.exists || !doc.updateTime || !doc.updateTime.isEqual(initial.updateTime!) || doc.get("conversion") !== undefined) return false;
      tx.update(ref,{conversion:reservation,updatedAt:FieldValue.serverTimestamp(),updatedBy:actor.uid});
      tx.create(audits.doc(),{...common,action:"lead.conversion_reserved"});
      return true;
    });
    if (!reserved) return fail("Lead changed or conversion already started. Reload.",409);
    await auth.createUser({uid,email:ownerEmail,password:`Ob${randomBytes(24).toString("base64url")}#7`,displayName:data.name,emailVerified:false,disabled:true});
    await auth.setCustomUserClaims(uid,{orgId:org.id,role:"owner"});
    const provisioned = {...reservation,state:"provisioned"};
    await db.runTransaction(async tx => {
      const doc = await tx.get(ref);
      if (doc.get("conversion.state") !== "reserved" || doc.get("conversion.orgId") !== org.id || doc.get("email") !== email || doc.get("status") !== previousStatus) throw new Error("Reservation changed");
      tx.create(org,{name:data.name,ownerUid:uid,ownerEmail,plan:"trial",status:"trialing",isDemo:false,trialEndsAt:Timestamp.fromMillis(Date.now()+data.trialDays*86400000),paidUntil:null,limits:{institutions:2,geoRuns:5},usage:{},institutionCount:0,notes:"",logoUrl:"",brandColor:"#22d3ee",createdBy:actor.uid,createdAt:FieldValue.serverTimestamp(),sourceLeadId:id});
      tx.create(org.collection("members").doc(uid),{email:ownerEmail,role:"owner",mustChangePassword:true,createdAt:FieldValue.serverTimestamp()});
      tx.create(db.collection("users").doc(uid),{email:ownerEmail,displayName:data.name,orgId:org.id,createdAt:FieldValue.serverTimestamp()});
      tx.create(org.collection("auditLogs").doc(),{action:"org.created_by_admin",by:actor.uid,at:FieldValue.serverTimestamp(),sourceLeadId:id});
      tx.update(ref,{conversion:provisioned,updatedAt:FieldValue.serverTimestamp(),updatedBy:actor.uid});
      tx.create(audits.doc(),{...common,action:"lead.conversion_provisioned"});
    });
    await auth.updateUser(uid,{disabled:false});
    await db.runTransaction(async tx => {
      const doc = await tx.get(ref);
      if (doc.get("conversion.state") !== "provisioned" || doc.get("conversion.orgId") !== org.id || doc.get("status") !== previousStatus || doc.get("email") !== email) throw new Error("Provisioning link changed");
      tx.update(ref,{conversion:{...reservation,state:"complete"},status:"won",followUpAt:null,updatedAt:FieldValue.serverTimestamp(),updatedBy:actor.uid});
      tx.create(audits.doc(),{...common,action:"lead.converted",previousStatus,nextStatus:"won"});
    });
    return {ok:true as const,orgId:org.id};
  } catch (error) {
    // A timeout may occur after a commit. Retain the reservation and all records for review.
    console.error("Lead conversion reconciliation required",id,org.id,(error as {code?:string}).code);
    return review();
  }
}
