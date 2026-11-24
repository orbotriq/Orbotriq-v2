"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Building2,
  Activity,
  Clock,
  Monitor,
  ShieldAlert,
  CalendarX,
  Search,
} from "lucide-react";

type Organization = {
  id: string;
  name: string;
  ownerEmail: string;
  plan: string;
  status: string;
  isDemo: boolean;
  brands: number | null;
  brandLimit: number | null;
  geoLimit: number | null;
  createdAt: string;
  expiresAt: string;
};

export function OrganizationsTable({
  organizations,
}: {
  organizations: Organization[];
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const filtered = organizations.filter((org) => {
    const query = search.trim().toLowerCase();

    const matchesSearch = [
      org.name,
      org.ownerEmail,
      org.plan,
      org.id,
    ].some((value) =>
      value.toLowerCase().includes(query)
    );

    return (
      matchesSearch &&
      (status === "all" || org.status === status)
    );
  });

  const cards = [
    {
      label: "Total organizations",
      value: organizations.length,
      icon: Building2,
    },
    {
      label: "Active",
      value: organizations.filter(
        (o) => o.status === "active"
      ).length,
      icon: Activity,
    },
    {
      label: "Trial",
      value: organizations.filter(
        (o) => o.status === "trialing"
      ).length,
      icon: Clock,
    },
    {
      label: "Demo",
      value: organizations.filter(
        (o) => o.status === "demo"
      ).length,
      icon: Monitor,
    },
    {
      label: "Suspended",
      value: organizations.filter(
        (o) => o.status === "suspended"
      ).length,
      icon: ShieldAlert,
    },
    {
      label: "Expired",
      value: organizations.filter(
        (o) => o.status === "expired"
      ).length,
      icon: CalendarX,
    },
  ];

  return (
    <>
      <div className="admin-stats-grid">
        {cards.map(({ label, value, icon: Icon }) => (
          <div className="admin-stat-card" key={label}>
            <Icon size={22} className="admin-stat-icon" />
            <div className="admin-stat-value">{value}</div>
            <div className="admin-stat-label">{label}</div>
          </div>
        ))}
      </div>

      <section className="card org-list">
        <div className="org-toolbar">
          <div>
            <h2>All organizations</h2>
            <p className="sub">
              {filtered.length} of {organizations.length} organizations
            </p>
          </div>

          <div className="org-filters">
            <div className="org-search">
              <Search size={17} />
              <input
                aria-label="Search organizations"
                placeholder="Search organizations..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <select
              aria-label="Filter by status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="trialing">Trial</option>
              <option value="demo">Demo</option>
              <option value="suspended">Suspended</option>
              <option value="expired">Expired</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>
        </div>

        <div className="org-table-scroll">
          <table className="org-table">
            <thead>
              <tr>
                <th>Organization</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Brands</th>
                <th>GEO limit</th>
                <th>Expires</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((org) => (
                <tr key={org.id}>
                  <td>
                    <div className="org-name-cell">
                      <div className="org-avatar">
                        <Building2 size={19} />
                      </div>
                      <div>
                        <Link className="org-name-link" href={`/admin/organizations/${encodeURIComponent(org.id)}`}>{org.name}</Link>
                        <div className="org-email">
                          {org.ownerEmail}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="org-plan">
                      {org.plan}
                    </span>
                  </td>
                  <td>
                    <span className={`org-status status-${org.status}`}>
                      {org.status}
                    </span>
                  </td>
                  <td>
                    {org.brands ?? "-"} / {org.brandLimit ?? "-"}
                  </td>
                  <td>{org.geoLimit ?? "-"}</td>
                  <td>{org.expiresAt}</td>
                  <td>{org.createdAt}</td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="org-empty">
                    No matching organizations found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

