import { AppShell } from "@/components/app-shell";
import { Activity, ArrowUpRight, BarChart3, Globe2, Search, Users } from "lucide-react";

const metrics = [
  { label: "Tracked brands", value: "—", note: "Connect your first brand", icon: Globe2 },
  { label: "SEO health", value: "—", note: "Run an audit to get started", icon: Search },
  { label: "AI visibility", value: "—", note: "Run a GEO check to get started", icon: Activity },
  { label: "Active clients", value: "—", note: "CRM setup pending", icon: Users },
];
const modules = ["SEO & Analytics","GEO · AI Search","Social Publishing","Meta Ads","Competitor Intelligence","Growth Copilot","Client CRM","Projects & Tasks"];
export default function DashboardPage() {
  return <AppShell><div className="content">
    <div className="eyebrow">Workspace overview</div><h1>Your growth, connected.</h1>
    <p className="sub">Welcome to Orbotriq v2. Connect your existing Firebase data sources to activate live metrics.</p>
    <div className="grid-cards">{metrics.map(({label,value,note,icon:Icon})=><div className="card" key={label}><Icon size={19} color="#39c6d8"/><div className="metric">{value}</div><div style={{fontWeight:650,fontSize:13}}>{label}</div><div className="metric-label" style={{marginTop:7}}>{note}</div></div>)}</div>
    <div className="section-grid">
      <section className="card"><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><strong>Platform modules</strong><span className="pill">v2 foundation</span></div><p className="sub">The application shell is ready; module migrations are staged for implementation.</p><div className="module-list">{modules.map(m=><div className="module" key={m}>{m}<ArrowUpRight size={14} style={{float:"right",color:"#39c6d8"}}/></div>)}</div></section>
      <section className="card"><strong>Next setup steps</strong><p className="sub">Before enabling production data:</p>{["Add Firebase web app environment values","Configure server-side Firebase Admin credentials","Verify existing Firestore tenant claims","Connect the legacy Cloud Functions","Run staging security and data migration tests"].map((s,i)=><div key={s} style={{display:"flex",gap:10,padding:"13px 0",borderBottom:"1px solid #24334b",fontSize:12,color:"#c7d4e7"}}><span style={{color:"#39c6d8"}}>0{i+1}</span>{s}</div>)}</section>
    </div>
  </div></AppShell>;
}
