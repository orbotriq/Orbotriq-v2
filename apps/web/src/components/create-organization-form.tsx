"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Building2, ShieldCheck, Plus } from "lucide-react";

export function CreateOrganizationForm({demo=false,defaults}:{demo?:boolean;defaults:{days:number;brands:number;geo:number}}) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [trialDays, setTrialDays] = useState(String(defaults.days));
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const locked = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (locked.current) return;

    locked.current = true;
    setPending(true);
    setError("");

    try {
      const response = await fetch(
        demo ? "/api/admin/organizations/demo" : "/api/admin/organizations",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name,
            ownerEmail,
            trialDays: Number(trialDays),
            notes,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok || !result.orgId) {
        setError(result.error || "Organization creation failed.");
        return;
      }

      router.push(
        `/admin/organizations/${encodeURIComponent(result.orgId)}`
      );

      router.refresh();
    } catch {
      setError(
        "Request interrupted. Check the organization list before retrying."
      );
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  return (
    <form className="org-create-form" onSubmit={submit}>
      <fieldset disabled={pending}>
        <section className="card">
          <h2><Building2 size={20} /> Organization information</h2>

          <label>
            Organization name *
            <input
              required
              minLength={2}
              maxLength={80}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Enter organization name"
            />
          </label>

          <label>
            Owner email address *
            <input
              required
              type="email"
              maxLength={254}
              value={ownerEmail}
              onChange={e => setOwnerEmail(e.target.value)}
              placeholder="owner@company.test"
            />
          </label>

          <label>
            Internal notes
            <textarea
              rows={4}
              maxLength={500}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Optional administrative notes"
            />
          </label>

          <p className="sub">{notes.length}/500 characters</p>
        </section>

        <section className="card">
          <h2>Subscription configuration</h2>

          <div className="org-create-grid">
            <label>
              Subscription plan
              <input value={demo?"Demo":"Trial"} readOnly />
            </label>

            <label>
              {demo?"Demo":"Trial"} validity (days)
              <input
                type="number"
                required
                min={1}
                max={90}
                step={1}
                value={trialDays}
                onChange={e => setTrialDays(e.target.value)}
              />
            </label>

            <label>
              Brand limit
              <input value={defaults.brands} readOnly />
            </label>

            <label>
              GEO run limit
              <input value={defaults.geo} readOnly />
            </label>
          </div>

          <span className={`org-status ${demo?"status-demo":"status-trialing"}`}>
            {demo?"Demo":"Trialing"}
          </span>
        </section>

        <section className="card">
          <h2><ShieldCheck size={20} /> Account security</h2>
          <p className="sub">
            A new owner account will be provisioned.
            Email verification and password setup are required.
          </p>
          <p className="sub">
            Local emulator only. No production records will be created.
          </p>
        </section>

        {error && (
          <div className="org-create-error" role="alert">
            {error}
          </div>
        )}

        <div className="org-create-actions">
          <Link
            href="/admin/organizations"
            className="org-back"
          >
            Cancel
          </Link>

          <button
            className="org-members-button"
            type="submit"
            disabled={pending}
          >
            <Plus size={18} />
            {pending ? "Creating..." : "Create Organization"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
