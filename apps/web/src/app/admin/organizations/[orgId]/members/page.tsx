import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { MembersTable } from "@/components/members-table";
import { getOrganizationMembers } from "@/lib/admin/members";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Organization Members",
};

export default async function OrganizationMembersPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const result = await getOrganizationMembers(orgId);

  if (!result) notFound();

  return (
    <AppShell>
      <Link
        href={`/admin/organizations/${encodeURIComponent(orgId)}`}
        className="org-back"
      >
        <ArrowLeft size={17} />
        Back to organization
      </Link>

      <div className="eyebrow">
        Platform administration
      </div>

      <h1>Organization Members</h1>

      <p className="sub">
        {result.organizationName} - Workspace users and permissions
      </p>

      <Link href="/admin/users" className="org-members-button">Global user directory</Link>
      <MembersTable members={result.members} />

      <div className="card" style={{ marginTop: 24 }}>
        <h2>Permission integrity</h2>
        <p className="sub">
          Membership roles are compared with current Firebase
          Authentication custom claims.
        </p>
        <p className="sub">
          Read-only mode. No accounts or permissions are modified.
        </p>
      </div>
    </AppShell>
  );
}
