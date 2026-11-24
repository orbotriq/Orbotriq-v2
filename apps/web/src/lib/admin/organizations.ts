import "server-only";
import { redirect } from "next/navigation";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { requirePlatformAdmin } from "@/lib/auth/guard";

function dateLabel(value: unknown): string {
  if (!value || typeof value !== "object") return "-";

  if ("toDate" in value && typeof value.toDate === "function") {
    const date = value.toDate();
    if (date instanceof Date) {
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

function textValue(value: unknown, fallback = "-"): string {
  return typeof value === "string" && value.trim()
    ? value
    : fallback;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

export async function getOrganizations() {
  const session = await requirePlatformAdmin();

  const account = await adminAuth().getUser(session.uid);

  if (
    account.disabled ||
    account.customClaims?.platformAdmin !== true
  ) {
    redirect("/dashboard");
  }

  const snapshot = await adminDb()
    .collection("orgs")
    .select(
      "name",
      "ownerEmail",
      "plan",
      "status",
      "isDemo",
      "institutionCount",
      "limits",
      "createdAt",
      "trialEndsAt",
      "paidUntil"
    )
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();

    return {
      id: doc.id,
      name: textValue(data.name, "Unnamed organization"),
      ownerEmail: textValue(data.ownerEmail),
      plan: textValue(data.plan),
      status: textValue(data.status, "unknown"),
      isDemo: data.isDemo === true,
      brands: numberValue(data.institutionCount),
      brandLimit: numberValue(data.limits?.institutions),
      geoLimit: numberValue(data.limits?.geoRuns),
      createdAt: dateLabel(data.createdAt),
      expiresAt: dateLabel(
        data.plan === "trial"
          ? data.trialEndsAt
          : data.paidUntil
      ),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getOrganizationDetails(orgId: string) {
  const session = await requirePlatformAdmin();
  const account = await adminAuth().getUser(session.uid);

  if (
    account.disabled ||
    !account.emailVerified ||
    account.customClaims?.platformAdmin !== true
  ) {
    redirect("/dashboard");
  }

  if (!orgId || orgId.includes("/")) {
    return null;
  }

  const ref = adminDb().collection("orgs").doc(orgId);
  const snapshot = await ref.get();

  if (!snapshot.exists) return null;

  const data = snapshot.data()!;

  return {
    id: snapshot.id,
    name: textValue(data.name, "Unnamed organization"),
    ownerEmail: textValue(data.ownerEmail),
    ownerUid: textValue(data.ownerUid),
    plan: textValue(data.plan),
    status: textValue(data.status, "unknown"),
    isDemo: data.isDemo === true,
    brands: numberValue(data.institutionCount),
    brandLimit: numberValue(data.limits?.institutions),
    geoLimit: numberValue(data.limits?.geoRuns),
    createdAt: dateLabel(data.createdAt),
    lastSyncAt: dateLabel(data.lastSyncAt),
    trialEndsAt: dateLabel(data.trialEndsAt),
    paidUntil: dateLabel(data.paidUntil),
    brandColor: textValue(data.brandColor),
  };
}
