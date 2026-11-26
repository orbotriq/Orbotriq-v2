import { workspaceAccess } from "@/lib/admin/platform-access";
import { WorkspaceRestricted } from "@/components/workspace-restricted";
export const dynamic="force-dynamic";
import { AppShell } from "@/components/app-shell";
export const metadata={title:"Projects & Tasks"};
export default async function ProjectsPage(){const decision=await workspaceAccess("projects");if(decision.kind!=="allowed")return <WorkspaceRestricted decision={decision}/>;return <AppShell><div className="content"><div className="eyebrow">Agency workspace</div><h1>Projects & Tasks</h1><p className="sub">Project milestones, assignments, approvals and delivery tracking.</p><div className="card" style={{marginTop:24}}>Project management foundation <span className="pill" style={{marginLeft:10}}>Planned</span></div></div></AppShell>}
