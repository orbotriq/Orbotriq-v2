"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Layers,
  CreditCard,
  Building2,
  AlertTriangle,
  Search,
} from "lucide-react";
import type { SubscriptionPlan } from "@/lib/admin/plans";

const typeLabels = {
  "built-in": "Built-in",
  configured: "Configured",
  missing: "Missing definition",
};

function formatNumber(value: number | null): string {
  return value === null
    ? "-"
    : value.toLocaleString("en-IN");
}

export function PlansTable({
  plans,
}: {
  plans: SubscriptionPlan[];
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    return plans.filter((plan) => {
      const matchesSearch =
        !query ||
        plan.name.toLowerCase().includes(query) ||
        plan.id.toLowerCase().includes(query);

      const matchesType =
        filter === "all" || plan.type === filter;

      return matchesSearch && matchesType;
    });
  }, [plans, search, filter]);

  const stats = [
    {
      label: "Built-in plans",
      value: plans.filter(
        (plan) => plan.type === "built-in"
      ).length,
      icon: Layers,
    },
    {
      label: "Configured paid plans",
      value: plans.filter(
        (plan) => plan.type === "configured"
      ).length,
      icon: CreditCard,
    },
    {
      label: "Organizations",
      value: plans.reduce(
        (total, plan) => total + plan.organizations,
        0
      ),
      icon: Building2,
    },
    {
      label: "Configuration issues",
      value: plans.filter(
        (plan) => !plan.configurationValid
      ).length,
      icon: AlertTriangle,
    },
  ];

  return (
    <div className="org-list">
      <div className="admin-stats-grid">
        {stats.map(({ label, value, icon: Icon }) => (
          <div className="admin-stat-card" key={label}>
            <div className="admin-stat-icon">
              <Icon size={20} />
            </div>
            <div className="admin-stat-value">
              {value.toLocaleString("en-IN")}
            </div>
            <div className="admin-stat-label">
              {label}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="org-toolbar">
          <div className="org-search">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search subscription plans"
              placeholder="Search plans..."
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
            />
          </div>

          <div className="org-filters">
            <select
              aria-label="Filter plan type"
              value={filter}
              onChange={(event) =>
                setFilter(event.target.value)
              }
            >
              <option value="all">All types</option>
              <option value="built-in">Built-in</option>
              <option value="configured">
                Configured paid plans
              </option>
              <option value="missing">
                Missing definitions
              </option>
            </select>
          </div>
        </div>

        <p className="sub" style={{ margin: "12px 0" }}>
          Showing {filtered.length} of {plans.length} plans
        </p>

        <div className="org-table-scroll">
          <table className="org-table">
            <thead>
              <tr>
                <th>Plan</th>
                <th>Type</th>
                <th>Brands</th>
                <th>Monthly GEO</th>
                <th>Organizations</th>
                <th>Active</th>
                <th>Suspended</th>
                <th>Configuration</th>
              </tr>
            </thead>

            <tbody>
              {filtered.map((plan) => (
                <tr key={plan.id}>
                  <td>
                    <div className="org-name-cell">
                      <div className="org-avatar">
                        <Layers size={18} />
                      </div>
                      <div>
                        {plan.id &&
                          !plan.id.includes("/") &&
                          plan.id !== "." &&
                          plan.id !== ".." && plan.id !== "create" ? (
                          <Link
                            className="org-name-link"
                            href={
                              "/admin/plans/" +
                              encodeURIComponent(plan.id)
                            }
                          >
                            {plan.name}
                          </Link>
                        ) : (
                          <strong>{plan.name}</strong>
                        )}
                        <div className="org-email">
                          {plan.id || "No valid plan ID"}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td>{typeLabels[plan.type]}</td>

                  <td>{formatNumber(plan.brandLimit)}</td>
                  <td>{formatNumber(plan.geoLimit)}</td>
                  <td>{formatNumber(plan.organizations)}</td>
                  <td>{formatNumber(plan.active)}</td>
                  <td>{formatNumber(plan.suspended)}</td>

                  <td>
                    <span
                      className={
                        "org-status " +
                        (plan.configurationValid
                          ? "status-active"
                          : "status-suspended")
                      }
                    >
                      {plan.configurationValid
                        ? plan.type === "built-in"
                          ? "Protected"
                          : "Valid limits"
                        : plan.type === "missing"
                          ? "Missing"
                          : "Invalid limits"}
                    </span>
                  </td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="org-empty">
                    No subscription plans match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Subscription configuration</h2>
        <p className="sub" style={{ marginTop: 12 }}>
          Trial and Demo are protected built-in plans.
          Configured plans are loaded from Firestore.
          Missing definitions identify organizations
          referencing plans that do not exist.
        </p>
        <p className="sub" style={{ marginTop: 12 }}>
          Plan allowances are defaults. Existing organization
          limits may differ. This page does not modify plans,
          subscriptions, usage counters or billing records.
        </p>
      </div>
    </div>
  );
}
