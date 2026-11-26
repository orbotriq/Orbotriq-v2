import "server-only";
import { FieldValue,type DocumentSnapshot } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { requirePlatformAdmin } from "@/lib/auth/guard";
import { requireWorkspaceIdentity } from "@/lib/auth/workspace-identity";
import { canViewWorkspaceModule } from "@/lib/auth/customer-policy";
import { isAdminWriteEnabled,requireAdminWrite } from "./write-guard";
import { DEFAULT_ACCESS,resolveAccess,validateAccessUpdate,accessChanges,decideAccess,type WorkspaceModule } from "./platform-access-view";
export const ACCESS_PATH="platform/v2AccessSettings";
const version=(t:{seconds:number;nanoseconds:number}|undefined)=>t?`${t.seconds}:${t.nanoseconds}`:"missing";
const fail=(error:string,status=400)=>({ok:false as const,error,status});
export function accessFromSnapshot(s:DocumentSnapshot){return resolveAccess(s.exists,s.get("phase15Test"),s.get("access"));}
export async function getAccessSettings(){
 await requirePlatformAdmin();
 if(!isAdminWriteEnabled())return {access:null,version:"missing",notice:"Access settings disabled outside isolated emulator.",configured:false};
 try{const s=await adminDb().doc(ACCESS_PATH).get();const p=accessFromSnapshot(s);if(s.exists&&!s.updateTime)throw Error("Missing version");return {access:p,version:version(s.updateTime),notice:s.exists?"":"All workspace modules enabled until settings are saved.",configured:s.exists};}
 catch{return {access:null,version:"missing",notice:"Stored access settings require review. Test workspace is unavailable; admin console remains accessible.",configured:false};}
}
// Page-level enforcement, independent of the shared layout and navigation links.
export async function workspaceAccess(module?:WorkspaceModule){
 const identity=await requireWorkspaceIdentity();
 const decision= !isAdminWriteEnabled()?decideAccess(DEFAULT_ACCESS,module):await (async()=>{try{return decideAccess(accessFromSnapshot(await adminDb().doc(ACCESS_PATH).get()),module);}catch{return decideAccess(null,module);}})();
 if(decision.kind==="allowed"&&!canViewWorkspaceModule(identity.role,module))return {kind:"disabled" as const,message:"Your organization role does not allow access to this module.",identity};
 return {...decision,identity};
}
export async function saveAccessSettings(input:unknown){
 const actor=await requireAdminWrite(),p=validateAccessUpdate(input);if(!p.ok)return fail(p.error);
 const db=adminDb(),ref=db.doc(ACCESS_PATH),audit=db.collection("platform/settingsManagement/auditLogs").doc();
 return db.runTransaction(async tx=>{
  const s=await tx.get(ref);if((s.exists&&!s.updateTime)||version(s.updateTime)!==p.version)return fail("Settings changed. Reload before saving.",409);
  let previous=DEFAULT_ACCESS;try{previous=accessFromSnapshot(s);}catch{return fail("Stored settings require review.",409);}
  const fields=accessChanges(previous,p.fields);if(s.exists&&!fields.length)return {ok:true as const,changed:false};
  const data={access:p.fields,phase15Test:true,updatedAt:FieldValue.serverTimestamp(),updatedBy:actor.uid};
  if(s.exists)tx.update(ref,data);else tx.create(ref,{...data,createdAt:FieldValue.serverTimestamp(),createdBy:actor.uid});
  tx.create(audit,{action:s.exists?"settings.access_updated":"settings.access_created",by:actor.uid,at:FieldValue.serverTimestamp(),fields});return {ok:true as const,changed:true};
 });
}
