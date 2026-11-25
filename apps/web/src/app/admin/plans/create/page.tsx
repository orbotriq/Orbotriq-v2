import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PlanForm } from "@/components/plan-form";
import { requirePlatformAdmin } from "@/lib/auth/guard";
import { isAdminWriteEnabled } from "@/lib/admin/write-guard";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePlatformAdmin();
  if (!isAdminWriteEnabled()) notFound();
  return <AppShell><Link className="org-back" href="/admin/plans">Back to Subscription Plans</Link><h1>Create Subscription Plan</h1><PlanForm  /></AppShell>;
}
