import type { AuditRow } from "./global-audit-view";
import { csvCell } from "./lead-csv";
// Export only the approved display model, never raw Firestore documents.
const headers = ["Recorded at (UTC)", "Action", "Description", "Category", "Actor ID", "Organization ID", "Target ID", "Event ID", "Source", "Invoice"];
export function auditCsv(rows: readonly AuditRow[]): string {
  const values = rows.map(r => [new Date(r.time).toISOString(), r.action, r.label, r.category, r.actor, r.orgId, r.target, r.id, r.source, r.invoice]);
  return "\uFEFF" + [headers, ...values].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
