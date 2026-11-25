import Link from "next/link";
import { Plus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { OrganizationsTable } from "@/components/organizations-table";
import { getOrganizations } from "@/lib/admin/organizations";
import { isAdminWriteEnabled } from "@/lib/admin/write-guard";

export const metadata = {
  title: "Organizations",
};

export const dynamic = "force-dynamic";

export default async function OrganizationsPage() {
  const organizations = await getOrganizations();
  const canCreate = isAdminWriteEnabled();

  return (
    <AppShell>
      <div className="eyebrow">
        Platform administration
      </div>

      <div className="org-page-heading">
        <div>
          <h1>Organizations</h1>

          <p className="sub">
            Manage customer workspaces, subscriptions and usage limits.
          </p>
        </div>

        {canCreate && (
          <Link
            className="org-members-button"
            href="/admin/organizations/create"
          >
            <Plus size={18} />
            Create Organization
          </Link>
        )}
      </div>

      {canCreate && <Link className="org-members-button" href="/admin/organizations/demo">Create Demo</Link>}
      <OrganizationsTable organizations={organizations} />

      <p className="sub" style={{ marginTop: 20 }}>
        {canCreate
          ? "Local emulator mode. Trial organization creation enabled."
          : "Read-only mode. Existing customer records are protected from modification."}
      </p>
    </AppShell>
  );
}
