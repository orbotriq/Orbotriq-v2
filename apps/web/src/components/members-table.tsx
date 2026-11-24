"use client";

import { useState } from "react";
import {
  Users,
  ShieldCheck,
  Shield,
  UserRound,
  Eye,
  Search,
} from "lucide-react";

type Member = {
  uid: string;
  email: string;
  role: string;
  accountStatus: string;
  claimsStatus: string;
  emailVerified: boolean | null;
  mustChangePassword: boolean | null;
  createdAt: string;
  passwordChangedAt: string;
};

export function MembersTable({
  members,
}: {
  members: Member[];
}) {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("all");

  const filtered = members.filter((member) => {
    const query = search.trim().toLowerCase();

    return (
      (
        member.email.toLowerCase().includes(query) ||
        member.uid.toLowerCase().includes(query)
      ) &&
      (role === "all" || member.role === role)
    );
  });

  const cards = [
    { label: "Total members", value: members.length, icon: Users },
    { label: "Owners", value: members.filter(m => m.role === "owner").length, icon: ShieldCheck },
    { label: "Admins", value: members.filter(m => m.role === "admin").length, icon: Shield },
    { label: "Staff", value: members.filter(m => m.role === "staff").length, icon: UserRound },
    { label: "Viewers", value: members.filter(m => m.role === "viewer").length, icon: Eye },
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
            <h2>Workspace members</h2>
            <p className="sub">
              {filtered.length} of {members.length} members
            </p>
          </div>

          <div className="org-filters">
            <div className="org-search">
              <Search size={17} />
              <input
                aria-label="Search members"
                placeholder="Search members..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            <select
              aria-label="Filter by role"
              value={role}
              onChange={e => setRole(e.target.value)}
            >
              <option value="all">All roles</option>
              <option value="owner">Owner</option>
              <option value="admin">Admin</option>
              <option value="staff">Staff</option>
              <option value="viewer">Viewer</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>
        </div>

        <div className="org-table-scroll">
          <table className="org-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Account</th>
                <th>Verified email</th>
                <th>Permission check</th>
                <th>Password change required</th>
                <th>Joined</th>
              </tr>
            </thead>

            <tbody>
              {filtered.map(member => (
                <tr key={member.uid}>
                  <td>
                    <div className="org-name-cell">
                      <div className="org-avatar">
                        <UserRound size={19} />
                      </div>
                      <strong>{member.email}</strong>
                    </div>
                  </td>

                  <td>
                    <span className="org-plan">{member.role}</span>
                  </td>

                  <td>
                    <span className={`org-status ${
                      member.accountStatus === "Enabled"
                        ? "status-active"
                        : "status-suspended"
                    }`}>
                      {member.accountStatus}
                    </span>
                  </td>

                  <td>
                    {member.emailVerified === null
                      ? "-"
                      : member.emailVerified ? "Yes" : "No"}
                  </td>

                  <td>
                    <span className={`org-status ${
                      member.claimsStatus === "Matched"
                        ? "status-active"
                        : "status-trialing"
                    }`}>
                      {member.claimsStatus}
                    </span>
                  </td>

                  <td>
                    {member.mustChangePassword === null
                      ? "-"
                      : member.mustChangePassword ? "Yes" : "No"}
                  </td>

                  <td>{member.createdAt}</td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="org-empty">
                    No matching members found.
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
