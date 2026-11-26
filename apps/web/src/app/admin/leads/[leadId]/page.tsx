import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getLead } from "@/lib/admin/leads";
import { leadDate, LEAD_STATUS_LABELS } from "@/lib/admin/lead-view";
import { isAdminWriteEnabled } from "@/lib/admin/write-guard";
import { testEmail } from "@/lib/admin/lead-validation";
import { getLeadActivity } from "@/lib/admin/lead-activity";
import { followUpStatus } from "@/lib/admin/lead-followup";
import { LeadActivityForm } from "@/components/lead-activity-form";
import { LeadConvertForm } from "@/components/lead-convert-form";
import { eligibleConversionStatus } from "@/lib/admin/lead-conversion-view";
export const dynamic = "force-dynamic";
export const metadata = { title: "Lead details" };
export default async function LeadDetails({params}: {params: Promise<{leadId: string}>}) {
  const {leadId} = await params;
  const lead = await getLead(leadId);
  if (!lead) notFound();
  const activity = await getLeadActivity(lead.id);
  const fields = [["Company", lead.company], ["Email", lead.email], ["Phone", lead.phone], ["Source", lead.source], ["Service interest", lead.serviceInterest], ["Status", LEAD_STATUS_LABELS[lead.status]], ["Received (IST)", leadDate(lead.createdAt)], ["Lead ID", lead.id], ["Follow-up (IST)", leadDate(lead.followUpAt)], ["Follow-up status", followUpStatus(lead.followUpAt, Date.now())]];
  return <AppShell><Link className="org-back" href="/admin/leads">Back to leads</Link><div className="eyebrow">Lead details</div><h1>{lead.name}</h1>
    {isAdminWriteEnabled() && testEmail(lead.email) && lead.conversion.state === "none" && <Link className="btn primary" href={`/admin/leads/${encodeURIComponent(lead.id)}/edit`}>Edit test lead</Link>}
    <section className="card" style={{marginTop: 20}}><h2>Contact and enquiry</h2><dl>{fields.map(([label, value]) => <div className="org-detail-row" key={label}><dt>{label}</dt><dd style={{overflowWrap: "anywhere"}}>{value || "Not recorded"}</dd></div>)}</dl>
      <h2>Message</h2><p style={{whiteSpace: "pre-wrap", overflowWrap: "anywhere"}}>{lead.message || "No message recorded."}</p>
    </section>
    {lead.conversion.state === "complete" && lead.conversion.orgId && <section className="card"><h2>Converted organization</h2><Link href={`/admin/organizations/${encodeURIComponent(lead.conversion.orgId)}`}>View organization</Link></section>}
    {(lead.conversion.state === "pending" || lead.conversion.state === "review") && <section className="card"><h2>Conversion requires review</h2><p>Provisioning may be incomplete. Do not retry or remove records. Organization reference: {lead.conversion.orgId || "Unknown"}</p></section>}
    {isAdminWriteEnabled() && testEmail(lead.email) && lead.conversion.state === "none" && eligibleConversionStatus(lead.status) && <LeadConvertForm key={`convert-${lead.version}`} id={lead.id} version={lead.version} name={lead.company || lead.name} email={lead.email}/>}
    {isAdminWriteEnabled() && testEmail(lead.email) && (lead.conversion.state === "none" || lead.conversion.state === "complete") && <LeadActivityForm key={`activity-${lead.version}`} id={lead.id} version={lead.version} followUpAt={lead.followUpAt}/>}
    <section className="card" style={{marginTop:20}}><h2>Activity timeline</h2><p className="sub">Internal records in reverse chronological order (IST). {activity.limited && "History is limited to 100 displayed events from up to 200 matched records; older or other events may be omitted."}</p>
    {!activity.events.length && <p className="sub">No activity recorded.</p>}
    {activity.events.map(event => <div key={event.id} style={{borderTop:"1px solid var(--line, #24334b)",padding:"14px 0",overflowWrap:"anywhere"}}>
      <strong>{event.action === "lead.activity_recorded" ? `Activity: ${event.kind}` : event.action === "lead.followup_changed" ? "Follow-up changed" : event.action === "lead.created" ? "Lead created" : event.action === "lead.updated" ? "Lead updated" : event.action || "Unknown event"}</strong>
      <p className="sub">{leadDate(event.at)} · {event.by || "Unknown administrator"}</p>
      {event.action === "lead.followup_changed" && <p>{leadDate(event.previousFollowUp)} → {leadDate(event.nextFollowUp)}</p>}
      {event.action === "lead.updated" && <p>{event.fields.join(", ")}{event.previousStatus !== event.nextStatus && ` · Status: ${event.previousStatus || "Not recorded"} → ${event.nextStatus || "Not recorded"}`}</p>}
      {event.note && <p style={{whiteSpace:"pre-wrap"}}>{event.note}</p>}
    </div>)}
    </section>
  </AppShell>;
}
