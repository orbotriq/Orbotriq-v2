import { price } from "./billing-math";
import { validateBusiness } from "./platform-business-view";
export const GST_RATES = [0,5,12,18,28] as const;
export type BillingFields = { address:string; stateCode:string; gstRegistered:boolean; gstin:string; gstRate:number; taxPrefix:string; proformaPrefix:string; paymentDays:number; terms:string };
export const DEFAULT_BILLING: BillingFields = {address:"Fictional test address",stateCode:"33",gstRegistered:true,gstin:"",gstRate:18,taxPrefix:"TST",proformaPrefix:"TPR",paymentDays:0,terms:""};
const keys=Object.keys(DEFAULT_BILLING) as (keyof BillingFields)[];
const bad=(error:string)=>({ok:false as const,error});
export function validTaxPrefix(value:unknown):value is string {return typeof value==="string" && /^TST[A-Z0-9]{0,2}$/.test(value);}
export function validTaxInvoiceId(value:unknown):value is string {return typeof value==="string" && /^TST[A-Z0-9]{0,2}-\d{2}-\d{2}-\d{4}$/.test(value);}
export function validProformaPrefix(value:unknown):value is string {return typeof value==="string" && /^TPR[A-Z0-9]{0,2}$/.test(value);}
export function validateBilling(value:unknown):{ok:true;fields:BillingFields}|{ok:false;error:string} {
 if(!value||typeof value!=="object"||Array.isArray(value))return bad("Invalid billing settings.");
 const v=value as Record<string,unknown>;
 if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))return bad("Unexpected or missing billing field.");
 if(typeof v.address!=="string"||v.address.trim().length<5||v.address.length>300||/[\x00-\x1f\x7f]/.test(v.address))return bad("Enter a fictional billing address (5–300 characters).");
 if(typeof v.stateCode!=="string"||! /^(0[1-9]|[12][0-9]|3[0-8])$/.test(v.stateCode))return bad("Invalid test state code.");
 if(typeof v.gstRegistered!=="boolean"||typeof v.gstin!=="string"||typeof v.gstRate!=="number"||!GST_RATES.some(r=>r===v.gstRate))return bad("Invalid GST configuration.");
 const gstin=v.gstin.trim().toUpperCase();
 if(gstin&&gstin!==v.stateCode+"AAAAA0000A1Z0")return bad("Only the fictional test GSTIN placeholder is accepted, or leave blank.");
 if(!v.gstRegistered&&(gstin!==""||v.gstRate!==0))return bad("Unregistered test seller requires blank GSTIN and zero tax.");
 const taxPrefix=typeof v.taxPrefix==="string"?v.taxPrefix.trim().toUpperCase():null,proformaPrefix=typeof v.proformaPrefix==="string"?v.proformaPrefix.trim().toUpperCase():null;
 if(!validTaxPrefix(taxPrefix)||!validProformaPrefix(proformaPrefix))return bad("Tax prefix must be TST and proforma prefix TPR, each with up to two optional letters or digits.");
 if(typeof v.paymentDays!=="number"||!Number.isInteger(v.paymentDays)||v.paymentDays<0||v.paymentDays>90)return bad("Payment days must be an integer from 0 to 90.");
 if(typeof v.terms!=="string"||v.terms.length>500||/[\x00-\x1f\x7f]/.test(v.terms))return bad("Invalid test invoice terms (maximum 500 characters, single line).");
 return {ok:true,fields:{address:v.address.trim(),stateCode:v.stateCode,gstRegistered:v.gstRegistered,gstin,gstRate:v.gstRate,taxPrefix,proformaPrefix,paymentDays:v.paymentDays,terms:v.terms.trim()}};
}
export function validateBillingUpdate(input:unknown) {
 if(!input||typeof input!=="object"||Array.isArray(input))return bad("Invalid request.");
 const v=input as Record<string,unknown>;
 if(Object.keys(v).length!==2||!Object.hasOwn(v,"billing")||!Object.hasOwn(v,"version"))return bad("Unexpected or missing request field.");
 if(typeof v.version!=="string"||(v.version!=="missing"&&!/^\d{1,15}:\d{1,9}$/.test(v.version)))return bad("Invalid version.");
 const parsed=validateBilling(v.billing);return parsed.ok?{ok:true as const,fields:parsed.fields,version:v.version}:parsed;
}
export function billingChanges(before:BillingFields,after:BillingFields){return keys.filter(k=>before[k]!==after[k]);}
export type InvoicePreferences={taxPrefix:string;proformaPrefix:string;paymentDays:number;terms:string};
export function invoicePreferences(b:BillingFields):InvoicePreferences{return {taxPrefix:b.taxPrefix,proformaPrefix:b.proformaPrefix,paymentDays:b.paymentDays,terms:b.terms};}
export function storedPreferences(value:unknown):InvoicePreferences {
 if(value===undefined)return invoicePreferences(DEFAULT_BILLING);
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Invalid invoice preferences");
 const v=value as Record<string,unknown>;
 const p=validateBilling({...DEFAULT_BILLING,taxPrefix:v.taxPrefix,proformaPrefix:v.proformaPrefix,paymentDays:v.paymentDays,terms:v.terms});
 if(!p.ok)throw Error("Invalid invoice preferences");return invoicePreferences(p.fields);
}
export function invoiceDueDate(issueDate:string,days:number){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)||!Number.isInteger(days)||days<0||days>90)throw Error("Invalid payment terms");
 const date=new Date(issueDate+"T00:00:00Z");if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==issueDate)throw Error("Invalid issue date");date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);
}
export function resolveInvoiceConfig(billing:unknown,billingMarker:unknown,business:unknown,businessMarker:unknown) {
 if(billing===undefined&&billingMarker===undefined)return {fields:{...DEFAULT_BILLING},seller:{legalName:"Orbotriq TEST ONLY",address:DEFAULT_BILLING.address,stateCode:DEFAULT_BILLING.stateCode,gstRegistered:true,gstin:""},configured:false};
 const b=validateBilling(billing),name=validateBusiness(business);
 if(!b.ok||billingMarker!==true||!name.ok||businessMarker!==true)throw Error("Billing configuration requires review; save test business and billing settings.");
 const f=b.fields;return {fields:f,seller:{legalName:name.fields.legalName||name.fields.displayName,address:f.address,stateCode:f.stateCode,gstRegistered:f.gstRegistered,gstin:f.gstin},configured:true};
}
export type InvoiceConfig=ReturnType<typeof resolveInvoiceConfig>;
export function invoiceTax(amount:number,buyerState:string,config:InvoiceConfig){const intra=buyerState===config.seller.stateCode;return {...price(amount,config.fields.gstRate,intra),taxMode:intra?"intra":"inter"};}
