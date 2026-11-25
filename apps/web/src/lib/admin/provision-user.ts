import "server-only";
import { randomUUID, randomBytes } from "node:crypto";
import { z } from "zod";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { requireAdminWrite } from "@/lib/admin/write-guard";
import { failure } from "@/lib/admin/plan-validation";
const schema=z.object({orgId:z.string().min(1).max(128).refine(s=>!s.includes("/")&&s!=="."&&s!==".."),name:z.string().trim().min(2).max(80),email:z.string().trim().toLowerCase().email().max(254).refine(s=>s.endsWith(".test")),role:z.enum(["admin","staff","viewer"]),reason:z.string().trim().min(3).max(300)}).strict();
export async function provisionUser(input:unknown){
 const actor=await requireAdminWrite(); const parsed=schema.safeParse(input);
 if(!parsed.success)return failure("Invalid test account request.");
 const {orgId,name,email,role,reason}=parsed.data;
 const auth=adminAuth(),db=adminDb(),uid=randomUUID();
 const org=db.collection("orgs").doc(orgId),profile=db.collection("users").doc(uid),member=org.collection("members").doc(uid);
 const audit=db.collection("platform").doc("userManagement").collection("auditLogs").doc();
 const lock=db.collection("platform").doc("userManagement").collection("locks").doc(uid);
 let created=false,attempted=false;
 try {
  await auth.createUser({uid,email,displayName:name,emailVerified:true,disabled:true,password:randomBytes(32).toString("hex")});created=true;
  await auth.setCustomUserClaims(uid,{orgId,role});
  const accepted=await db.runTransaction(async tx=>{
   const o=await tx.get(org);const d=o.data();
   if(!d||typeof d.ownerUid!=="string"||!["active","trialing","demo"].includes(d.status))return false;
   const expiry=d.status==="active"?d.paidUntil:d.trialEndsAt;
   if(!(expiry instanceof Timestamp)||expiry.toMillis()<=Date.now())return false;
   tx.create(profile,{email,displayName:name,orgId,createdAt:FieldValue.serverTimestamp()});
   tx.create(member,{email,role,mustChangePassword:true,createdAt:FieldValue.serverTimestamp()});
   tx.create(lock,{by:actor.uid,at:FieldValue.serverTimestamp(),operation:"provision"});
   tx.create(audit,{action:"user.provision_requested",uid,orgId,by:actor.uid,reason,nextRole:role,at:FieldValue.serverTimestamp()});
   attempted=true;return true;
  });
  if(!accepted){await auth.deleteUser(uid);return failure("Organization is not eligible.",409);}
  await auth.updateUser(uid,{disabled:false});
  const batch=db.batch();batch.update(audit,{action:"user.provisioned",completedAt:FieldValue.serverTimestamp()});batch.delete(lock);await batch.commit();
  return {ok:true as const,uid};
 }catch(e){
  if(created&&!attempted){try{await auth.deleteUser(uid);}catch{console.error("Provision cleanup required",uid);return failure("Administrator review required.",500);}}
  if(attempted){console.error("Provision reconciliation required",uid);return failure("Provisioning may be incomplete; administrator review required.",500);}
  if((e as {code?:string}).code==="auth/email-already-exists")return failure("Email already exists.",409);
  return failure("Provisioning failed.",500);
 }
}
