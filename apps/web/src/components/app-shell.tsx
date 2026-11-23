import Link from "next/link";
import { Activity, BarChart3, Bot, Building2, CalendarDays, ChartNoAxesCombined, CircleDollarSign, FileText, FolderKanban, Gauge, Globe2, LayoutDashboard, Megaphone, Settings, ShieldCheck, Users } from "lucide-react";

const groups = [
  { title: "Workspace", items: [
    ["Overview", "/dashboard", LayoutDashboard], ["Brands", "/dashboard/brands", Building2],
    ["Social & Publishing", "/dashboard/social", CalendarDays], ["Ads", "/dashboard/ads", Megaphone],
  ]},
  { title: "Intelligence", items: [
    ["SEO & Analytics", "/dashboard/seo", ChartNoAxesCombined], ["GEO · AI Search", "/dashboard/geo", Globe2],
    ["Competitors", "/dashboard/competitors", BarChart3], ["Growth Copilot", "/dashboard/copilot", Bot],
    ["Alerts", "/dashboard/alerts", Activity], ["Reports", "/dashboard/reports", FileText],
  ]},
  { title: "Agency", items: [
    ["Clients & CRM", "/agency/clients", Users], ["Projects & Tasks", "/agency/projects", FolderKanban],
    ["Billing", "/dashboard/billing", CircleDollarSign],
  ]},
  { title: "Platform", items: [["Settings", "/dashboard/settings", Settings], ["Super Admin", "/admin", ShieldCheck]]},
];

export function AppShell({ children, active = "/dashboard" }: { children: React.ReactNode; active?: string }) {
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand">ORB<span>O</span>TRIQ</div>
      {groups.map(group => <div key={group.title}>
        <div className="nav-label">{group.title}</div>
        {group.items.map(([label, href, Icon]) => {
          const I = Icon as typeof Gauge;
          return <Link className={`nav-link ${active === href ? "active" : ""}`} href={href as string} key={href as string}><I size={17}/>{label as string}</Link>;
        })}
      </div>)}
      <div style={{marginTop:32,padding:"12px",color:"#71829d",fontSize:11}}>ORBOTRIQ V2 · FOUNDATION</div>
    </aside>
    <main className="main">
      <header className="topbar"><div style={{fontSize:13,color:"#91a0b8"}}>Workspace / <strong style={{color:"#eef4ff"}}>Overview</strong></div><div style={{display:"flex",gap:18,alignItems:"center",fontSize:12,color:"#aab8cc"}}><span>All brands</span><span>●</span><strong>Account</strong></div></header>
      {children}
    </main>
  </div>;
}
