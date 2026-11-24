import { AppShell } from "@/components/app-shell";
import { getPlatformStats } from "@/lib/admin/stats";
import {
  Building2,
  Activity,
  Clock,
  ShieldAlert,
  Users,
  Mail,
  Monitor,
  CalendarX,
} from "lucide-react";

export const metadata = {
  title: "Super Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const stats = await getPlatformStats();

  const cards = [
    { label: "Total organizations", value: stats.organizations, icon: Building2 },
    { label: "Active organizations", value: stats.active, icon: Activity },
    { label: "Trial accounts", value: stats.trialing, icon: Clock },
    { label: "Suspended accounts", value: stats.suspended, icon: ShieldAlert },
    { label: "User profiles", value: stats.users, icon: Users },
    { label: "Customer enquiries", value: stats.leads, icon: Mail },
    { label: "Demo accounts", value: stats.demo, icon: Monitor },
    { label: "Expired accounts", value: stats.expired, icon: CalendarX },
  ];

  return (
    <AppShell>
      <div>
        <div className="eyebrow">Platform administration</div>
        <h1>Super Admin Overview</h1>
        <p className="sub">
          Monitor organizations, subscriptions and platform activity.
        </p>

        <div className="admin-stats-grid">
          {cards.map(({ label, value, icon: Icon }) => (
            <div className="admin-stat-card" key={label}>
              <Icon size={22} className="admin-stat-icon" />
              <div className="admin-stat-value">
                {value.toLocaleString("en-IN")}
              </div>
              <div className="admin-stat-label">{label}</div>
            </div>
          ))}
        </div>

        <div className="card" style={{ marginTop: 24 }}>
          <h2>Platform status</h2>
          <p className="sub">Firebase read-only integration</p>
          <span className="pill">Platform Admin</span>
          <p className="sub" style={{ marginTop: 16 }}>
            Statistics are retrieved from the existing Firestore database.
            Administrative write operations are not enabled.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
