"use client";
import {useRouter} from "next/navigation";
import {useRef,useState,type FormEvent} from "react";
import {MODULE_KEYS,MODULE_LABELS,type AccessFields} from "@/lib/admin/platform-access-view";
export function PlatformAccessForm({access,version}:{access:AccessFields;version:string}){
 const router=useRouter(),lock=useRef(false);const [f,setF]=useState(access),[busy,setBusy]=useState(false),[blocked,setBlocked]=useState(false),[message,setMessage]=useState("");
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();if(lock.current||blocked)return;lock.current=true;setBusy(true);setMessage("");try{const r=await fetch("/api/admin/settings/access",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({access:f,version})});const result=await r.json();if(!r.ok){setMessage(result.error||"Save failed.");if(r.status===409||r.status>=500)setBlocked(true);return;}if(result.changed){setBlocked(true);setMessage("Saved. Refreshing…");router.refresh();}else setMessage("No changes to save.");}catch{setBlocked(true);setMessage("Save outcome uncertain. Reload before retrying.");}finally{lock.current=false;setBusy(false);}}
 return <form className="org-create-form" onSubmit={submit}><fieldset className="card" disabled={busy||blocked}><h2>Feature flags and maintenance mode</h2><p className="sub">Controls the test workspace pages, including administrator workspace preview. The administration console, login, logout and payment settlement remain available. These switches do not activate unimplemented modules or affect the legacy website.</p>
 <label><input type="checkbox" checked={f.maintenance} onChange={e=>setF(old=>({...old,maintenance:e.target.checked}))}/> Enable workspace maintenance</label>
 <label>Maintenance message<input required maxLength={240} value={f.message} onChange={e=>setF(old=>({...old,message:e.target.value}))}/></label>
 <h3>Workspace module availability</h3><p className="sub">Disabled modules show a restricted page on a fresh server request. Maintenance takes priority over individual flags.</p>
 {MODULE_KEYS.map(k=><label key={k}><input type="checkbox" checked={f.modules[k]} onChange={e=>setF(old=>({...old,modules:{...old.modules,[k]:e.target.checked}}))}/> {MODULE_LABELS[k]}</label>)}
 <div className="org-form-actions"><button className="btn primary" type="submit">{busy?"Saving…":"Save access settings"}</button><button className="btn" type="button" onClick={()=>{setF(access);setMessage("");}}>Reset form</button></div></fieldset>{message&&<p role="status">{message}</p>}{blocked&&<button className="btn" type="button" onClick={()=>window.location.reload()}>Reload settings</button>}</form>;
}
