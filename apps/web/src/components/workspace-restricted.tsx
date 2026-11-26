import Link from "next/link";
import {AppShell} from "@/components/app-shell";
import type {AccessDecision} from "@/lib/admin/platform-access-view";
export function WorkspaceRestricted({decision}:{decision:Exclude<AccessDecision,{kind:"allowed"}>}){
 return <AppShell><div className="content"><section className="card" role="status"><div className="eyebrow">Workspace access</div><h1>{decision.kind==="maintenance"?"Workspace maintenance":decision.kind==="disabled"?"Module disabled":"Workspace unavailable"}</h1><p className="sub">{decision.message}</p><p className="sub">Refresh after the administrator restores availability.</p><Link href="/admin">Platform administration</Link></section></div></AppShell>;
}
