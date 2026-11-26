export const MODULE_LABELS={brands:"Brand management",social:"Social media & publishing",ads:"Advertising",seo:"SEO & Analytics",geo:"GEO · AI Search",competitors:"Competitor intelligence",copilot:"Growth Copilot",alerts:"Smart alerts",reports:"Reports",billing:"Billing & subscriptions",settings:"Workspace settings",clients:"Clients & CRM",projects:"Projects & Tasks"} as const;
export type WorkspaceModule=keyof typeof MODULE_LABELS;
export const MODULE_KEYS=Object.keys(MODULE_LABELS) as WorkspaceModule[];
export type AccessFields={maintenance:boolean;message:string;modules:Record<WorkspaceModule,boolean>};
export const DEFAULT_ACCESS:AccessFields={maintenance:false,message:"Workspace maintenance is in progress. Please try again later.",modules:Object.fromEntries(MODULE_KEYS.map(k=>[k,true])) as AccessFields["modules"]};
const bad=(error:string)=>({ok:false as const,error});
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export function validateAccess(value:unknown):{ok:true;fields:AccessFields}|{ok:false;error:string}{
 if(!record(value)||!exact(value,["maintenance","message","modules"]))return bad("Unexpected or missing access setting.");
 if(typeof value.maintenance!=="boolean")return bad("Invalid maintenance switch.");
 if(typeof value.message!=="string"||/[\x00-\x1f\x7f]/.test(value.message)||value.message.trim().length<1||value.message.trim().length>240)return bad("Maintenance message must contain 1–240 plain text characters.");
 if(!record(value.modules)||!exact(value.modules,MODULE_KEYS))return bad("Unexpected or missing module.");
 const modules=value.modules;
 if(MODULE_KEYS.some(k=>typeof modules[k]!=="boolean"))return bad("Invalid module switch.");
 return {ok:true,fields:{maintenance:value.maintenance,message:value.message.trim(),modules:Object.fromEntries(MODULE_KEYS.map(k=>[k,modules[k]])) as AccessFields["modules"]}};
}
export function validateAccessUpdate(input:unknown){
 if(!record(input)||!exact(input,["access","version"]))return bad("Unexpected or missing request field.");
 if(typeof input.version!=="string"||(input.version!=="missing"&&!/^\d{1,15}:\d{1,9}$/.test(input.version)))return bad("Invalid version. Reload settings.");
 const p=validateAccess(input.access);return p.ok?{ok:true as const,fields:p.fields,version:input.version}:p;
}
export function resolveAccess(exists:boolean,marker:unknown,fields:unknown):AccessFields{
 if(!exists)return {...DEFAULT_ACCESS,modules:{...DEFAULT_ACCESS.modules}};
 const p=validateAccess(fields);if(marker!==true||!p.ok)throw Error("Stored access settings require review.");return p.fields;
}
export function accessChanges(a:AccessFields,b:AccessFields){return [...(a.maintenance!==b.maintenance?["maintenance"]:[]),...(a.message!==b.message?["message"]:[]),...MODULE_KEYS.filter(k=>a.modules[k]!==b.modules[k]).map(k=>`modules.${k}`)];}
export function moduleKey(value:string):value is WorkspaceModule{return Object.hasOwn(MODULE_LABELS,value);}
export type AccessDecision={kind:"allowed"}|{kind:"maintenance"|"disabled"|"unavailable";message:string};
export function decideAccess(config:AccessFields|null,module?:WorkspaceModule):AccessDecision{
 if(!config)return {kind:"unavailable",message:"Workspace access settings require administrator review."};
 if(config.maintenance)return {kind:"maintenance",message:config.message};
 if(module&&!config.modules[module])return {kind:"disabled",message:"This workspace module is currently disabled."};
 return {kind:"allowed"};
}
