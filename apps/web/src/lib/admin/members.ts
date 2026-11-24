import "server-only";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { requirePlatformAdmin } from "@/lib/auth/guard";

function dateLabel(value: unknown): string {
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
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

export async function getOrganizationMembers(orgId: string) {
  await requirePlatformAdmin();

  if (!orgId || orgId.includes("/")) return null;

  const ref = adminDb().collection("orgs").doc(orgId);
  const organization = await ref.get();

  if (!organization.exists) return null;

  const snapshot = await ref.collection("members")
    .select(
      "email",
      "role",
      "createdAt",
      "mustChangePassword",
      "passwordChangedAt"
    )
    .get();

  const members = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const role = typeof data.role === "string"
      ? data.role
      : "unknown";

    let accountStatus = "Unavailable";
    let claimsStatus = "Not verified";
    let emailVerified: boolean | null = null;

    try {
      const account = await adminAuth().getUser(doc.id);
      const claims = account.customClaims || {};

      accountStatus = account.disabled ? "Disabled" : "Enabled";
      emailVerified = account.emailVerified;

      claimsStatus =
        claims.orgId === orgId &&
        claims.role === role &&
        ["owner", "admin", "staff", "viewer"].includes(role)
          ? "Matched"
          : "Mismatch";
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "auth/user-not-found"
      ) {
        accountStatus = "Missing account";
      }
    }

    members.push({
      uid: doc.id,
      email: typeof data.email === "string" ? data.email : "-",
      role,
      accountStatus,
      claimsStatus,
      emailVerified,
      mustChangePassword:
        typeof data.mustChangePassword === "boolean"
          ? data.mustChangePassword
          : null,
      createdAt: dateLabel(data.createdAt),
      passwordChangedAt: dateLabel(data.passwordChangedAt),
    });
  }

  return {
    organizationName: String(
      organization.data()?.name || "Organization"
    ),
    members: members.sort((a, b) =>
      a.email.localeCompare(b.email)
    ),
  };
}
