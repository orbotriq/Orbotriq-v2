"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { BUSINESS_LIMITS, type BusinessFields } from "@/lib/admin/platform-business-view";
const labels={displayName:"Display name",legalName:"Legal name (optional)",supportEmail:"Support email (.test, optional)",website:"Website (HTTPS .test, optional)"};
export function PlatformBusinessForm({business,version}:{business:BusinessFields;version:string}) {
  const router=useRouter(),lock=useRef(false);
  const [fields,setFields]=useState(business),[busy,setBusy]=useState(false),[blocked,setBlocked]=useState(false),[message,setMessage]=useState("");
  async function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault(); if(lock.current||blocked)return;
    lock.current=true;setBusy(true);setMessage("");
    try {
      const r=await fetch("/api/admin/settings",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({business:fields,version})});
      const result=await r.json();
      if(!r.ok){setMessage(result.error||"Settings could not be saved.");if(r.status===409||r.status>=500)setBlocked(true);return;}
      if(result.changed){setMessage("Saved. Refreshing settings…");setBlocked(true);router.refresh();}
      else setMessage("No changes to save.");
    } catch {setMessage("Save outcome uncertain. Reload before retrying.");setBlocked(true);}
    finally {lock.current=false;setBusy(false);}
  }
  return <form className="org-create-form" onSubmit={submit}><fieldset className="card" disabled={busy||blocked}>
    <h2>Business information</h2><p className="sub">Test configuration only. Use fictional contact details. This does not change live branding, invoices, or customer communications.</p>
    {(Object.keys(BUSINESS_LIMITS) as (keyof BusinessFields)[]).map(k=><label key={k}>{labels[k]}<input type={k==="supportEmail"?"email":k==="website"?"url":"text"} required={k==="displayName"} maxLength={BUSINESS_LIMITS[k]} value={fields[k]} onChange={e=>setFields(prev=>({...prev,[k]:e.target.value}))}/></label>)}
    <div className="org-form-actions"><button type="submit" className="btn primary">{busy?"Saving…":"Save business settings"}</button><button type="button" className="btn" onClick={()=>{setFields(business);setMessage("");}}>Reset form</button></div>
  </fieldset>{message&&<p role="status">{message}</p>}{blocked&&<button type="button" className="btn" onClick={()=>window.location.reload()}>Reload settings</button>}</form>;
}
