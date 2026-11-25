import { isAdminWriteEnabled } from "@/lib/admin/write-guard";
import { isEditablePlanId } from "@/lib/admin/plan-validation";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Layers,
  Building2,
  Globe,
  Users,
  Activity,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { getPlanDetails } from "@/lib/admin/plan-details";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Subscription Plan Details | Orbotriq",
};

function numberLabel(value: number | null): string {
  return value === null
    ? "-"
    : value.toLocaleString("en-IN");
}

const statusClasses: Record<string, string> = {
  active: "status-active",
  trialing: "status-trialing",
  demo: "status-demo",
  suspended: "status-suspended",
  expired: "status-expired",
};

export default async function PlanDetailsPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;

  const details = await getPlanDetails(planId);

  if (!details) notFound();

  const {
    plan,
    organizations,
    matchingCount,
    customCount,
    unknownCount,
  } = details;

  const stats = [
    {
      label: "Default brand allowance",
      value: numberLabel(plan.brandLimit),
      icon: Building2,
    },
    {
      label: "Default monthly GEO",
      value: numberLabel(plan.geoLimit),
      icon: Globe,
    },
    {
      label: "Assigned organizations",
      value: organizations.length,
      icon: Users,
    },
    {
      label: "Active subscriptions",
      value: plan.active,
      icon: Activity,
    },
  ];

  const statuses = [
    ["Active", plan.active],
    ["Trialing", plan.trialing],
    ["Suspended", plan.suspended],
    ["Expired", plan.expired],
    ["Demo", plan.demo],
    ["Unknown", plan.unknown],
  ] as const;

  const configuration = [
    ["Plan ID", plan.id],
    ["Plan name", plan.name],
    [
      "Plan type",
      plan.type === "built-in"
        ? "Protected built-in"
        : plan.type === "configured"
          ? "Configured paid plan"
          : "Missing definition",
    ],
    [
      "Configuration",
      plan.configurationValid
        ? "Valid limits"
        : "Requires attention",
    ],
    ["Brand allowance", numberLabel(plan.brandLimit)],
    ["Monthly GEO allowance", numberLabel(plan.geoLimit)],
  ];

  return (
    <AppShell>
      <Link href="/admin/plans" className="org-back">
        <ArrowLeft size={16} />
        Back to Subscription Plans
      </Link>

      <div className="eyebrow">
        Platform administration
      </div>

      <div className="org-detail-heading">
        <div className="org-avatar">
          <Layers size={24} />
        </div>
        <div>
          <h1>{plan.name}</h1>
          {isAdminWriteEnabled() && plan.type === "configured" && isEditablePlanId(plan.id) && <Link className="org-name-link" href={`/admin/plans/${encodeURIComponent(plan.id)}/edit`}>Edit Plan</Link>}
          <p className="sub">
            Subscription configuration and assignments
          </p>
        </div>
      </div>

      <div
        className="admin-stats-grid"
        style={{ marginTop: 24 }}
      >
        {stats.map(({ label, value, icon: Icon }) => (
          <div className="admin-stat-card" key={label}>
            <div className="admin-stat-icon">
              <Icon size={20} />
            </div>
            <div className="admin-stat-value">
              {value}
            </div>
            <div className="admin-stat-label">
              {label}
            </div>
          </div>
        ))}
      </div>

      <div
        className="org-detail-grid"
        style={{ marginTop: 24 }}
      >
        <section className="card">
          <h2>Plan configuration</h2>

          {configuration.map(([label, value]) => (
            <div className="org-detail-row" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </section>

        <section className="card">
          <h2>Subscription breakdown</h2>

          {statuses.map(([label, value]) => (
            <div className="org-detail-row" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </section>
      </div>

      <section className="card" style={{ marginTop: 24 }}>
        <h2>Allowance comparison</h2>

        <div className="org-detail-row">
          <span>Matching plan defaults</span>
          <strong>{matchingCount}</strong>
        </div>

        <div className="org-detail-row">
          <span>Different organization limits</span>
          <strong>{customCount}</strong>
        </div>

        <div className="org-detail-row">
          <span>Unable to compare</span>
          <strong>{unknownCount}</strong>
        </div>

        <p className="sub" style={{ marginTop: 12 }}>
          Different limits may represent intentional
          organization-specific allowances.
        </p>
      </section>

      <section className="card" style={{ marginTop: 24 }}>
        <h2>Assigned organizations</h2>

        <p className="sub" style={{ margin: "12px 0" }}>
          {organizations.length} organizations
          reference this plan.
        </p>

        <div className="org-table-scroll">
          <table className="org-table">
            <thead>
              <tr>
                <th>Organization</th>
                <th>Status</th>
                <th>Brands</th>
                <th>GEO allowance</th>
                <th>Expires</th>
                <th>Allowance comparison</th>
              </tr>
            </thead>

            <tbody>
              {organizations.map((org) => (
                <tr key={org.id}>
                  <td>
                    <Link
                      className="org-name-link"
                      href={
                        "/admin/organizations/" +
                        encodeURIComponent(org.id)
                      }
                    >
                      {org.name}
                    </Link>
                  </td>

                  <td>
                    <span
                      className={
                        "org-status " +
                        (Object.prototype.hasOwnProperty.call(
                          statusClasses,
                          org.status
                        )
                          ? statusClasses[org.status]
                          : "")
                      }
                    >
                      {org.status}
                    </span>
                  </td>

                  <td>
                    {numberLabel(org.brands)} /{" "}
                    {numberLabel(org.brandLimit)}
                  </td>

                  <td>{numberLabel(org.geoLimit)}</td>

                  <td>{org.expiresAt}</td>

                  <td>
                    {org.matchesDefaults === null
                      ? "Unable to compare"
                      : org.matchesDefaults
                        ? "Matches defaults"
                        : "Different limits"}
                  </td>
                </tr>
              ))}

              {organizations.length === 0 && (
                <tr>
                  <td colSpan={6} className="org-empty">
                    No organizations assigned to this plan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="sub" style={{ marginTop: 24 }}>
        Read-only subscription details. No plan definitions,
        organization allowances or billing records are
        modified by this page.
      </p>
    </AppShell>
  );
}
