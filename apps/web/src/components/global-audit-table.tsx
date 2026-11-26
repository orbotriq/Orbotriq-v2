"use client";
import { useState } from "react";
import Link from "next/link";
import { AUDIT_CATEGORIES, auditTime, filterAudit, type AuditRow } from "@/lib/admin/global-audit-view";
import { auditCsv } from "@/lib/admin/global-audit-csv";
export function GlobalAuditTable({rows}:{rows:AuditRow[]}) {
  const [query,setQuery]=useState("");
  const [category,setCategory]=useState("all");
  const [from,setFrom]=useState("");
  const [to,setTo]=useState("");
  const [exportError,setExportError]=useState("");
  const [selected,setSelected]=useState<string|null>(null);
  const invalid=!!from&&!!to&&from>to;
  const filtered=invalid?[]:filterAudit(rows,query,category,from,to);
  const detail=filtered.find(r=>r.key===selected);
  function download() {
    if (!filtered.length || invalid) return;
    setExportError("");
    let url: string | undefined;
    let anchor: HTMLAnchorElement | undefined;
    try {
      url=URL.createObjectURL(new Blob([auditCsv(filtered)],{type:"text/csv;charset=utf-8"}));
      anchor=document.createElement("a"); anchor.href=url; anchor.download=`orbotriq-audit-${new Date().toISOString().slice(0,10)}.csv`;
      document.body.appendChild(anchor); anchor.click();
    } catch { setExportError("CSV export failed. Please try again."); }
    finally { anchor?.remove(); if(url){const objectUrl=url; window.setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);} }
  }
  const stats=[["Loaded events",rows.length],["Billing",rows.filter(r=>r.category==="Billing").length],["User",rows.filter(r=>r.category==="User").length],["Lead",rows.filter(r=>r.category==="Lead").length]] as const;
  return <>
    <div className="admin-stats-grid">{stats.map(([label,count])=><div key={label} className="admin-stat-card"><div className="admin-stat-label">{label}</div><div className="admin-stat-value">{count}</div></div>)}</div>
    <section className="card" style={{marginTop:20}}>
      <div className="org-toolbar"><input className="org-search" aria-label="Search audit events" placeholder="Search actor, action or record ID…" value={query} onChange={e=>setQuery(e.target.value)}/>
        <select aria-label="Audit category" value={category} onChange={e=>setCategory(e.target.value)}><option value="all">All categories</option>{AUDIT_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select>
        <label>From (IST) <input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>To (IST) <input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
        <button type="button" className="btn" onClick={()=>{setQuery("");setCategory("all");setFrom("");setTo("");setSelected(null);}}>Reset filters</button>
        <button type="button" className="btn" disabled={invalid||!filtered.length} onClick={download}>Export filtered CSV</button></div>
      {exportError&&<p role="alert">{exportError}</p>}
      {invalid&&<p role="alert">Start date must not be after end date.</p>}
      <p className="sub">Showing {filtered.length} of {rows.length} loaded events. Search, date filters, counts and CSV export apply to this page only. CSV uses UTC timestamps.</p>
      <div className="org-table-scroll"><table className="org-table"><thead><tr><th>Time (IST)</th><th>Action</th><th>Category</th><th>Actor ID</th><th>Organization ID</th><th>Details</th></tr></thead><tbody>{filtered.map(r=><tr key={r.key}><td>{auditTime(r.time)}</td><td>{r.label}<div className="sub">{r.action}</div></td><td>{r.category}</td><td>{r.actor||"—"}</td><td>{r.orgId?<Link href={`/admin/organizations/${encodeURIComponent(r.orgId)}`}>{r.orgId}</Link>:"—"}</td><td><button type="button" className="btn" onClick={()=>setSelected(r.key)}>View</button></td></tr>)}</tbody></table></div>
      {!filtered.length&&<p className="sub">{rows.length?"No events match these filters.":"No audit events on this page."}</p>}
    </section>
    {detail&&<section className="card" style={{marginTop:20,overflowWrap:"anywhere"}}><div className="org-toolbar"><h2>Event details</h2><button type="button" className="btn" onClick={()=>setSelected(null)}>Close</button></div>
      <p>Event ID: {detail.id}</p><p>Source: {detail.source}</p><p>Event: {detail.label}</p><p>Action: {detail.action}</p><p>Category: {detail.category}</p><p>Recorded: {auditTime(detail.time)} IST</p><p>Actor ID: {detail.actor||"Not recorded"}</p><p>Organization ID: {detail.orgId||"Not applicable"}</p><p>Target ID: {detail.target||"Not applicable"}</p>{detail.invoice&&<p>Invoice: {detail.invoice}</p>}
      <p className="sub">Only allowlisted metadata is displayed. Notes, reasons, credentials and raw payloads are not exposed.</p></section>}
  </>;
}
