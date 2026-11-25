"use client";
import { useState, useRef, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
type Edit = { planId: string; brandLimit: number | null; geoLimit: number | null; version: string };
export function PlanForm({ edit }: { edit?: Edit }) {
  const router = useRouter();
  const [id, setId] = useState(edit?.planId ?? "");
  const [brands, setBrands] = useState(String(edit?.brandLimit ?? ""));
  const [geo, setGeo] = useState(String(edit?.geoLimit ?? ""));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const lock = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || conflict) return;
    lock.current = true; setPending(true); setError("");
    try {
      const limits = { brandLimit: Number(brands), geoLimit: Number(geo) };
      const response = await fetch("/api/admin/plans" + (edit ? "/" + encodeURIComponent(edit.planId) : ""), {
        method: edit ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(edit ? { ...limits, version: edit.version } : { ...limits, planId: id }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error || "Request failed.");
        if (edit && response.status === 409) setConflict(true);
        return;
      }
      router.push("/admin/plans/" + encodeURIComponent(result.planId)); router.refresh();
    } catch { setError("Request outcome uncertain. Check the plan list before retrying."); setConflict(true); }
    finally { lock.current = false; setPending(false); }
  }
  return <form className="org-create-form" onSubmit={submit}>
    <fieldset disabled={pending || conflict} className="card">
      <h2>Plan configuration</h2>
      <label>Plan ID<input required pattern={"[a-z0-9][a-z0-9\\-]{1,39}"} value={id} readOnly={!!edit} onChange={e => setId(e.target.value)} /></label>
      <label>Default brand allowance<input required type="number" min={1} max={10000} step={1} value={brands} onChange={e => setBrands(e.target.value)} /></label>
      <label>Default monthly GEO allowance<input required type="number" min={0} max={1000000} step={1} value={geo} onChange={e => setGeo(e.target.value)} /></label>
      <p className="sub">Emulator only. Existing organization allowances and billing records are preserved.</p>
      <div className="org-form-actions"><button type="submit" className="btn primary">{pending ? "Saving..." : edit ? "Save changes" : "Create plan"}</button> <Link href="/admin/plans">Cancel</Link></div>
    </fieldset>
    {error && <p role="alert" className="org-form-error">{error}</p>}
    {conflict && <button type="button" onClick={() => window.location.reload()}>Reload</button>}
  </form>;
}
