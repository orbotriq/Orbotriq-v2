"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ACTIVITY_TYPES, followUpInput, type ActivityType } from "@/lib/admin/lead-followup";
export function LeadActivityForm({id, version, followUpAt}: {id: string; version: string; followUpAt: number | null}) {
  const router = useRouter(), lock = useRef(false);
  const [date,setDate] = useState(followUpInput(followUpAt));
  const [kind,setKind] = useState<ActivityType>("note"), [note,setNote] = useState("");
  const [busy,setBusy] = useState(false), [blocked,setBlocked] = useState(false), [message,setMessage] = useState("");
  async function save(input: object) {
    if (lock.current || blocked) return;
    lock.current = true; setBusy(true); setMessage("");
    try {
      const r = await fetch(`/api/admin/leads/${encodeURIComponent(id)}/activity`, {method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({...input,version})});
      const result = await r.json();
      if (!r.ok) {setMessage(result.error || "Unable to save activity."); if (r.status === 409 || r.status >= 500) setBlocked(true); return;}
      setMessage(result.changed ? "Saved. Reloading lead…" : "No changes needed.");
      if (result.changed) {setBlocked(true); router.refresh();}
    } catch {setMessage("Outcome uncertain. Reload and check the activity timeline before retrying.");setBlocked(true);}
    finally {lock.current = false;setBusy(false);}
  }
  function schedule(e: FormEvent<HTMLFormElement>) {e.preventDefault(); if(date) void save({action:"schedule",followUp:date});}
  function record(e: FormEvent<HTMLFormElement>) {e.preventDefault();void save({action:"record",kind,note});}
  return <div style={{marginTop:20}}>
    <form className="org-create-form" onSubmit={schedule}><fieldset className="card" disabled={busy||blocked}><h2>Schedule follow-up</h2><p className="sub">All dates and times are India Standard Time (IST). This is a record, not a reminder or message delivery service.</p><label>Follow-up date and time (IST)<input type="datetime-local" required min="2000-01-01T00:00" max="2099-12-31T23:59" value={date} onChange={e=>setDate(e.target.value)}/></label><div className="org-form-actions"><button className="btn primary" type="submit">Save follow-up</button>{followUpAt!==null && <button className="btn" type="button" onClick={()=>void save({action:"schedule",followUp:null})}>Clear follow-up</button>}</div></fieldset></form>
    <form className="org-create-form" onSubmit={record}><fieldset className="card" disabled={busy||blocked}><h2>Record activity / internal note</h2><p className="sub">Log fictional activity only. No call, email, SMS or meeting invitation is sent.</p><label>Type<select value={kind} onChange={e=>setKind(e.target.value as ActivityType)}>{ACTIVITY_TYPES.map(k=><option key={k} value={k}>{k}</option>)}</select></label><label>Internal note<textarea required maxLength={2000} rows={4} value={note} onChange={e=>setNote(e.target.value)}/></label><button className="btn primary" type="submit">Record activity</button></fieldset></form>
    {message && <p role="status" style={{overflowWrap:"anywhere"}}>{message}</p>}{blocked && <button type="button" className="btn" onClick={()=>window.location.reload()}>Reload lead</button>}
  </div>;
}
