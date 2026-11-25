import "server-only";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { requirePlatformAdmin } from "@/lib/auth/guard";
import { requireAdminWrite } from "@/lib/admin/write-guard";
import { failure } from "@/lib/admin/plan-validation";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import type { UserRecord } from "firebase-admin/auth";
const valid = (s: string) => !!s && s.length <= 128 && !s.includes("/") && s !== "." && s !== "..";
function view(u: UserRecord) {
 return { uid:u.uid, email:u.email ?? "-", name:u.displayName ?? "-", disabled:u.disabled, verified:u.emailVerified, platformAdmin:u.customClaims?.platformAdmin === true, orgId:typeof u.customClaims?.orgId === "string" ? u.customClaims.orgId : "", role:typeof u.customClaims?.role === "string" ? u.customClaims.role : "unknown" };
}
export async function listUsers(cursor?: string) {
 await requirePlatformAdmin();
 const result = await adminAuth().listUsers(100,cursor || undefined);
 return { users:result.users.map(view), next:result.pageToken };
}
export async function getUserDetails(uid:string) {
 await requirePlatformAdmin();
 if (!valid(uid)) return null;
 let account:UserRecord;
 try { account=await adminAuth().getUser(uid); } catch(e) { if ((e as {code?:string}).code === "auth/user-not-found") return null; throw e; }
 const user=view(account);
 const profile=await adminDb().collection("users").doc(uid).get();
 const member=valid(user.orgId) ? await adminDb().collection("orgs").doc(user.orgId).collection("members").doc(uid).get() : null;
 return {...user, matched:profile.data()?.orgId===user.orgId && member?.data()?.role===user.role && member?.exists===true};
}
const schema=z.object({disabled:z.boolean(),expectedDisabled:z.boolean(),reason:z.string().trim().min(3).max(300)}).strict();
export async function updateUserStatus(uid:string,input:unknown) {
 const actor=await requireAdminWrite();
 const parsed=schema.safeParse(input);
 if (!valid(uid)||!parsed.success) return failure("Invalid request.");
 const auth=adminAuth(),db=adminDb();
 const {disabled,expectedDisabled,reason}=parsed.data;
 // A persistent lock prevents concurrent operations through this endpoint.
 const lock=db.collection("platform").doc("userManagement").collection("locks").doc(uid);
 const audit=db.collection("platform").doc("userManagement").collection("auditLogs").doc();
 const acquired=await db.runTransaction(async tx=>{if ((await tx.get(lock)).exists) return false; tx.create(lock,{by:actor.uid,at:FieldValue.serverTimestamp()});return true;});
 if (!acquired) return failure("Account operation in progress or requires reconciliation.",409);
 let attempted=false;
 try {
  const u=await auth.getUser(uid); const v=view(u);
  if(uid===actor.uid || u.customClaims?.platformAdmin !== undefined || v.role==="owner" || !["admin","staff","viewer"].includes(v.role) || !valid(v.orgId) || !u.email?.endsWith(".test")) return failure("Protected or unsupported account.",403);
  const org=db.collection("orgs").doc(v.orgId);
  const [o,m,p]=await Promise.all([org.get(),org.collection("members").doc(uid).get(),db.collection("users").doc(uid).get()]);
  if(!o.exists || o.data()?.ownerUid===uid || m.data()?.role!==v.role || p.data()?.orgId!==v.orgId) return failure("Membership mismatch.",409);
  if(v.disabled!==expectedDisabled) return failure("Account changed; reload.",409);
  if(v.disabled===disabled) return {ok:true as const,changed:false};
  if(!disabled && !["active","trialing","demo"].includes(o.data()?.status)) return failure("Organization is not eligible.",409);
  await audit.create({action:"user.status_requested",uid,orgId:v.orgId,by:actor.uid,reason,disabled,at:FieldValue.serverTimestamp()});
  attempted=true;
  await auth.updateUser(uid,{disabled});
  if(disabled) await auth.revokeRefreshTokens(uid);
  const batch=db.batch(); batch.update(audit,{action:"user.status_changed",completedAt:FieldValue.serverTimestamp()}); batch.delete(lock); await batch.commit();
  return {ok:true as const,changed:true};
 } catch { return failure("Account operation failed; administrator review required.",500); }
 finally { if(!attempted) await lock.delete(); }
}

const roleSchema=z.object({role:z.enum(["admin","staff","viewer"]),expectedRole:z.enum(["admin","staff","viewer"]),reason:z.string().trim().min(3).max(300)}).strict();
export async function updateUserRole(uid:string,input:unknown) {
 const actor=await requireAdminWrite();
 const parsed=roleSchema.safeParse(input);
 if(!valid(uid)||!parsed.success) return failure("Invalid role request.");
 const {role,expectedRole,reason}=parsed.data;
 const auth=adminAuth(),db=adminDb();
 const root=db.collection("platform").doc("userManagement");
 const lock=root.collection("locks").doc(uid),audit=root.collection("auditLogs").doc();
 const acquired=await db.runTransaction(async tx=>{if((await tx.get(lock)).exists)return false;tx.create(lock,{by:actor.uid,at:FieldValue.serverTimestamp()});return true;});
 if(!acquired)return failure("Account operation in progress or requires reconciliation.",409);
 let attempted=false;
 try {
  const u=await auth.getUser(uid),v=view(u);
  if(uid===actor.uid||u.customClaims?.platformAdmin!==undefined||!u.email?.endsWith(".test")||!valid(v.orgId)||!["admin","staff","viewer"].includes(v.role))return failure("Protected or unsupported account.",403);
  if(v.disabled||!v.verified)return failure("Account must be enabled and verified.",409);
  if(v.role!==expectedRole)return failure("Role changed; reload.",409);
  const org=db.collection("orgs").doc(v.orgId),member=org.collection("members").doc(uid),profile=db.collection("users").doc(uid);
  const check=await db.runTransaction(async tx=>{
   const [o,m,p]=await Promise.all([tx.get(org),tx.get(member),tx.get(profile)]);
   if(!o.exists||typeof o.data()?.ownerUid!=="string"||o.data()?.ownerUid===uid||!m.exists||m.data()?.role!==expectedRole||m.data()?.email!==u.email||p.data()?.orgId!==v.orgId||p.data()?.email!==u.email)return false;
   if(!["active","trialing","demo"].includes(o.data()?.status))return false;
   if(role!==expectedRole)tx.create(audit,{action:"user.role_requested",uid,orgId:v.orgId,by:actor.uid,reason,previousRole:expectedRole,nextRole:role,at:FieldValue.serverTimestamp()});
   return true;
  });
  if(!check)return failure("Membership mismatch or ineligible organization.",409);
  if(role===expectedRole)return {ok:true as const,changed:false};
  attempted=true;
  await auth.setCustomUserClaims(uid,{...u.customClaims,role});
  await auth.revokeRefreshTokens(uid);
  await db.runTransaction(async tx=>{
   const [o,m,p]=await Promise.all([tx.get(org),tx.get(member),tx.get(profile)]);
   if(!o.exists||o.data()?.ownerUid===uid||m.data()?.role!==expectedRole||p.data()?.orgId!==v.orgId)throw new Error("Membership changed");
   tx.update(member,{role});
   tx.update(audit,{action:"user.role_changed",completedAt:FieldValue.serverTimestamp()});
   tx.delete(lock);
  });
  return {ok:true as const,changed:true};
 } catch {return failure("Role operation failed; administrator review required.",500);}
 finally {if(!attempted)await lock.delete();}
}
