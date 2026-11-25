import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { adminDb } from "@/lib/firebase/admin";
import { requirePlatformAdmin } from "@/lib/auth/guard";
import { requireAdminWrite } from "@/lib/admin/write-guard";
import { failure } from "@/lib/admin/plan-validation";
const schema=z.object({action:z.enum(["suspend","reactivate","extend-demo","expire-demo"]),reason:z.string().trim().min(3).max(500),days:z.number().int().min(0).max(90),version:z.string().max(40).regex(/^\d+:\d+$/)}).strict();
const valid=(id:string)=>!!id&&Buffer.byteLength(id)<=1500&&!id.includes("/")&&id!=="."&&id!=="..";
const ver=(t:Timestamp)=>`${t.seconds}:${t.nanoseconds}`;
export async function getLifecycle(id:string){
 await requirePlatformAdmin(); if(!valid(id))return null;
 const s=await adminDb().collection("orgs").doc(id).get(); if(!s.exists||!s.updateTime)return null;
 const d=s.data()!; return {name:typeof d.name==="string"?d.name:id,status:typeof d.status==="string"?d.status:"unknown",demo:d.isDemo===true&&d.plan==="demo",version:ver(s.updateTime),expiry:(d.plan==="trial"||d.plan==="demo"?d.trialEndsAt:d.paidUntil) instanceof Timestamp?(d.plan==="trial"||d.plan==="demo"?d.trialEndsAt:d.paidUntil).toDate().toISOString():null};
}
export async function updateLifecycle(id:string,input:unknown){
 const actor=await requireAdminWrite(); const parsed=schema.safeParse(input); if(!valid(id)||!parsed.success)return failure("Invalid lifecycle request.");
 const v=parsed.data; if((v.action==="extend-demo")!==(v.days>0))return failure("Invalid extension days.");
 const db=adminDb(),ref=db.collection("orgs").doc(id),audit=ref.collection("auditLogs").doc();
 return db.runTransaction(async tx=>{
  const s=await tx.get(ref); if(!s.exists||!s.updateTime)return failure("Organization not found.",404); if(ver(s.updateTime)!==v.version)return failure("Organization changed. Reload.",409);
  const d=s.data()!, demo=d.isDemo===true&&d.plan==="demo", now=Date.now();
  if((d.isDemo===true||d.plan==="demo")&&!demo)return failure("Inconsistent demo record.",409);
  const expiry=d.plan==="trial"||demo?d.trialEndsAt:d.paidUntil;
  const updates:Record<string,string|Timestamp>={};
  if(v.action==="suspend"){
   if(demo||!["active","trialing"].includes(d.status))return failure("Cannot suspend this status.",409);
   updates.status="suspended";
  }else if(v.action==="reactivate"){
   if(demo||d.status!=="suspended"||typeof d.plan!=="string"||!d.plan||!(expiry instanceof Timestamp)||expiry.toMillis()<=now)return failure("Reactivation requires an unexpired suspended subscription.",409);
   updates.status=d.plan==="trial"?"trialing":"active";
  }else if(v.action==="expire-demo"){
   if(!demo||d.status!=="demo")return failure("Only active demo records can expire.",409);
   updates.status="expired"; updates.trialEndsAt=Timestamp.fromMillis(now);
  }else{
   if(!demo||!["demo","expired"].includes(d.status)||!(expiry instanceof Timestamp))return failure("Demo expiry requires review.",409);
   updates.trialEndsAt=Timestamp.fromMillis(Math.max(now,expiry.toMillis())+v.days*86400000); updates.status="demo";
  }
  tx.update(ref,updates); tx.create(audit,{action:`org.${v.action}`,by:actor.uid,at:FieldValue.serverTimestamp(),reason:v.reason,previousStatus:d.status,nextStatus:updates.status,fields:Object.keys(updates)});
  return {ok:true as const,changed:true};
 });
}
