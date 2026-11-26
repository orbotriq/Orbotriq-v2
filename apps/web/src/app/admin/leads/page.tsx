import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { LeadDirectory } from "@/components/lead-directory";
import { listLeads } from "@/lib/admin/leads";
import { isAdminWriteEnabled } from "@/lib/admin/write-guard";
export const dynamic = "force-dynamic";
export const metadata = { title: "Leads" };
export default async function LeadsPage({searchParams}: {searchParams: Promise<{cursor?: string}>}) {
  const {cursor} = await searchParams;
  const result = await listLeads(typeof cursor === "string" ? cursor : undefined);
  return <AppShell><div className="eyebrow">Platform administration</div><h1>Leads</h1>
    <p className="sub">Customer enquiries and opportunities. Directory; 25 records per page in document-ID order. Counts, search and filters apply to the loaded page only.</p>
    {isAdminWriteEnabled() && <div className="org-toolbar" style={{marginBottom:16}}><Link className="btn primary" href="/admin/leads/create">Create test lead</Link></div>}
    <LeadDirectory key={typeof cursor === "string" ? cursor : "first"} rows={result.rows} now={Date.now()} />
    <div className="org-toolbar" style={{marginTop: 16}}><Link href="/admin/leads">First page</Link>{result.next && <Link href={`/admin/leads?cursor=${encodeURIComponent(result.next)}`}>Next page</Link>}</div>
  </AppShell>;
}
