"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { EDITABLE_STATUSES, LEAD_LIMITS, type LeadFields } from "@/lib/admin/lead-validation";
import { LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/admin/lead-view";
type Edit = Omit<LeadFields, "status"> & { id: string; version: string; status: LeadStatus };
export function LeadForm({ edit }: { edit?: Edit }) {
  const router = useRouter(), lock = useRef(false);
  const [fields, setFields] = useState({ name:edit?.name ?? "", company:edit?.company ?? "", email:edit?.email ?? "", phone:edit?.phone ?? "", message:edit?.message ?? "", source:edit?.source ?? "Manual", serviceInterest:edit?.serviceInterest ?? "", status:edit?.status ?? "new" });
  const [busy,setBusy] = useState(false), [blocked,setBlocked] = useState(false), [error,setError] = useState("");
  const target = edit ? `/admin/leads/${encodeURIComponent(edit.id)}` : "/admin/leads";
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (lock.current || blocked) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const r = await fetch(edit ? `/api/admin/leads/${encodeURIComponent(edit.id)}` : "/api/admin/leads", { method:edit ? "PATCH" : "POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(edit ? {...fields,version:edit.version} : fields) });
      const result = await r.json();
      if (!r.ok) { setError(result.error || "Unable to save lead."); if (r.status >= 500 || (edit && r.status === 409 && String(result.error).includes("Reload"))) setBlocked(true); return; }
      router.push(`/admin/leads/${encodeURIComponent(result.leadId)}`); router.refresh();
    } catch { setError("Outcome uncertain. Check the lead directory before retrying."); setBlocked(true); }
    finally { lock.current = false; setBusy(false); }
  }
  return <form className="org-create-form" onSubmit={submit}><fieldset className="card" disabled={busy || blocked}>
    <h2>Lead information</h2><p className="sub">Emulator only. Use fictional names, .test email addresses and fictional phone numbers. No messages or invitations are sent.</p>
    {([['name','Name'],['company','Company'],['email','Email (.test)'],['phone','Phone (optional)'],['source','Source'],['serviceInterest','Service interest']] as const).map(([key,label]) => <label key={key}>{label}<input type={key==='email'?'email':key==='phone'?'tel':'text'} required={key==='name'||key==='email'} maxLength={LEAD_LIMITS[key]} value={fields[key]} onChange={e=>setFields(prev=>({...prev,[key]:e.target.value}))}/></label>)}
    <label>Enquiry message<textarea maxLength={LEAD_LIMITS.message} rows={5} value={fields.message} onChange={e=>setFields(prev=>({...prev,message:e.target.value}))}/></label>
    <label>Status<select required disabled={!edit} value={fields.status} onChange={e=>setFields(prev=>({...prev,status:e.target.value as LeadStatus}))}>{fields.status==='unknown' && <option value="unknown" disabled>Select a valid status</option>}{EDITABLE_STATUSES.map(s=><option value={s} key={s}>{LEAD_STATUS_LABELS[s]}</option>)}</select></label>
    <div className="org-form-actions"><button className="btn primary" type="submit">{busy?'Saving...':edit?'Save changes':'Create lead'}</button><Link href={target}>Cancel</Link></div>
  </fieldset>{error && <p className="org-form-error" role="alert">{error}</p>}{blocked && <Link href={target}>Return to lead record or directory</Link>}</form>;
}
