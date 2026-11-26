import { workspaceAccess } from "@/lib/admin/platform-access";
import { WorkspaceRestricted } from "@/components/workspace-restricted";
export const dynamic="force-dynamic";
import { AppShell } from "@/components/app-shell";
export const metadata={title:"Clients & CRM"};
export default async function ClientsPage(){const decision=await workspaceAccess("clients");if(decision.kind!=="allowed")return <WorkspaceRestricted decision={decision}/>;return <AppShell workspaceRole={decision.identity.role}><div className="content"><div className="eyebrow">Agency workspace</div><h1>Clients & CRM</h1><p className="sub">Client directory, leads, onboarding and follow-up workflows will be implemented in this module.</p><div className="card" style={{marginTop:24}}>CRM foundation <span className="pill" style={{marginLeft:10}}>Planned</span><p className="sub">No client records are displayed until tenant-safe Firestore queries are connected.</p></div></div></AppShell>}
