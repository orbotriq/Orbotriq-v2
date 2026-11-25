"use client";
import {useState,useRef} from "react";
import {useRouter} from "next/navigation";
export function UserProvisionForm(){
 const router=useRouter(),lock=useRef(false);const [busy,setBusy]=useState(false),[error,setError]=useState("");
 return <form className="org-create-form" onSubmit={async e=>{e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError("");const data=Object.fromEntries(new FormData(e.currentTarget));try{const r=await fetch("/api/admin/users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});const result=await r.json();if(!r.ok){setError(result.error||"Request failed");if(r.status<500){lock.current=false;setBusy(false);}return;}router.push(`/admin/users/${encodeURIComponent(result.uid)}`);router.refresh();}catch{setError("Outcome uncertain. Review user directory before retrying.");}}}>
 <fieldset disabled={busy}><label>Organization ID<input name="orgId" required maxLength={128}/></label><label>Name<input name="name" required minLength={2} maxLength={80}/></label><label>Test email<input name="email" type="email" required placeholder="staff@example.test"/></label><label>Role<select name="role"><option value="viewer">Viewer</option><option value="staff">Staff</option><option value="admin">Admin</option></select></label><label>Reason<textarea name="reason" required minLength={3} maxLength={300}/></label><button type="submit">Create test account</button></fieldset>{error&&<p role="alert">{error}</p>}</form>;
}
