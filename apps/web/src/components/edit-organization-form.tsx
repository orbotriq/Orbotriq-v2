"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Building2, Settings, ShieldCheck, Save } from "lucide-react";

type Organization = {
  id: string;
  name: string;
  notes: string;
  ownerEmail: string;
  ownerUid: string;
  plan: string;
  status: string;
  brandLimit: number | null;
  geoLimit: number | null;
  institutionCount: number | null;
  trialEndsAt: string | null;
  canExtendTrial: boolean;
  version: string;
};

export function EditOrganizationForm({
  organization,
}: {
  organization: Organization;
}) {
  const router = useRouter();

  const [name, setName] = useState(organization.name);
  const [notes, setNotes] = useState(organization.notes);

  const [brandLimit, setBrandLimit] = useState(
    organization.brandLimit?.toString() ?? ""
  );

  const [geoLimit, setGeoLimit] = useState(
    organization.geoLimit?.toString() ?? ""
  );

  const [extendDays, setExtendDays] = useState("0");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);

  const locked = useRef(false);

  const detailUrl =
    `/admin/organizations/${encodeURIComponent(organization.id)}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (locked.current || conflict) return;

    locked.current = true;
    setPending(true);
    setError("");

    try {
      const response = await fetch(
        `/api/admin/organizations/${encodeURIComponent(organization.id)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name,
            notes,
            brandLimit: Number(brandLimit),
            geoLimit: Number(geoLimit),
            extendDays: Number(extendDays),
            version: organization.version,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok || !result.ok) {
        setError(result.error || "Organization update failed.");

        if (response.status === 409) {
          setConflict(true);
        }

        return;
      }

      router.push(detailUrl);
      router.refresh();
    } catch {
      setConflict(true);
      setError(
        "Request interrupted. Reload and verify the current values before retrying."
      );
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  return (
    <form className="org-create-form" onSubmit={submit}>
      <fieldset disabled={pending || conflict}>
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
            />
          </label>

          <label>
            Owner email (read-only)
            <input value={organization.ownerEmail} readOnly />
          </label>

          <label>
            Owner UID (read-only)
            <input value={organization.ownerUid} readOnly />
          </label>

          <label>
            Internal notes
            <textarea
              rows={4}
              maxLength={500}
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </label>

          <p className="sub">{notes.length}/500 characters</p>
        </section>

        <section className="card">
          <h2><Settings size={20} /> Subscription and limits</h2>

          <div className="org-create-grid">
            <label>
              Current plan
              <input value={organization.plan} readOnly />
            </label>

            <label>
              Account status
              <input value={organization.status} readOnly />
            </label>

            <label>
              Brand limit
              <input
                type="number"
                required
                min={organization.institutionCount ?? 0}
                max={10000}
                step={1}
                value={brandLimit}
                onChange={e => setBrandLimit(e.target.value)}
              />
            </label>

            <label>
              GEO run limit
              <input
                type="number"
                required
                min={0}
                max={1000000}
                step={1}
                value={geoLimit}
                onChange={e => setGeoLimit(e.target.value)}
              />
            </label>
          </div>

          <p className="sub">
            Current brand usage: {organization.institutionCount ?? "Unknown"}
          </p>

          {organization.canExtendTrial && (
            <>
              <label>
                Current trial expiry
                <input
                  value={organization.trialEndsAt
                    ? new Date(organization.trialEndsAt)
                        .toLocaleDateString("en-IN", {
                          timeZone: "Asia/Kolkata",
                        })
                    : "-"}
                  readOnly
                />
              </label>

              <label>
                Extend trial by (days)
                <input
                  type="number"
                  required
                  min={0}
                  max={90}
                  step={1}
                  value={extendDays}
                  onChange={e => setExtendDays(e.target.value)}
                />
              </label>

              <p className="sub">
                Enter 0 to retain the current expiry date.
              </p>
            </>
          )}
        </section>

        <section className="card">
          <h2><ShieldCheck size={20} /> Audit protection</h2>

          <p className="sub">
            All saved changes are recorded in the organization
            activity history.
          </p>

          <p className="sub">
            Local emulator only. Production records cannot be modified.
          </p>
        </section>

        <div className="org-create-actions">
          <Link href={detailUrl} className="org-back">
            Cancel
          </Link>

          <button
            className="org-members-button"
            type="submit"
            disabled={pending || conflict}
          >
            <Save size={18} />
            {pending ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </fieldset>

      {error && (
        <div className="org-create-error" role="alert">
          {error}
        </div>
      )}

      {conflict && (
        <button
          type="button"
          className="org-members-button"
          onClick={() => window.location.reload()}
        >
          Reload latest organization data
        </button>
      )}
    </form>
  );
}
