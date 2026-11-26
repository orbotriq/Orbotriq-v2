import "server-only";
import { randomUUID } from "node:crypto";
import { FieldValue,Timestamp } from "firebase-admin/firestore";
import type { DecodedIdToken,UserRecord } from "firebase-admin/auth";
import { adminAuth,adminDb } from "@/lib/firebase/admin";
import { isAdminWriteEnabled } from "@/lib/admin/write-guard";
import { customerContext,safeId,customerRole,testEmail } from "./customer-policy";
import { parseOnboarding,recentPasswordToken,nextAuthTime } from "./onboarding-policy";
const fail=(status:number,error:string)=>({ok:false as const,status,error});
const denied=()=>fail(403,"Password setup is unavailable for this account.");
const review=()=>fail(409,"Account operation incomplete or locked. Contact your administrator.");
export async function completeOnboarding(input:unknown){
 if(!isAdminWriteEnabled())return denied();
 const v=parseOnboarding(input);if(!v)return fail(400,"Enter a different password of 12–128 characters, with upper and lower case, a number and a symbol, without spaces.");
 const auth=adminAuth(),db=adminDb();
 let token:DecodedIdToken;
 try{
  token=await auth.verifyIdToken(v.idToken,true);
  if(!recentPasswordToken(token,Date.now())||!safeId(token.uid)||!safeId(token.orgId)||!customerRole(token.role)||!testEmail(token.email)||token.platformAdmin!==undefined)return denied();
  // Recheck the actual current password against the fixed local Auth emulator only.
  const r=await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:token.email,password:v.currentPassword,returnSecureToken:true}),redirect:"error",cache:"no-store",signal:AbortSignal.timeout(10000)});
  if(!r.ok)return denied();
  const result=await r.json();if(typeof result.idToken!=="string")return denied();
  const fresh=await auth.verifyIdToken(result.idToken,true);
  if(fresh.uid!==token.uid||fresh.orgId!==token.orgId||fresh.role!==token.role||fresh.email!==token.email||!recentPasswordToken(fresh,Date.now()))return denied();
  token=fresh;
 }catch{return denied();}
 const uid=token.uid,orgId=token.orgId as string,org=db.doc(`orgs/${orgId}`),member=org.collection("members").doc(uid),profile=db.doc(`users/${uid}`),lock=db.doc(`platform/userManagement/locks/${uid}`),audit=db.collection("platform/userManagement/auditLogs").doc(),operationId=randomUUID();
 const eligible=(account:UserRecord,p:Record<string,unknown>|undefined,m:Record<string,unknown>|undefined,o:Record<string,unknown>|undefined)=>{
  const expiry=o?.status==="active"?o.paidUntil:o?.trialEndsAt;
  return customerContext({token,account:{uid:account.uid,email:account.email,disabled:account.disabled,emailVerified:account.emailVerified,claims:account.customClaims??{}},profile:p,member:m,org:o,locked:false,expiryMs:expiry instanceof Timestamp?expiry.toMillis():null,now:Date.now()},"onboarding");
 };
 try{
  const account=await auth.getUser(uid);
  const acquired=await db.runTransaction(async tx=>{
   const [l,p,m,o]=await tx.getAll(lock,profile,member,org);
   if(l.exists||!eligible(account,p.data(),m.data(),o.data()))return false;
   tx.create(lock,{by:uid,at:FieldValue.serverTimestamp(),operation:"onboarding",operationId});
   tx.create(audit,{action:"password.change_requested",uid,orgId,by:uid,at:FieldValue.serverTimestamp()});
   return true;
  });
  if(!acquired)return review();
  // Keep the persistent lock on any ambiguous cross-service failure. Never auto-clear it.
  const live=await auth.getUser(uid);
  const [p,m,o]=await db.getAll(profile,member,org);
  if(!eligible(live,p.data(),m.data(),o.data()))return review();
  await auth.updateUser(uid,{password:v.newPassword});
  await auth.revokeRefreshTokens(uid);
  const minAuthTime=nextAuthTime(Date.now()),updated=await auth.getUser(uid);
  await db.runTransaction(async tx=>{
   const [l,p,m,o]=await tx.getAll(lock,profile,member,org);
   if(l.get("operationId")!==operationId||!eligible(updated,p.data(),m.data(),o.data()))throw new Error("Account changed");
   tx.update(member,{mustChangePassword:false,minAuthTime,passwordChangedAt:FieldValue.serverTimestamp()});
   tx.update(audit,{action:"password.changed",completedAt:FieldValue.serverTimestamp()});
   tx.delete(lock);
  });
  return {ok:true as const};
 }catch{return review();}
}
