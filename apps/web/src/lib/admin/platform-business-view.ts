export const BUSINESS_LIMITS = { displayName: 100, legalName: 120, supportEmail: 160, website: 200 } as const;
export type BusinessFields = Record<keyof typeof BUSINESS_LIMITS, string>;
export const DEFAULT_BUSINESS: BusinessFields = {displayName:"Orbotriq",legalName:"",supportEmail:"",website:""};
const keys = Object.keys(BUSINESS_LIMITS) as (keyof BusinessFields)[];
const bad = (error: string) => ({ok:false as const,error});
export function validateBusiness(value: unknown): {ok:true;fields:BusinessFields}|{ok:false;error:string} {
  if (!value || typeof value!=="object" || Array.isArray(value)) return bad("Invalid business information.");
  const raw=value as Record<string,unknown>;
  if (Object.keys(raw).length!==keys.length || Object.keys(raw).some(k=>!Object.hasOwn(BUSINESS_LIMITS,k))) return bad("Unexpected or missing business field.");
  const fields={...DEFAULT_BUSINESS};
  for(const key of keys) {
    const v=raw[key];
    if(typeof v!=="string" || v.length>BUSINESS_LIMITS[key] || /[\x00-\x1f\x7f]/.test(v)) return bad(`Invalid ${key}.`);
    fields[key]=v.trim();
  }
  if(fields.displayName.length<2) return bad("Display name must contain at least two characters.");
  if(fields.legalName && fields.legalName.length<2) return bad("Legal name must contain at least two characters.");
  if(fields.supportEmail && (!/^[a-z0-9][a-z0-9._+-]*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.test$/i.test(fields.supportEmail) || fields.supportEmail.includes(".."))) return bad("Use a fictional .test support email or leave it empty.");
  fields.supportEmail=fields.supportEmail.toLowerCase();
  if(fields.website) {
    try {
      const url=new URL(fields.website);
      if(!/^https:\/\//i.test(fields.website) || url.protocol!=="https:" || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.test$/i.test(url.hostname) || url.hostname.includes("..") || url.username || url.password || url.port || url.pathname!=="/" || url.search || url.hash) return bad("Use an HTTPS .test website origin, without credentials, path or query.");
      fields.website=url.origin;
    } catch {return bad("Invalid website.");}
  }
  return {ok:true,fields};
}
export function validateBusinessUpdate(input: unknown) {
  if(!input || typeof input!=="object" || Array.isArray(input)) return bad("Invalid request.");
  const raw=input as Record<string,unknown>;
  if(Object.keys(raw).length!==2 || !Object.hasOwn(raw,"business") || !Object.hasOwn(raw,"version")) return bad("Unexpected or missing request field.");
  if(typeof raw.version!=="string" || (raw.version!=="missing" && !/^\d{1,15}:\d{1,9}$/.test(raw.version))) return bad("Invalid version. Reload settings.");
  const parsed=validateBusiness(raw.business);
  return parsed.ok?{ok:true as const,fields:parsed.fields,version:raw.version}:parsed;
}
export function businessChanges(before:BusinessFields,after:BusinessFields) {return keys.filter(k=>before[k]!==after[k]);}
