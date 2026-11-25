import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { requireAdminWrite } from "@/lib/admin/write-guard";
import {
  createPlanSchema,
  failure,
} from "@/lib/admin/plan-validation";

export async function createPlan(input: unknown) {
  const actor = await requireAdminWrite();

  const parsed = createPlanSchema.safeParse(input);

  if (!parsed.success) {
    return failure(
      parsed.error.issues[0]?.message ||
      "Invalid plan configuration."
    );
  }

  const { planId, brandLimit, geoLimit } = parsed.data;

  const db = adminDb();

  const ref = db.collection("plans").doc(planId);

  const auditRef = db
    .collection("platform")
    .doc("planManagement")
    .collection("auditLogs")
    .doc();

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);

    if (snapshot.exists) {
      return failure(
        "A plan with this ID already exists.",
        409
      );
    }

    const limits = {
      brands: brandLimit,
      geoRuns: geoLimit,
    };

    transaction.create(ref, {
      limits,
    });

    transaction.create(auditRef, {
      action: "plan.created",
      planId,
      by: actor.uid,
      at: FieldValue.serverTimestamp(),
      before: null,
      after: limits,
    });

    return {
      ok: true as const,
      planId,
      changed: true,
    };
  });
}
