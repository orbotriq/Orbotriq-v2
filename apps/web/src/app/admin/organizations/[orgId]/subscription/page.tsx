import Link from "next/link";
import {notFound} from "next/navigation";
import {AppShell} from "@/components/app-shell";
import {SubscriptionForm} from "@/components/subscription-form";
import {getSubscription} from "@/lib/admin/subscription";
import {isAdminWriteEnabled} from "@/lib/admin/write-guard";
export const dynamic="force-dynamic";
export default async function Page({params}:{params:Promise<{orgId:string}>}){
 const {orgId}=await params; const s=await getSubscription(orgId); if(!s)notFound();
 const rows=[["Brands",s.brands,s.brandLimit],["Monthly GEO",s.geo,s.geoLimit]] as const;
 return <AppShell><Link className="org-back" href={`/admin/organizations/${encodeURIComponent(orgId)}`}>Back to organization</Link><h1>{s.name} — Subscription</h1><p className="sub">{s.plan} / {s.status} · UTC quota month {s.month}</p><section className="card" style={{marginTop:24}}><h2>Usage and quotas</h2>{rows.map(([label,used,limit])=><div key={label} style={{marginTop:16}}><strong>{label}: {used??"Unknown"} / {limit??"Unknown"}</strong>{used!==null&&limit!==null&&<><progress aria-label={label} value={Math.min(used,limit)} max={limit||1}/><p className="sub">{Math.max(0,limit-used)} remaining{used>limit?" — over allowance":""}</p></>}</div>)}<p>Expiry: {s.expiry?new Date(s.expiry).toLocaleString("en-IN",{timeZone:"Asia/Kolkata"}):"Unknown"}</p></section>{isAdminWriteEnabled()&&s.eligible&&s.plan!=="trial"&&s.status!=="trialing"?<SubscriptionForm orgId={s.id} current={s.plan} version={s.version} options={s.options}/>:<p className="sub">Read-only. Trial conversion, demo and activation are not supported here.</p>}</AppShell>;
}
