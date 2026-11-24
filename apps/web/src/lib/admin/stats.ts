import "server-only";
import { adminDb } from "@/lib/firebase/admin";
import { requirePlatformAdmin } from "@/lib/auth/guard";

export async function getPlatformStats() {
  await requirePlatformAdmin();

  const db = adminDb();
  const orgs = db.collection("orgs");

  const [
    organizations,
    active,
    trialing,
    suspended,
    expired,
    demo,
    users,
    leads,
  ] = await Promise.all([
    orgs.count().get(),
    orgs.where("status", "==", "active").count().get(),
    orgs.where("status", "==", "trialing").count().get(),
    orgs.where("status", "==", "suspended").count().get(),
    orgs.where("status", "==", "expired").count().get(),
    orgs.where("status", "==", "demo").count().get(),
    db.collection("users").count().get(),
    db.collection("leads").count().get(),
  ]);

  return {
    organizations: organizations.data().count,
    active: active.data().count,
    trialing: trialing.data().count,
    suspended: suspended.data().count,
    expired: expired.data().count,
    demo: demo.data().count,
    users: users.data().count,
    leads: leads.data().count,
  };
}
