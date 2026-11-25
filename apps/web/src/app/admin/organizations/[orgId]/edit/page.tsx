import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { requirePlatformAdmin } from "@/lib/auth/guard";
import { isAdminWriteEnabled } from "@/lib/admin/write-guard";
import { getOrganizationForEdit } from "@/lib/admin/update-organization";
import { EditOrganizationForm } from "@/components/edit-organization-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Edit Organization",
};

export default async function EditOrganizationPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  await requirePlatformAdmin();

  if (!isAdminWriteEnabled()) notFound();

  const { orgId } = await params;
  const organization = await getOrganizationForEdit(orgId);

  if (!organization) notFound();

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

      <h1>Edit Organization</h1>

      <p className="sub">
        Manage {organization.name} — local emulator only.
      </p>

      <EditOrganizationForm
        key={organization.version}
        organization={organization}
      />
    </AppShell>
  );
}
