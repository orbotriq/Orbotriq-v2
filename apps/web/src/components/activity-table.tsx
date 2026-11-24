"use client";

import { useState } from "react";
import {
  ScrollText,
  Clock,
  CalendarDays,
  Search,
  ShieldCheck,
} from "lucide-react";

type AuditEvent = {
  id: string;
  action: string;
  label: string;
  category: string;
  actor: string;
  time: number | null;
  details: string[];
};

function formatTime(value: number | null): string {
  if (value === null) return "-";

  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }) + " IST";
}

export function ActivityTable({
  events,
  recentCount,
}: {
  events: AuditEvent[];
  recentCount: number;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  const categories = Array.from(
    new Set(events.map(event => event.category))
  ).sort();

  const filtered = events.filter(event => {
    const query = search.trim().toLowerCase();

    const matchesSearch = [
      event.label,
      event.action,
      event.actor,
      ...event.details,
    ].some(value => value.toLowerCase().includes(query));

    return matchesSearch &&
      (category === "all" || event.category === category);
  });

  const cards = [
    {
      label: "Events on this page",
      value: events.length,
      icon: ScrollText,
    },
    {
      label: "Last 7 days on this page",
      value: recentCount,
      icon: CalendarDays,
    },
    {
      label: "Latest event on this page",
      value: formatTime(events[0]?.time ?? null),
      icon: Clock,
    },
  ];

  return (
    <>
      <div className="admin-stats-grid">
        {cards.map(({ label, value, icon: Icon }) => (
          <div className="admin-stat-card" key={label}>
            <Icon size={22} className="admin-stat-icon" />
            <div className="org-detail-stat-value">{value}</div>
            <div className="admin-stat-label">{label}</div>
          </div>
        ))}
      </div>

      <section className="card org-list">
        <div className="org-toolbar">
          <div>
            <h2>Activity history</h2>
            <p className="sub">
              {filtered.length} of {events.length} loaded events
            </p>
          </div>

          <div className="org-filters">
            <div className="org-search">
              <Search size={17} />
              <input
                aria-label="Search activity"
                placeholder="Search activity..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            <select
              aria-label="Filter event category"
              value={category}
              onChange={e => setCategory(e.target.value)}
            >
              <option value="all">All categories</option>

              {categories.map(item => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="org-table-scroll">
          <table className="org-table">
            <thead>
              <tr>
                <th>Activity</th>
                <th>Actor UID</th>
                <th>Details</th>
                <th>Date and time</th>
              </tr>
            </thead>

            <tbody>
              {filtered.map(event => (
                <tr key={event.id}>
                  <td>
                    <div className="org-name-cell">
                      <div className="org-avatar">
                        <ScrollText size={19} />
                      </div>

                      <div>
                        <strong>{event.label}</strong>
                        <div className="org-email">
                          {event.action}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td>
                    <span className="audit-actor">
                      {event.actor}
                    </span>
                  </td>

                  <td>
                    {event.details.length
                      ? event.details.map((detail, index) => (
                          <div className="audit-detail" key={index}>
                            {detail}
                          </div>
                        ))
                      : "-"}
                  </td>

                  <td>{formatTime(event.time)}</td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="org-empty">
                    No matching activity found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="card" style={{ marginTop: 24 }}>
        <ShieldCheck size={22} className="admin-stat-icon" />
        <h2>Audit integrity</h2>
        <p className="sub">
          Read-only history of recorded organization events.
          Existing audit records cannot be edited or deleted
          through this module.
        </p>
      </div>
    </>
  );
}
