import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { GlobalAuditTable } from "@/components/global-audit-table";
import { listGlobalAudit } from "@/lib/admin/global-audit";
export const dynamic="force-dynamic";
export const metadata={title:"Global audit logs"};
export default async function AuditPage({searchParams}:{searchParams:Promise<{cursor?:string|string[]}>}) {
  const {cursor}=await searchParams;
  const result=await listGlobalAudit(typeof cursor==="string"?cursor:undefined);
  return <AppShell><div className="eyebrow">Platform administration</div><h1>Global audit logs</h1><p className="sub">Read-only audit metadata across organization, user, plan, billing and lead activity. Latest first; 25 supported events per page, bounded scan of 100 records. Records without a valid timestamp or supported source are omitted.</p>
    {result.notice&&<p role="status" className="sub">{result.notice}</p>}
    <GlobalAuditTable key={typeof cursor==="string"?cursor:"latest"} rows={result.rows}/>
    <div className="org-toolbar" style={{marginTop:16}}><Link href="/admin/audit">Latest page</Link>{result.next&&<Link href={`/admin/audit?cursor=${encodeURIComponent(result.next)}`}>Older events</Link>}</div>
  </AppShell>;
}
