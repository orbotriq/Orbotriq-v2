import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PlanForm } from "@/components/plan-form";
import { requirePlatformAdmin } from "@/lib/auth/guard";
import { isAdminWriteEnabled } from "@/lib/admin/write-guard";
import { getPlanForEdit } from "@/lib/admin/update-plan";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ planId: string }> }) {
  await requirePlatformAdmin();
  if (!isAdminWriteEnabled()) notFound();
  const edit = await getPlanForEdit((await params).planId);
  if (!edit) notFound();
  return <AppShell><Link className="org-back" href="/admin/plans">Back to Subscription Plans</Link><h1>Edit Subscription Plan</h1><PlanForm edit={edit} key={edit.version} /></AppShell>;
}
