import { workspaceAccess } from "@/lib/admin/platform-access";
import { WorkspaceRestricted } from "@/components/workspace-restricted";
export const dynamic="force-dynamic";
import { MODULE_LABELS,moduleKey } from "@/lib/admin/platform-access-view";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
export function generateMetadata({params}:{params:Promise<{module:string}>}) { return params.then(({module})=>({title:moduleKey(module)&&module!=="clients"&&module!=="projects"?MODULE_LABELS[module]:"Dashboard"})); }
export default async function ModulePage({params}:{params:Promise<{module:string}>}) {
  const {module}=await params; if(!moduleKey(module)||module==="clients"||module==="projects") notFound();
  const name=MODULE_LABELS[module];const decision=await workspaceAccess(module);if(decision.kind!=="allowed")return <WorkspaceRestricted decision={decision}/>;
  return <AppShell active={`/dashboard/${module}`}><div className="content"><div className="eyebrow">Orbotriq workspace</div><h1>{name}</h1><p className="sub">Module migration placeholder. Existing v1 capabilities will be connected here after service and permission audits.</p><div className="card" style={{marginTop:24}}><strong>Implementation status</strong><p className="sub">UI route scaffold created. No production data or external integration is simulated.</p><span className="pill">Ready for module migration</span></div></div></AppShell>;
}
