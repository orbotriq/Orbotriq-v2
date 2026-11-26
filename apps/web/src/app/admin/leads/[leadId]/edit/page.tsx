import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { LeadForm } from "@/components/lead-form";
import { getLead } from "@/lib/admin/leads";
import { isAdminWriteEnabled } from "@/lib/admin/write-guard";
import { testEmail } from "@/lib/admin/lead-validation";
export const dynamic = "force-dynamic";
export default async function EditLeadPage({params}: {params: Promise<{leadId:string}>}) {
  const lead = await getLead((await params).leadId);
  if (!lead || !isAdminWriteEnabled() || !testEmail(lead.email) || lead.conversion.state !== "none") notFound();
  return <AppShell><Link className="org-back" href={`/admin/leads/${encodeURIComponent(lead.id)}`}>Back to lead</Link><h1>Edit test lead</h1><LeadForm edit={lead}/></AppShell>;
}
