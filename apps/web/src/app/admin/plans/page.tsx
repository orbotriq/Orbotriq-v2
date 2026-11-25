import Link from "next/link";
import { isAdminWriteEnabled } from "@/lib/admin/write-guard";
import { AppShell } from "@/components/app-shell";
import { PlansTable } from "@/components/plans-table";
import { getSubscriptionPlans } from "@/lib/admin/plans";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Subscription Plans | Orbotriq",
};

export default async function SubscriptionPlansPage() {
  const plans = await getSubscriptionPlans();

  return (
    <AppShell>
      <div className="eyebrow">
        Platform administration
      </div>

      <h1>Subscription Plans</h1>
      {isAdminWriteEnabled() && <Link className="org-name-link" href="/admin/plans/create">Create Plan</Link>}

      <p className="sub">
        View subscription definitions, default allowances
        and organization assignments.
      </p>

      <div style={{ marginTop: 24 }}>
        <PlansTable plans={plans} />
      </div>

      <p className="sub" style={{ marginTop: 24 }}>
        Plan management writes are available only in the isolated emulator.
      </p>
    </AppShell>
  );
}
