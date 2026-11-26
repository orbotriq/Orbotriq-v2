"use client";
import { useRouter } from "next/navigation";
import { useRef,useState,type FormEvent } from "react";
import { GST_RATES,type BillingFields } from "@/lib/admin/platform-billing-view";
export function PlatformBillingForm({billing,version}:{billing:BillingFields;version:string}){
 const router=useRouter(),lock=useRef(false);
 const [f,setF]=useState(billing),[busy,setBusy]=useState(false),[blocked,setBlocked]=useState(false),[message,setMessage]=useState("");
 function set<K extends keyof BillingFields>(key:K,value:BillingFields[K]){setF(old=>({...old,[key]:value}));}
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();if(lock.current||blocked)return;lock.current=true;setBusy(true);setMessage("");
 try{const r=await fetch("/api/admin/settings/billing",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({billing:f,version})});const result=await r.json();if(!r.ok){setMessage(result.error||"Save failed.");if(r.status===409||r.status>=500)setBlocked(true);return;}if(result.changed){setBlocked(true);setMessage("Saved. Refreshing…");router.refresh();}else setMessage("No changes to save.");}catch{setBlocked(true);setMessage("Save outcome uncertain. Reload before retrying.");}finally{lock.current=false;setBusy(false);}}
 return <form className="org-create-form" onSubmit={submit}><fieldset className="card" disabled={busy||blocked}><h2>GST and invoice settings</h2><p className="sub">Fictional test settings only. Do not enter a real address or GSTIN. This is not tax-compliance validation. Existing invoices are preserved.</p>
 <label>Fictional seller address<input required minLength={5} maxLength={300} value={f.address} onChange={e=>set("address",e.target.value)}/></label>
 <label>Test state code<input required pattern="[0-9]{2}" maxLength={2} value={f.stateCode} onChange={e=>setF(old=>({...old,stateCode:e.target.value,gstin:""}))}/></label>
 <label><input type="checkbox" checked={f.gstRegistered} onChange={e=>setF(old=>({...old,gstRegistered:e.target.checked,...(!e.target.checked?{gstRate:0,gstin:""}:{})}))}/> Simulate GST-registered seller</label>
 <label>Fictional GSTIN (optional)<input disabled={!f.gstRegistered} maxLength={15} value={f.gstin} onChange={e=>set("gstin",e.target.value)}/></label><p className="sub">Leave blank or use the placeholder {f.stateCode}AAAAA0000A1Z0. Not a valid registration number.</p>
 <label>Test GST rate<select disabled={!f.gstRegistered} value={f.gstRate} onChange={e=>set("gstRate",Number(e.target.value))}>{GST_RATES.map(r=><option key={r} value={r}>{r}%</option>)}</select></label>
 <label>Tax invoice prefix<input required maxLength={5} pattern="TST[A-Z0-9]{0,2}" value={f.taxPrefix} onChange={e=>set("taxPrefix",e.target.value.toUpperCase())}/></label>
 <label>Proforma prefix<input required maxLength={5} pattern="TPR[A-Z0-9]{0,2}" value={f.proformaPrefix} onChange={e=>set("proformaPrefix",e.target.value.toUpperCase())}/></label><p className="sub">Existing financial-year counters continue; changing prefixes does not reset numbering.</p>
 <label>Payment terms (days)<input required type="number" min={0} max={90} step={1} value={Number.isNaN(f.paymentDays)?"":f.paymentDays} onChange={e=>set("paymentDays",e.target.valueAsNumber)}/></label>
 <label>Test invoice footer / terms<input maxLength={500} value={f.terms} onChange={e=>set("terms",e.target.value)}/></label>
 <div className="org-form-actions"><button className="btn primary" type="submit">{busy?"Saving…":"Save billing settings"}</button><button className="btn" type="button" onClick={()=>{setF(billing);setMessage("");}}>Reset billing form</button></div></fieldset>{message&&<p role="status">{message}</p>}{blocked&&<button type="button" className="btn" onClick={()=>window.location.reload()}>Reload settings</button>}</form>;
}
