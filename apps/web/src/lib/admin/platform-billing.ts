import "server-only";
import { FieldValue, type DocumentSnapshot } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { requirePlatformAdmin } from "@/lib/auth/guard";
import { isAdminWriteEnabled, requireAdminWrite } from "./write-guard";
import { DEFAULT_BILLING,billingChanges,validateBilling,validateBillingUpdate,resolveInvoiceConfig } from "./platform-billing-view";
import { validateBusiness } from "./platform-business-view";
export const BILLING_SETTINGS_PATH="platform/v2BillingSettings";
export const BUSINESS_SETTINGS_PATH="platform/v2BusinessSettings";
const fail=(error:string,status=400)=>({ok:false as const,error,status});
const version=(t:{seconds:number;nanoseconds:number}|undefined)=>t?`${t.seconds}:${t.nanoseconds}`:"missing";
export function configFromSnapshots(b:DocumentSnapshot,s:DocumentSnapshot){
 if(b.exists&&b.get("phase15Test")!==true)throw Error("Billing settings require review");
 return resolveInvoiceConfig(b.exists?b.get("billing"):undefined,b.exists?true:undefined,s.get("business"),s.get("phase15Test"));
}
export async function getInvoiceConfig(){
 await requirePlatformAdmin();if(!isAdminWriteEnabled())return null;
 const db=adminDb();const [b,s]=await Promise.all([db.doc(BILLING_SETTINGS_PATH).get(),db.doc(BUSINESS_SETTINGS_PATH).get()]);
 try{return configFromSnapshots(b,s);}catch{return null;}
}
export async function getBillingSettings(){
 await requirePlatformAdmin();if(!isAdminWriteEnabled())return {billing:null,version:"missing",notice:"Billing settings disabled outside isolated emulator.",configured:false};
 const db=adminDb(),[b,s]=await Promise.all([db.doc(BILLING_SETTINGS_PATH).get(),db.doc(BUSINESS_SETTINGS_PATH).get()]);
 if(s.get("phase15Test")!==true||!validateBusiness(s.get("business")).ok)return {billing:null,version:"missing",notice:"Save fictional business information first.",configured:false};
 if(!b.exists)return {billing:{...DEFAULT_BILLING},version:"missing",notice:"Legacy test defaults apply until billing settings are saved.",configured:false};
 const parsed=validateBilling(b.get("billing"));
 if(!parsed.ok||!b.updateTime||b.get("phase15Test")!==true)return {billing:null,version:"missing",notice:"Stored billing settings require review.",configured:false};
 return {billing:parsed.fields,version:version(b.updateTime),notice:"",configured:true};
}
export async function saveBillingSettings(input:unknown){
 const actor=await requireAdminWrite(),p=validateBillingUpdate(input);if(!p.ok)return fail(p.error);
 const db=adminDb(),ref=db.doc(BILLING_SETTINGS_PATH),business=db.doc(BUSINESS_SETTINGS_PATH),audit=db.collection("platform/settingsManagement/auditLogs").doc();
 return db.runTransaction(async tx=>{
 const [b,s]=await Promise.all([tx.get(ref),tx.get(business)]);
 if((b.exists&&!b.updateTime)||version(b.updateTime)!==p.version)return fail("Settings changed. Reload before saving.",409);
 if(s.get("phase15Test")!==true||!validateBusiness(s.get("business")).ok)return fail("Save fictional business information first.",409);
 const previous=b.exists?validateBilling(b.get("billing")):{ok:true as const,fields:DEFAULT_BILLING};
 if(!previous.ok||(b.exists&&b.get("phase15Test")!==true))return fail("Stored billing settings require review.",409);
 const changed=billingChanges(previous.fields,p.fields);if(b.exists&&!changed.length)return {ok:true as const,changed:false};
 const data={billing:p.fields,phase15Test:true,updatedAt:FieldValue.serverTimestamp(),updatedBy:actor.uid};
 if(b.exists)tx.update(ref,data);else tx.create(ref,{...data,createdAt:FieldValue.serverTimestamp(),createdBy:actor.uid});
 tx.create(audit,{action:b.exists?"settings.billing_updated":"settings.billing_created",by:actor.uid,at:FieldValue.serverTimestamp(),fields:changed});return {ok:true as const,changed:true};
 });
}
