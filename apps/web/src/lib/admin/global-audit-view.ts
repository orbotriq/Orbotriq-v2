export const AUDIT_CATEGORIES = ["Organization", "User", "Subscription", "Billing", "Lead", "Integration", "Settings", "Other"] as const;
export type AuditCategory = typeof AUDIT_CATEGORIES[number];
const actions: Record<string, AuditCategory> = {
  "settings.access_created":"Settings", "settings.access_updated":"Settings",
  "settings.provisioning_created":"Settings", "settings.provisioning_updated":"Settings",
  "settings.billing_created":"Settings", "settings.billing_updated":"Settings",
  "settings.business_created":"Settings", "settings.business_updated":"Settings",
  "org.created":"Organization", "org.created_by_admin":"Organization", "org.demo_created":"Organization", "org.updated_by_admin":"Organization",
  "org.suspend":"Organization", "org.reactivate":"Organization", "org.extend-demo":"Organization", "org.expire-demo":"Organization",
  "password.changed":"User", "user.status_requested":"User", "user.status_changed":"User", "user.role_requested":"User", "user.role_changed":"User", "user.provision_requested":"User", "user.provisioned":"User",
  "plan.created":"Subscription", "plan.updated":"Subscription", "subscription.renewed":"Subscription",
  "billing.profile_saved":"Billing", "invoice.issued":"Billing", "invoice.paid":"Billing", "invoice.voided":"Billing", "proforma.converted":"Billing",
  "lead.created":"Lead", "lead.updated":"Lead", "lead.followup_changed":"Lead", "lead.activity_recorded":"Lead", "lead.conversion_reserved":"Lead", "lead.conversion_provisioned":"Lead", "lead.converted":"Lead",
  "metaApp.saved":"Integration", "campaign.active":"Integration", "campaign.paused":"Integration", "review.replied":"Integration"
};
const labels: Record<string, string> = {
  "settings.access_created":"Workspace access settings created", "settings.access_updated":"Workspace access settings updated",
  "settings.provisioning_created":"Provisioning settings created", "settings.provisioning_updated":"Provisioning settings updated",
  "settings.billing_created":"Billing settings created", "settings.billing_updated":"Billing settings updated",
  "settings.business_created":"Business settings created", "settings.business_updated":"Business settings updated",
  "org.created":"Organization created", "org.created_by_admin":"Organization created by administrator", "org.demo_created":"Demo created", "org.updated_by_admin":"Organization updated", "org.suspend":"Organization suspended", "org.reactivate":"Organization reactivated", "org.extend-demo":"Demo extended", "org.expire-demo":"Demo expired",
  "password.changed":"Password changed", "user.status_requested":"User status change requested", "user.status_changed":"User status changed", "user.role_requested":"User role change requested", "user.role_changed":"User role changed", "user.provision_requested":"User provisioning requested", "user.provisioned":"User provisioned",
  "plan.created":"Plan created", "plan.updated":"Plan updated", "subscription.renewed":"Subscription renewed", "billing.profile_saved":"Billing profile saved", "invoice.issued":"Invoice issued", "invoice.paid":"Invoice paid", "invoice.voided":"Invoice voided", "proforma.converted":"Proforma converted",
  "lead.created":"Lead created", "lead.updated":"Lead updated", "lead.followup_changed":"Lead follow-up changed", "lead.activity_recorded":"Lead activity recorded", "lead.conversion_reserved":"Lead conversion reserved", "lead.conversion_provisioned":"Lead conversion provisioned", "lead.converted":"Lead converted",
  "metaApp.saved":"Meta configuration saved", "campaign.active":"Campaign activated", "campaign.paused":"Campaign paused", "review.replied":"Review replied"
};
// Only display ordinary identifier characters. Do not serialize arbitrary strings/maps from audit records.
export function auditIdentifier(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,150}$/.test(value) ? value : "";
}
export function auditSource(path: string) {
  const p=path.split("/");
  if (p.length!==4 || p[2]!=="auditLogs" || !auditIdentifier(p[1]) || !auditIdentifier(p[3])) return null;
  if (p[0]==="orgs") return {source:"Organization", orgId:p[1], id:p[3]};
  if (p[0]==="platform" && ["planManagement","userManagement","leadManagement","settingsManagement"].includes(p[1])) return {source:p[1],orgId:"",id:p[3]};
  return null;
}
export function auditDay(ms: number): string {
  return Number.isFinite(ms) && ms>=0 && ms<=253402214399999 ? new Date(ms+19800000).toISOString().slice(0,10) : "";
}
export function auditTime(ms: number): string {
  return auditDay(ms) ? new Date(ms).toLocaleString("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"medium"}) : "Not recorded";
}
export function normalizeAudit(path: string, data: Record<string,unknown>, time: number) {
  const scope=auditSource(path);
  if (!scope || !auditDay(time)) return null;
  const raw=typeof data.action==="string" ? data.action : "";
  const known=Object.prototype.hasOwnProperty.call(actions,raw);
  const action=known?raw:"Unknown action";
  const subscriptionUpdate=scope.source==="Organization" && raw==="org.updated_by_admin" && !!auditIdentifier(data.previousPlan) && !!auditIdentifier(data.nextPlan);
  const category: AuditCategory=subscriptionUpdate?"Subscription":known?actions[raw]:"Other";
  const label=subscriptionUpdate?"Subscription updated":known?labels[raw]||action:"Unknown action";
  const orgId=scope.orgId || (!(["planManagement","settingsManagement"].includes(scope.source)) ? auditIdentifier(data.orgId):"");
  const target=scope.source==="planManagement"?auditIdentifier(data.planId):scope.source==="userManagement"?auditIdentifier(data.uid):scope.source==="leadManagement"?auditIdentifier(data.leadId):"";
  const invoice=typeof data.number==="string" && /^[A-Za-z0-9/_-]{1,60}$/.test(data.number) && (category==="Billing" || raw==="subscription.renewed") ? data.number : "";
  return {key:path,id:scope.id,source:scope.source,orgId,target,action,label,category,actor:auditIdentifier(data.by),time,invoice};
}
export type AuditRow = NonNullable<ReturnType<typeof normalizeAudit>>;
export function filterAudit(rows: AuditRow[], query: string, category: string, from: string, to: string) {
  const q=query.trim().toLowerCase();
  return rows.filter(r => (category==="all"||r.category===category) && (!from||auditDay(r.time)>=from) && (!to||auditDay(r.time)<=to) && [r.actor,r.orgId,r.target,r.id,r.action,r.label,r.source,r.invoice].some(v=>v.toLowerCase().includes(q)));
}
export function validAuditBoundary(value: unknown): value is {path:string; seconds:number; nanos:number} {
  if (!value || typeof value!=="object") return false;
  const v=value as Record<string,unknown>;
  return typeof v.path==="string" && !!auditSource(v.path) && typeof v.seconds==="number" && Number.isSafeInteger(v.seconds) && v.seconds>=0 && v.seconds<=253402214399 && typeof v.nanos==="number" && Number.isInteger(v.nanos) && v.nanos>=0 && v.nanos<1000000000;
}
