// Pure authorization policy. No Firebase or browser dependencies.
export type CustomerRole = "owner" | "admin" | "staff" | "viewer";
export type WorkspaceRole = "platform" | CustomerRole;
export type CustomerContext = { role: CustomerRole; orgId: string; name: string; status: "active" | "trialing" | "demo" };
export type WorkspaceIdentity = {role:"platform"} | CustomerContext;
export const safeId=(v:unknown):v is string=>typeof v==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
export const customerRole=(v:unknown):v is CustomerRole=>v==="owner"||v==="admin"||v==="staff"||v==="viewer";
export const testEmail=(v:unknown):v is string=>typeof v==="string"&&v.length<=254&&/^[^\s@]+@[^\s@]+\.test$/i.test(v);
type RecordData=Record<string,unknown>;
export function customerContext(input:{token:RecordData;account:{uid:unknown;email:unknown;disabled:unknown;emailVerified:unknown;claims:RecordData};profile:RecordData|undefined;member:RecordData|undefined;org:RecordData|undefined;locked:boolean;expiryMs:unknown;now:number}, purpose:"workspace"|"onboarding"="workspace"):CustomerContext|null {
 const {token:t,account:a,profile:p,member:m,org:o,locked,expiryMs,now}=input;
 if(locked||!safeId(t.uid)||!safeId(t.orgId)||!customerRole(t.role)||t.platformAdmin!==undefined||a.claims.platformAdmin!==undefined||a.uid!==t.uid||a.disabled!==false||a.emailVerified!==true||t.email_verified!==true||!testEmail(t.email)||a.email!==t.email||a.claims.orgId!==t.orgId||a.claims.role!==t.role)return null;
 if(!p||!m||!o||p.orgId!==t.orgId||p.email!==a.email||m.email!==a.email||m.role!==t.role||m.mustChangePassword!==(purpose==="onboarding")||!safeId(o.ownerUid)||(t.role==="owner")!==(o.ownerUid===t.uid))return null;
 if(m.minAuthTime!==undefined&&(typeof m.minAuthTime!=="number"||!Number.isSafeInteger(m.minAuthTime)||m.minAuthTime<0||typeof t.auth_time!=="number"||!Number.isSafeInteger(t.auth_time)||t.auth_time<m.minAuthTime))return null;
 if(typeof o.name!=="string"||!o.name.trim()||o.name.length>160||/[\x00-\x1f\x7f]/.test(o.name)||!safeId(o.plan)||typeof o.isDemo!=="boolean")return null;
 const status=o.status;
 if(status!=="active"&&status!=="trialing"&&status!=="demo")return null;
 if(status==="active"&&(o.plan==="trial"||o.plan==="demo"||o.isDemo)||status==="trialing"&&(o.plan!=="trial"||o.isDemo)||status==="demo"&&(o.plan!=="demo"||!o.isDemo))return null;
 if(typeof expiryMs!=="number"||!Number.isFinite(expiryMs)||!Number.isFinite(now)||expiryMs<=now)return null;
 return {role:t.role,orgId:t.orgId,name:o.name,status};
}
// Read-only route policy. Does not authorize future service APIs or writes.
export function canViewWorkspaceModule(role:WorkspaceRole,module?:string):boolean {
 if(role==="platform")return true;
 if(module==="billing")return role==="owner";
 if(module==="settings")return role==="owner"||role==="admin";
 return module===undefined||["brands","social","ads","seo","geo","competitors","copilot","alerts","reports","clients","projects"].includes(module);
}
