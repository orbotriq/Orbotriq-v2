"use client";
import { useState } from "react";
import Link from "next/link";
type Row={uid:string;email:string;name:string;disabled:boolean;verified:boolean;platformAdmin:boolean;orgId:string;role:string};
export function UserDirectory({users}:{users:Row[]}) {
 const [q,setQ]=useState(""); const [status,setStatus]=useState("all");
 const rows=users.filter(u=>`${u.email} ${u.name} ${u.uid} ${u.orgId} ${u.role}`.toLowerCase().includes(q.toLowerCase()) && (status==="all" || u.disabled===(status==="disabled")));
 return <div className="card"><div className="org-toolbar"><input className="org-search" aria-label="Search current page" placeholder="Search current page" value={q} onChange={e=>setQ(e.target.value)}/><select aria-label="Account status" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All accounts</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></div><div className="org-table-scroll"><table className="org-table"><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Status</th><th>Verified</th></tr></thead><tbody>{rows.map(u=><tr key={u.uid}><td><Link href={`/admin/users/${encodeURIComponent(u.uid)}`}>{u.email}</Link></td><td>{u.name}</td><td>{u.platformAdmin?"Platform administrator":u.role}</td><td>{u.disabled?"Disabled":"Enabled"}</td><td>{u.verified?"Yes":"No"}</td></tr>)}</tbody></table></div>{!rows.length&&<p>No matching accounts.</p>}</div>;
}
