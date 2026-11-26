import "server-only";
import { redirect } from "next/navigation";
import type { DecodedIdToken } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import { adminAuth,adminDb } from "@/lib/firebase/admin";
import { isAdminWriteEnabled } from "@/lib/admin/write-guard";
import { isApprovedUser } from "./authorization";
import { verifySession } from "./session";
import { customerContext,customerRole,safeId,testEmail,type WorkspaceIdentity } from "./customer-policy";

export async function resolveWorkspaceIdentity(token:DecodedIdToken, purpose:"workspace"|"onboarding"="workspace"):Promise<WorkspaceIdentity|null>{
 try {
  if(token.firebase?.sign_in_provider==="anonymous"||!token.firebase?.sign_in_provider)return null;
  // Preserve the existing live platform-admin authorization. Never downgrade stale admin claims.
  if(token.platformAdmin!==undefined)return purpose==="workspace"&&await isApprovedUser(token)?{role:"platform"}:null;
  if(!isAdminWriteEnabled()||!safeId(token.uid)||!safeId(token.orgId)||!customerRole(token.role)||token.email_verified!==true||!testEmail(token.email))return null;
  const account=await adminAuth().getUser(token.uid);
  const db=adminDb(),org=db.doc(`orgs/${token.orgId}`);
  const [p,m,o,lock]=await db.getAll(db.doc(`users/${token.uid}`),org.collection("members").doc(token.uid),org,db.doc(`platform/userManagement/locks/${token.uid}`));
  const data=o.data(),expiry=data?.status==="active"?data.paidUntil:data?.trialEndsAt;
  return customerContext({token,account:{uid:account.uid,email:account.email,disabled:account.disabled,emailVerified:account.emailVerified,claims:account.customClaims??{}},profile:p.data(),member:m.data(),org:data,locked:lock.exists,expiryMs:expiry instanceof Timestamp?expiry.toMillis():null,now:Date.now()},purpose);
 } catch {return null;}
}
export async function requireWorkspaceIdentity():Promise<WorkspaceIdentity>{
 const token=await verifySession();
 const identity=token?await resolveWorkspaceIdentity(token):null;
 if(!identity)redirect("/login");
 return identity;
}
