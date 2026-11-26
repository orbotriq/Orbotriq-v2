import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { requirePlatformAdmin } from "@/lib/auth/guard";

import { getProvisioningSettings } from "./platform-provisioning";
import { isAdminWriteEnabled } from "./write-guard";

export type SubscriptionPlan = {
  id: string;
  name: string;
  type: "built-in" | "configured" | "missing";
  brandLimit: number | null;
  geoLimit: number | null;
  organizations: number;
  active: number;
  trialing: number;
  suspended: number;
  expired: number;
  demo: number;
  unknown: number;
  configurationValid: boolean;
};

function allowance(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : null;
}

function makePlan(
  id: string,
  name: string,
  type: SubscriptionPlan["type"],
  brandLimit: number | null,
  geoLimit: number | null
): SubscriptionPlan {
  return {
    id,
    name,
    type,
    brandLimit,
    geoLimit,
    organizations: 0,
    active: 0,
    trialing: 0,
    suspended: 0,
    expired: 0,
    demo: 0,
    unknown: 0,
    configurationValid:
      type !== "missing" &&
      brandLimit !== null &&
      geoLimit !== null &&
      (type === "built-in" || brandLimit > 0),
  };
}

export async function getSubscriptionPlans():
  Promise<SubscriptionPlan[]> {
  await requirePlatformAdmin();

  const db = adminDb();

  const [planSnapshot, orgSnapshot] = await Promise.all([
    db.collection("plans")
      .select("limits.brands", "limits.geoRuns")
      .get(),
    db.collection("orgs")
      .select("plan", "status")
      .get(),
  ]);

  const defaults=isAdminWriteEnabled()?(await getProvisioningSettings()).provisioning:null;
  const plans = new Map<string, SubscriptionPlan>();

  plans.set(
    "trial",
    makePlan("trial", "Trial", "built-in", defaults?.trialBrands ?? (isAdminWriteEnabled()?null:2), defaults?.trialGeo ?? (isAdminWriteEnabled()?null:5))
  );

  plans.set(
    "demo",
    makePlan("demo", "Demo", "built-in", defaults?.demoBrands ?? (isAdminWriteEnabled()?null:5), defaults?.demoGeo ?? (isAdminWriteEnabled()?null:50))
  );

  for (const doc of planSnapshot.docs) {
    if (doc.id === "trial" || doc.id === "demo") {
      continue;
    }

    const data = doc.data();

    plans.set(
      doc.id,
      makePlan(
        doc.id,
        doc.id,
        "configured",
        allowance(data.limits?.brands),
        allowance(data.limits?.geoRuns)
      )
    );
  }

  const unassigned = makePlan(
    "",
    "Unassigned or invalid plan",
    "missing",
    null,
    null
  );

  for (const doc of orgSnapshot.docs) {
    const data = doc.data();

    const id =
      typeof data.plan === "string" &&
      data.plan.trim().length > 0
        ? data.plan
        : "";

    let plan: SubscriptionPlan;

    if (!id) {
      plan = unassigned;
    } else {
      const existing = plans.get(id);

      if (existing) {
        plan = existing;
      } else {
        plan = makePlan(
          id,
          id,
          "missing",
          null,
          null
        );

        plans.set(id, plan);
      }
    }

    plan.organizations++;

    switch (data.status) {
      case "active":
        plan.active++;
        break;
      case "trialing":
        plan.trialing++;
        break;
      case "suspended":
        plan.suspended++;
        break;
      case "expired":
        plan.expired++;
        break;
      case "demo":
        plan.demo++;
        break;
      default:
        plan.unknown++;
    }
  }

  const result = [...plans.values()];

  if (unassigned.organizations > 0) {
    result.push(unassigned);
  }

  const order = {
    "built-in": 0,
    configured: 1,
    missing: 2,
  };

  return result.sort(
    (a, b) =>
      order[a.type] - order[b.type] ||
      a.name.localeCompare(b.name)
  );
}
