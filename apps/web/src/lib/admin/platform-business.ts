import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { requirePlatformAdmin } from "@/lib/auth/guard";
import { isAdminWriteEnabled, requireAdminWrite } from "@/lib/admin/write-guard";
import { DEFAULT_BUSINESS, businessChanges, validateBusiness, validateBusinessUpdate } from "./platform-business-view";
const PATH="platform/v2BusinessSettings";
const failure=(error:string,status=400)=>({ok:false as const,error,status});
const version=(time:{seconds:number;nanoseconds:number}|undefined)=>time?`${time.seconds}:${time.nanoseconds}`:"missing";
export async function getBusinessSettings() {
  await requirePlatformAdmin();
  if(!isAdminWriteEnabled()) return {business:null,version:"missing",configured:false,notice:"Platform settings are disabled outside the isolated emulator."};
  const snap=await adminDb().doc(PATH).get();
  if(!snap.exists) return {business:{...DEFAULT_BUSINESS},version:"missing",configured:false,notice:"Not yet configured. Save fictional business information to initialize settings."};
  const parsed=validateBusiness(snap.get("business"));
  if(!snap.updateTime || !parsed.ok || snap.get("phase15Test")!==true) return {business:null,version:"missing",configured:false,notice:"Stored settings require review. Editing is disabled."};
  return {business:parsed.fields,version:version(snap.updateTime),configured:true,notice:""};
}
export async function saveBusinessSettings(input:unknown) {
  const actor=await requireAdminWrite();
  const parsed=validateBusinessUpdate(input);
  if(!parsed.ok) return failure(parsed.error);
  const db=adminDb(), ref=db.doc(PATH), audit=db.collection("platform/settingsManagement/auditLogs").doc();
  return db.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    if((snap.exists&&!snap.updateTime) || version(snap.updateTime)!==parsed.version) return failure("Settings changed. Reload before saving.",409);
    const old=snap.exists?validateBusiness(snap.get("business")):{ok:true as const,fields:DEFAULT_BUSINESS};
    if(!old.ok || (snap.exists&&snap.get("phase15Test")!==true)) return failure("Stored settings require review.",409);
    const changed=businessChanges(old.fields,parsed.fields);
    if(snap.exists&&!changed.length) return {ok:true as const,changed:false};
    const data={business:parsed.fields,phase15Test:true,updatedAt:FieldValue.serverTimestamp(),updatedBy:actor.uid};
    if(snap.exists) tx.update(ref,data); else tx.create(ref,{...data,createdAt:FieldValue.serverTimestamp(),createdBy:actor.uid});
    tx.create(audit,{action:snap.exists?"settings.business_updated":"settings.business_created",by:actor.uid,at:FieldValue.serverTimestamp(),fields:changed});
    return {ok:true as const,changed:true};
  });
}
