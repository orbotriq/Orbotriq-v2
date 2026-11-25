import { isAdminWriteEnabled } from "@/lib/admin/write-guard";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Activity,
  Globe,
  CalendarDays,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { getOrganizationDetails } from "@/lib/admin/organizations";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Organization Details",
};

export default async function OrganizationDetailsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const org = await getOrganizationDetails(orgId);

  if (!org) notFound();

  const stats = [
    {
      label: "Brand usage",
      value: `${org.brands ?? "-"} / ${org.brandLimit ?? "-"}`,
      icon: Building2,
    },
    {
      label: "GEO allowance",
      value: org.geoLimit?.toLocaleString("en-IN") ?? "-",
      icon: Globe,
    },
    {
      label: "Account status",
      value: org.status,
      icon: Activity,
    },
    {
      label: "Paid until",
      value: org.paidUntil,
      icon: CalendarDays,
    },
  ];

  const details = [
    ["Organization name", org.name],
    ["Organization ID", org.id],
    ["Owner email", org.ownerEmail],
    ["Owner UID", org.ownerUid],
    ["Created date", org.createdAt],
    ["Last synchronization", org.lastSyncAt],
    ["Brand color", org.brandColor],
    ["Demo account", org.isDemo ? "Yes" : "No"],
  ];

  const subscription = [
    ["Current plan", org.plan],
    ["Account status", org.status],
    ["Trial expiry", org.trialEndsAt],
    ["Paid subscription expiry", org.paidUntil],
    ["Maximum brands", org.brandLimit ?? "-"],
    ["GEO allowance", org.geoLimit ?? "-"],
  ];

  return (
    <AppShell>
      <Link href="/admin/organizations" className="org-back">
        <ArrowLeft size={17} />
        Back to organizations
      </Link>

      <div className="eyebrow">
        Platform administration
      </div>

      <div className="org-detail-heading">
        <div className="org-avatar org-detail-avatar">
          <Building2 size={28} />
        </div>

        <div>
          <h1>{org.name}</h1>
          <p className="sub">
            Organization profile and subscription details
          </p>
        </div>

        <span className={`org-status status-${org.status}`}>
          {org.status}
        </span>
      </div>

      <div className="admin-stats-grid">
        {stats.map(({ label, value, icon: Icon }) => (
          <div className="admin-stat-card" key={label}>
            <Icon size={22} className="admin-stat-icon" />
            <div className="org-detail-stat-value">{value}</div>
            <div className="admin-stat-label">{label}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24, marginBottom: 24, display: "flex", flexWrap: "wrap", gap: 12 }}>
        <Link href={`/admin/organizations/${encodeURIComponent(org.id)}/subscription`} className="org-members-button">Subscription and Usage</Link>
        <Link href={`/admin/organizations/${encodeURIComponent(org.id)}/lifecycle`} className="org-members-button">Lifecycle</Link>
        {isAdminWriteEnabled() && (
          <Link
            href={`/admin/organizations/${encodeURIComponent(org.id)}/edit`}
            className="org-members-button"
          >
            Edit Organization
          </Link>
        )}
        <Link
          href={`/admin/organizations/${encodeURIComponent(org.id)}/members`}
          className="org-members-button"
        >
          View Members
        </Link>

        <Link
          href={`/admin/organizations/${encodeURIComponent(org.id)}/activity`}
          className="org-members-button"

        >
          View Activity
        </Link>
      </div>

      <div className="org-detail-grid">
        <section className="card">
          <h2>Organization information</h2>

          {details.map(([label, value]) => (
            <div className="org-detail-row" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </section>

        <section className="card">
          <h2>Subscription and limits</h2>

          {subscription.map(([label, value]) => (
            <div className="org-detail-row" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </section>
      </div>

      <p className="sub" style={{ marginTop: 24 }}>
        {isAdminWriteEnabled() ? "Local emulator organization profile." : "Read-only organization profile."}
        {isAdminWriteEnabled() ? "Administrative editing is enabled for test records only." : "No customer records are modified."}
      </p>
    </AppShell>
  );
}
