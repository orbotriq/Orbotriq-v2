import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { adminDb } from "@/lib/firebase/admin";
import { requirePlatformAdmin } from "@/lib/auth/guard";
import { requireAdminWrite } from "@/lib/admin/write-guard";
import { failure, isEditablePlanId, validAllowance } from "@/lib/admin/plan-validation";

const schema = z.object({planId:z.string().refine(isEditablePlanId), extendDays:z.number().int().min(0).max(90), version:z.string().max(40).regex(/^\d+:\d+$/), planVersion:z.string().max(40).regex(/^\d+:\d+$/)}).strict();
const validId = (id:string) => !!id && Buffer.byteLength(id)<=1500 && !id.includes("/") && id!=="." && id!=="..";
const version = (t:Timestamp) => `${t.seconds}:${t.nanoseconds}`;
function map(v:unknown): v is Record<string,unknown> { return !!v && typeof v==="object" && Object.getPrototypeOf(v)===Object.prototype; }
export function monthlyUsage(v:unknown, month:string):number|null {
  if(v===undefined) return 0;
  if(!map(v)) return null;
  if(v.month===undefined) return Object.keys(v).length===0?0:null;
  if(typeof v.month!=="string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v.month) || v.month>month) return null;
  return v.month!==month || v.geoRuns===undefined ? 0 : validAllowance(v.geoRuns);
}
export async function getSubscription(orgId:string) {
  await requirePlatformAdmin();
  if(!validId(orgId)) return null;
  const db=adminDb();
  const s=await db.collection("orgs").doc(orgId).get();
  if(!s.exists || !s.updateTime) return null;
  const d=s.data()!;
  const month=new Date().toISOString().slice(0,7);
  const plans=await db.collection("plans").select("limits.brands","limits.geoRuns").get();
  const options=plans.docs.flatMap(p=>{
    const b=validAllowance(p.data().limits?.brands), g=validAllowance(p.data().limits?.geoRuns);
    return isEditablePlanId(p.id)&&b!==null&&b>0&&b<=10000&&g!==null&&g<=1000000&&p.updateTime ? [{id:p.id,brands:b,geo:g,version:version(p.updateTime)}]:[];
  });
  return {id:orgId,name:typeof d.name==="string"?d.name:orgId,plan:typeof d.plan==="string"?d.plan:"",status:typeof d.status==="string"?d.status:"unknown",eligible:d.isDemo!==true&&d.plan!=="demo"&&["active","trialing","expired","suspended"].includes(d.status),brands:validAllowance(d.institutionCount),brandLimit:validAllowance(d.limits?.institutions),geo:monthlyUsage(d.usage,month),geoLimit:validAllowance(d.limits?.geoRuns),month,expiry:(d.plan==="trial"?d.trialEndsAt:d.paidUntil) instanceof Timestamp?(d.plan==="trial"?d.trialEndsAt:d.paidUntil).toDate().toISOString():null,version:version(s.updateTime),options};
}
export async function updateSubscription(orgId:string,input:unknown){
  const actor=await requireAdminWrite();
  const parsed=schema.safeParse(input);
  if(!validId(orgId)||!parsed.success) return failure("Invalid subscription request.");
  const v=parsed.data, db=adminDb(), ref=db.collection("orgs").doc(orgId), plan=db.collection("plans").doc(v.planId), audit=ref.collection("auditLogs").doc();
  return db.runTransaction(async tx=>{
    const s=await tx.get(ref), p=await tx.get(plan);
    if(!s.exists||!s.updateTime||!p.exists||!p.updateTime) return failure("Organization or plan not found.",404);
    if(version(s.updateTime)!==v.version||version(p.updateTime)!==v.planVersion) return failure("Organization or plan changed. Reload.",409);
    const d=s.data()!, limits=p.data()?.limits;
    if(d.isDemo===true||d.plan==="demo"||!["active","trialing","expired","suspended"].includes(d.status)) return failure("Subscription requires manual review.",409);
    // Trial conversion and activation are deliberately separate operations.
    if(d.plan==="trial"||d.status==="trialing") return failure("Trial conversion requires a separate activation workflow.",409);
    const b=validAllowance(limits?.brands),g=validAllowance(limits?.geoRuns),used=validAllowance(d.institutionCount),geo=monthlyUsage(d.usage,new Date().toISOString().slice(0,7));
    if(b===null||b<1||b>10000||g===null||g>1000000||used===null||geo===null||!map(d.limits)) return failure("Invalid plan or usage data.",409);
    if(b<used||g<geo) return failure("Plan allowance is below current usage.");
    const updates:Record<string,string|number|Timestamp>={};
    if(d.plan!==v.planId){updates.plan=v.planId; updates["limits.institutions"]=b; updates["limits.geoRuns"]=g;}
    if(v.extendDays>0){
      if(!(d.paidUntil instanceof Timestamp)) return failure("Existing paid expiry requires review.",409);
      updates.paidUntil=Timestamp.fromMillis(Math.max(Date.now(),d.paidUntil.toMillis())+v.extendDays*86400000);
    }
    const fields=Object.keys(updates);
    if(!fields.length) return {ok:true as const,changed:false};
    tx.update(ref,updates);
    tx.create(audit,{action:"org.updated_by_admin",by:actor.uid,at:FieldValue.serverTimestamp(),fields,previousPlan:typeof d.plan==="string"?d.plan:null,nextPlan:v.planId});
    return {ok:true as const,changed:true};
  });
}
