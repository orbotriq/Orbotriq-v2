import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { requirePlatformAdmin } from "@/lib/auth/guard";
import { getSubscriptionPlans } from "@/lib/admin/plans";

function allowance(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : null;
}

function dateLabel(value: unknown): string {
  if (!value || typeof value !== "object") return "-";

  if ("toDate" in value &&
      typeof value.toDate === "function") {
    const date = value.toDate();

    if (date instanceof Date &&
        Number.isFinite(date.getTime())) {
      return date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Kolkata",
      });
    }
  }

  return "-";
}

export async function getPlanDetails(planId: string) {
  await requirePlatformAdmin();

  if (
    !planId ||
    Buffer.byteLength(planId, "utf8") > 1500 ||
    planId.includes("/") ||
    planId === "." ||
    planId === ".."
  ) {
    return null;
  }

  const plans = await getSubscriptionPlans();

  const plan = plans.find(
    (item) => item.id === planId
  );

  if (!plan) return null;

  const snapshot = await adminDb()
    .collection("orgs")
    .where("plan", "==", planId)
    .select(
      "name",
      "status",
      "institutionCount",
      "limits.institutions",
      "limits.geoRuns",
      "trialEndsAt",
      "paidUntil"
    )
    .get();

  const organizations = snapshot.docs.map((doc) => {
    const data = doc.data();

    const brandLimit = allowance(
      data.limits?.institutions
    );

    const geoLimit = allowance(
      data.limits?.geoRuns
    );

    const brands = allowance(
      data.institutionCount
    );

    const comparable =
      plan.configurationValid &&
      brandLimit !== null &&
      geoLimit !== null;

    const matchesDefaults = comparable
      ? brandLimit === plan.brandLimit &&
        geoLimit === plan.geoLimit
      : null;

    return {
      id: doc.id,
      name:
        typeof data.name === "string" &&
        data.name.trim()
          ? data.name
          : "Unnamed organization",
      status:
        typeof data.status === "string"
          ? data.status
          : "unknown",
      brands,
      brandLimit,
      geoLimit,
      matchesDefaults,
      expiresAt: dateLabel(
        planId === "trial"
          ? data.trialEndsAt
          : data.paidUntil
      ),
    };
  }).sort(
    (a, b) => a.name.localeCompare(b.name)
  );

  return {
    plan,
    organizations,
    matchingCount: organizations.filter(
      (org) => org.matchesDefaults === true
    ).length,
    customCount: organizations.filter(
      (org) => org.matchesDefaults === false
    ).length,
    unknownCount: organizations.filter(
      (org) => org.matchesDefaults === null
    ).length,
  };
}
