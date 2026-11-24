import { AppShell } from "@/components/app-shell";
import { OrganizationsTable } from "@/components/organizations-table";
import { getOrganizations } from "@/lib/admin/organizations";

export const metadata = {
  title: "Organizations",
};

export const dynamic = "force-dynamic";

export default async function OrganizationsPage() {
  const organizations = await getOrganizations();

  return (
    <AppShell>
      <div className="eyebrow">
        Platform administration
      </div>

      <h1>Organizations</h1>

      <p className="sub">
        Manage customer workspaces, subscriptions and usage limits.
      </p>

      <OrganizationsTable organizations={organizations} />

      <p className="sub" style={{ marginTop: 20 }}>
        Read-only mode. Existing customer records are protected
        from modification.
      </p>
    </AppShell>
  );
}
