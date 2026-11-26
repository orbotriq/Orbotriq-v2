export const PROVISIONING_LIMITS={trialDays:[1,90],trialBrands:[1,10000],trialGeo:[0,1000000],demoDays:[1,90],demoBrands:[1,10000],demoGeo:[0,1000000]} as const;
export type ProvisioningFields=Record<keyof typeof PROVISIONING_LIMITS,number>&{cashfreeCheckoutEnabled:boolean};
export const DEFAULT_PROVISIONING:ProvisioningFields={trialDays:14,trialBrands:2,trialGeo:5,demoDays:14,demoBrands:5,demoGeo:50,cashfreeCheckoutEnabled:true};
const keys=Object.keys(DEFAULT_PROVISIONING) as (keyof ProvisioningFields)[];
const bad=(error:string)=>({ok:false as const,error});
export function validateProvisioning(value:unknown):{ok:true;fields:ProvisioningFields}|{ok:false;error:string}{
 if(!value||typeof value!=="object"||Array.isArray(value))return bad("Invalid provisioning settings.");
 const v=value as Record<string,unknown>;
 if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))return bad("Unexpected or missing provisioning field.");
 for(const k of Object.keys(PROVISIONING_LIMITS) as (keyof typeof PROVISIONING_LIMITS)[]){const n=v[k], [min,max]=PROVISIONING_LIMITS[k];if(typeof n!=="number"||!Number.isSafeInteger(n)||n<min||n>max)return bad(`Invalid ${k}.`);}
 if(typeof v.cashfreeCheckoutEnabled!=="boolean")return bad("Invalid checkout setting.");
 return {ok:true,fields:{trialDays:v.trialDays as number,trialBrands:v.trialBrands as number,trialGeo:v.trialGeo as number,demoDays:v.demoDays as number,demoBrands:v.demoBrands as number,demoGeo:v.demoGeo as number,cashfreeCheckoutEnabled:v.cashfreeCheckoutEnabled}};
}
export function validateProvisioningUpdate(input:unknown){
 if(!input||typeof input!=="object"||Array.isArray(input))return bad("Invalid request.");
 const v=input as Record<string,unknown>;
 if(Object.keys(v).length!==2||!Object.hasOwn(v,"provisioning")||!Object.hasOwn(v,"version"))return bad("Unexpected or missing request field.");
 if(typeof v.version!=="string"||(v.version!=="missing"&&!/^\d{1,15}:\d{1,9}$/.test(v.version)))return bad("Invalid version. Reload settings.");
 const p=validateProvisioning(v.provisioning);return p.ok?{ok:true as const,fields:p.fields,version:v.version}:p;
}
export function provisioningChanges(a:ProvisioningFields,b:ProvisioningFields){return keys.filter(k=>a[k]!==b[k]);}
export function resolveProvisioning(exists:boolean,marker:unknown,fields:unknown):ProvisioningFields{
 if(!exists)return {...DEFAULT_PROVISIONING};
 const p=validateProvisioning(fields);if(marker!==true||!p.ok)throw Error("Stored provisioning settings require review.");return p.fields;
}
export function workspaceDefaults(p:ProvisioningFields,demo=false){return demo?{days:p.demoDays,brands:p.demoBrands,geo:p.demoGeo}:{days:p.trialDays,brands:p.trialBrands,geo:p.trialGeo};}
export function gatewayStatus(enabled:boolean,mode:unknown,app:unknown,secret:unknown){
 const appConfigured=typeof app==="string"&&app.trim().length>0,secretConfigured=typeof secret==="string"&&secret.trim().length>0;
 const ready=mode==="sandbox"&&appConfigured&&secretConfigured;
 return {mode:mode==="sandbox"?"Sandbox":mode?"Unsupported":"Not configured",appConfigured,secretConfigured,ready,checkoutAvailable:enabled&&ready};
}
