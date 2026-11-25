import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { CreateOrganizationForm } from "@/components/create-organization-form";
import { requirePlatformAdmin } from "@/lib/auth/guard";
import { isAdminWriteEnabled } from "@/lib/admin/write-guard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Create Organization",
};

export default async function CreateOrganizationPage() {
  await requirePlatformAdmin();

  if (!isAdminWriteEnabled()) {
    notFound();
  }

  return (
    <AppShell>
      <Link
        href="/admin/organizations"
        className="org-back"
      >
        <ArrowLeft size={16} />
        Back to Organizations
      </Link>

      <div className="eyebrow">
        Platform administration
      </div>

      <h1>Create Organization</h1>

      <p className="sub">
        Register a new trial customer workspace.
        Local emulator mode.
      </p>

      <CreateOrganizationForm />
    </AppShell>
  );
}
