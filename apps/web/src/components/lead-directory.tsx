"use client";
import Link from "next/link";
import { useState } from "react";
import { filterLeads, leadDate, LEAD_STATUSES, LEAD_STATUS_LABELS, type Lead } from "@/lib/admin/lead-view";
import { followUpStatus } from "@/lib/admin/lead-followup";
import { leadCsv } from "@/lib/admin/lead-csv";
type Row = Omit<Lead, "message"> & { followUpAt: number | null };
export function LeadDirectory({rows, now}: {rows: Row[]; now: number}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [follow,setFollow] = useState("all");
  const matches = new Set(filterLeads(rows.map(row => ({ ...row, message: "" })), query, status).map(r=>r.id));
  const filtered = rows.filter(r=>matches.has(r.id) && (follow === "all" || followUpStatus(r.followUpAt,now) === follow));
  const stats = [["Loaded leads", rows.length], ["New", rows.filter(r => r.status === "new").length],
    ["In progress", rows.filter(r => ["contacted", "qualified", "demo given", "proposal sent"].includes(r.status)).length],
    ["Won", rows.filter(r => r.status === "won").length]] as const;
  const today = rows.filter(r=>followUpStatus(r.followUpAt,now)==="Today").length;
  const overdue = rows.filter(r=>followUpStatus(r.followUpAt,now)==="Overdue").length;
  function exportCsv(){
    const rows = [["Name","Company","Email","Phone","Source","Status","Received (IST)","Follow-up (IST)"], ...filtered.map(r=>[r.name,r.company,r.email,r.phone,r.source,LEAD_STATUS_LABELS[r.status],leadDate(r.createdAt),leadDate(r.followUpAt)])];
    const url=URL.createObjectURL(new Blob([leadCsv(rows)],{type:"text/csv;charset=utf-8"}));
    const link=document.createElement("a");link.href=url;link.download="orbotriq-leads-filtered.csv";document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <>
    <div className="admin-stats-grid">{stats.map(([label, count]) => <div className="admin-stat-card" key={label}><div className="admin-stat-label">{label}</div><div className="admin-stat-value">{count}</div></div>)}</div>
    <div className="card" style={{marginTop: 20}}>
      <p className="sub">Follow-ups on loaded page: {today} today · {overdue} overdue (IST calendar dates; refresh to update).</p>
      <div className="org-toolbar">
        <input className="org-search" aria-label="Search loaded leads" placeholder="Search name, company, email, phone…" value={query} onChange={e => setQuery(e.target.value)} />
        <select aria-label="Lead status" value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option>{LEAD_STATUSES.map(s => <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>)}</select>
        <select aria-label="Follow-up status" value={follow} onChange={e=>setFollow(e.target.value)}><option value="all">All follow-ups</option>{["Today","Overdue","Upcoming","None"].map(f=><option key={f} value={f}>{f}</option>)}</select>
      </div>
      <button type="button" className="btn" disabled={!filtered.length} onClick={exportCsv}>Export filtered page CSV</button>
      <p className="sub">Export contains only displayed contact fields, not notes or messages. Handle customer information securely.</p>
      <p className="sub">Showing {filtered.length} of {rows.length} loaded leads.</p>
      <div className="org-table-scroll"><table className="org-table"><thead><tr><th>Name</th><th>Company</th><th>Email</th><th>Phone</th><th>Source</th><th>Status</th><th>Received (IST)</th><th>Follow-up (IST)</th></tr></thead>
      <tbody>{filtered.map(row => <tr key={row.id}><td><Link href={`/admin/leads/${encodeURIComponent(row.id)}`}>{row.name}</Link></td><td>{row.company || "—"}</td><td>{row.email || "—"}</td><td>{row.phone || "—"}</td><td>{row.source || "—"}</td><td>{LEAD_STATUS_LABELS[row.status]}</td><td>{leadDate(row.createdAt)}</td><td>{followUpStatus(row.followUpAt,now)} · {leadDate(row.followUpAt)}</td></tr>)}</tbody></table></div>
      {!filtered.length && <p className="sub">{rows.length ? "No leads match the current filters." : "No leads on this page."}</p>}
    </div>
  </>;
}
