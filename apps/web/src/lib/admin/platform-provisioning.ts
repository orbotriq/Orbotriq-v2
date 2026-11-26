import "server-only";
import { FieldValue,type DocumentSnapshot } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { requirePlatformAdmin } from "@/lib/auth/guard";
import { isAdminWriteEnabled,requireAdminWrite } from "./write-guard";
import { DEFAULT_PROVISIONING,resolveProvisioning,validateProvisioningUpdate,provisioningChanges,gatewayStatus } from "./platform-provisioning-view";
export const PROVISIONING_PATH="platform/v2ProvisioningSettings";
const version=(t:{seconds:number;nanoseconds:number}|undefined)=>t?`${t.seconds}:${t.nanoseconds}`:"missing";
const fail=(error:string,status=400)=>({ok:false as const,error,status});
export function provisioningFromSnapshot(s:DocumentSnapshot){return resolveProvisioning(s.exists,s.get("phase15Test"),s.get("provisioning"));}
export async function getProvisioningSettings(){
 await requirePlatformAdmin();
 if(!isAdminWriteEnabled())return {provisioning:null,version:"missing",notice:"Provisioning settings disabled outside isolated emulator.",configured:false,gateway:gatewayStatus(false,undefined,undefined,undefined)};
 const s=await adminDb().doc(PROVISIONING_PATH).get();
 try{const p=provisioningFromSnapshot(s);if(s.exists&&!s.updateTime)throw Error("Missing version");return {provisioning:p,version:version(s.updateTime),notice:s.exists?"":"Legacy test defaults apply until saved.",configured:s.exists,gateway:gatewayStatus(p.cashfreeCheckoutEnabled,process.env.CASHFREE_ENV,process.env.CASHFREE_APP_ID,process.env.CASHFREE_SECRET_KEY)};}
 catch{return {provisioning:null,version:"missing",notice:"Stored provisioning settings require review. New provisioning and checkout are blocked.",configured:false,gateway:gatewayStatus(false,process.env.CASHFREE_ENV,process.env.CASHFREE_APP_ID,process.env.CASHFREE_SECRET_KEY)};}
}
// Called only after the caller's write guard. No production reads.
export async function loadProvisioningForWrite(){await requireAdminWrite();return provisioningFromSnapshot(await adminDb().doc(PROVISIONING_PATH).get());}
export async function saveProvisioningSettings(input:unknown){
 const actor=await requireAdminWrite(),p=validateProvisioningUpdate(input);if(!p.ok)return fail(p.error);
 const db=adminDb(),ref=db.doc(PROVISIONING_PATH),audit=db.collection("platform/settingsManagement/auditLogs").doc();
 return db.runTransaction(async tx=>{
  const s=await tx.get(ref);if((s.exists&&!s.updateTime)||version(s.updateTime)!==p.version)return fail("Settings changed. Reload before saving.",409);
  let previous=DEFAULT_PROVISIONING;try{previous=provisioningFromSnapshot(s);}catch{return fail("Stored settings require review.",409);}
  const fields=provisioningChanges(previous,p.fields);if(s.exists&&!fields.length)return {ok:true as const,changed:false};
  const data={provisioning:p.fields,phase15Test:true,updatedAt:FieldValue.serverTimestamp(),updatedBy:actor.uid};
  if(s.exists)tx.update(ref,data);else tx.create(ref,{...data,createdAt:FieldValue.serverTimestamp(),createdBy:actor.uid});
  tx.create(audit,{action:s.exists?"settings.provisioning_updated":"settings.provisioning_created",by:actor.uid,at:FieldValue.serverTimestamp(),fields});return {ok:true as const,changed:true};
 });
}
