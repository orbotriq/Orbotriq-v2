import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
const names: Record<string,string> = {
  brands:"Brand management", social:"Social media & publishing", ads:"Advertising",
  seo:"SEO & Analytics", geo:"GEO · AI Search", competitors:"Competitor intelligence",
  copilot:"Growth Copilot", alerts:"Smart alerts", reports:"Reports",
  billing:"Billing & subscriptions", settings:"Workspace settings"
};
export function generateMetadata({params}:{params:Promise<{module:string}>}) { return params.then(({module})=>({title:names[module] ?? "Dashboard"})); }
export default async function ModulePage({params}:{params:Promise<{module:string}>}) {
  const {module}=await params; const name=names[module]; if(!name) notFound();
  return <AppShell active={`/dashboard/${module}`}><div className="content"><div className="eyebrow">Orbotriq workspace</div><h1>{name}</h1><p className="sub">Module migration placeholder. Existing v1 capabilities will be connected here after service and permission audits.</p><div className="card" style={{marginTop:24}}><strong>Implementation status</strong><p className="sub">UI route scaffold created. No production data or external integration is simulated.</p><span className="pill">Ready for module migration</span></div></div></AppShell>;
}
