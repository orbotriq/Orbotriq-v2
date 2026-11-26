export const LEAD_STATUSES = ["new", "contacted", "qualified", "demo given", "proposal sent", "won", "lost", "unknown"] as const;
export type LeadStatus = typeof LEAD_STATUSES[number];
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New", contacted: "Contacted", qualified: "Qualified", "demo given": "Demo given",
  "proposal sent": "Proposal sent", won: "Won", lost: "Lost", unknown: "Unknown"
};
export function validLeadId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && new TextEncoder().encode(value).length <= 1500 && !value.includes("/") && value !== "." && value !== ".." && !/^__.*__$/.test(value);
}
function field(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
export function normalizeLeadStatus(value: unknown): LeadStatus {
  if (value === undefined || value === null || value === "") return "new";
  return LEAD_STATUSES.find(s => s === value) ?? "unknown";
}
export function normalizeLead(id: string, data: Record<string, unknown>, createdAt: number | null) {
  return { id, name: field(data.name, 120) || "Unnamed lead", company: field(data.company, 160),
    email: field(data.email, 160), phone: field(data.phone, 40), message: field(data.message, 2000),
    source: field(data.source, 120), status: normalizeLeadStatus(data.status), createdAt };
}
export type Lead = ReturnType<typeof normalizeLead>;
export function filterLeads(rows: Lead[], query: string, status: string) {
  const q = query.trim().toLowerCase();
  return rows.filter(row => (status === "all" || row.status === status) &&
    [row.name, row.company, row.email, row.phone, row.source, row.id].some(v => v.toLowerCase().includes(q)));
}
export function leadDate(ms: number | null): string {
  return ms !== null && Number.isFinite(ms) && Math.abs(ms) <= 8640000000000000
    ? new Date(ms).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "Not recorded";
}
