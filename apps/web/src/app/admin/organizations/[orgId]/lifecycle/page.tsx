import Link from "next/link";
import {notFound} from "next/navigation";
import {AppShell} from "@/components/app-shell";
import {LifecycleForm} from "@/components/lifecycle-form";
import {getLifecycle} from "@/lib/admin/lifecycle";
import {isAdminWriteEnabled} from "@/lib/admin/write-guard";
export const dynamic="force-dynamic";
export default async function Page({params}:{params:Promise<{orgId:string}>}){
 const {orgId}=await params;const s=await getLifecycle(orgId);if(!s)notFound();
 const actions=s.demo?(s.status==="demo"?["extend-demo","expire-demo"]:s.status==="expired"?["extend-demo"]:[]):["active","trialing"].includes(s.status)?["suspend"]:s.status==="suspended"?["reactivate"]:[];
 return <AppShell><Link className="org-back" href={`/admin/organizations/${encodeURIComponent(orgId)}`}>Back to organization</Link><h1>{s.name} — Lifecycle</h1><p>Status: {s.status} · Expiry: {s.expiry??"Unknown"}</p><p className="sub">Emulator status management only. Does not revoke authentication or enforce customer access.</p>{isAdminWriteEnabled()&&actions.length>0?<LifecycleForm id={orgId} version={s.version} actions={actions}/>:<p>No eligible actions.</p>}</AppShell>;
}
