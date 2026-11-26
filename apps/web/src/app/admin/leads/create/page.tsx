import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { LeadForm } from "@/components/lead-form";
import { isAdminWriteEnabled } from "@/lib/admin/write-guard";
import { requirePlatformAdmin } from "@/lib/auth/guard";
import { notFound } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function CreateLeadPage() {
  await requirePlatformAdmin(); if (!isAdminWriteEnabled()) notFound();
  return <AppShell><Link className="org-back" href="/admin/leads">Back to leads</Link><h1>Create test lead</h1><LeadForm /></AppShell>;
}
