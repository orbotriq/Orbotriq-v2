"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
export function LeadConvertForm({id,version,name,email}:{id:string;version:string;name:string;email:string}) {
 const router=useRouter(), lock=useRef(false);
 const [org,setOrg]=useState(name.slice(0,80)), [days,setDays]=useState("14"), [confirm,setConfirm]=useState(false), [busy,setBusy]=useState(false), [blocked,setBlocked]=useState(false), [message,setMessage]=useState("");
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault(); if(lock.current||blocked||!confirm)return; lock.current=true;setBusy(true);setMessage("");
  try {const r=await fetch(`/api/admin/leads/${encodeURIComponent(id)}/convert`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:org,trialDays:Number(days),version})});const result=await r.json();
   if(!r.ok){setMessage(result.error||"Conversion failed.");if(r.status===409||r.status>=500)setBlocked(true);return;}
   setBlocked(true);setMessage("Converted. Reloading lead…");router.refresh();
  }catch{setBlocked(true);setMessage("Outcome uncertain. Reload and inspect conversion state. Do not retry blindly.");}finally{lock.current=false;setBusy(false);}
 }
 return <form className="org-create-form" onSubmit={submit}><fieldset className="card" disabled={busy||blocked}><h2>Convert to test organization</h2><p className="sub">Creates a trial organization and owner for {email}. No password or invitation is sent. A completed conversion marks this lead Won and clears its follow-up.</p><label>Organization name<input required minLength={2} maxLength={80} value={org} onChange={e=>setOrg(e.target.value)}/></label><label>Trial days<input type="number" min={1} max={90} step={1} required value={days} onChange={e=>setDays(e.target.value)}/></label><label><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/> Confirm fictional organization provisioning</label><button className="btn primary" type="submit" disabled={!confirm||busy}>Convert lead</button></fieldset>{message&&<p role="status">{message}</p>}{blocked&&<button className="btn" type="button" onClick={()=>window.location.reload()}>Reload lead</button>}</form>;
}
