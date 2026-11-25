import "server-only";

import {
  FieldValue,
  type Timestamp,
} from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { requireAdminWrite } from "@/lib/admin/write-guard";

import {
  isEditablePlanId,
  updatePlanSchema,
  validAllowance,
  failure,
} from "@/lib/admin/plan-validation";

function versionOf(value: Timestamp): string {
  return `${value.seconds}:${value.nanoseconds}`;
}

function isMap(
  value: unknown
): value is Record<string, unknown> {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

export async function getPlanForEdit(planId: string) {
  await requireAdminWrite();

  if (!isEditablePlanId(planId)) {
    return null;
  }

  const snapshot = await adminDb()
    .collection("plans")
    .doc(planId)
    .get();

  if (!snapshot.exists || !snapshot.updateTime) {
    return null;
  }

  const data = snapshot.data();

  const limits = isMap(data?.limits)
    ? data.limits
    : {};

  return {
    planId,
    brandLimit: validAllowance(limits.brands),
    geoLimit: validAllowance(limits.geoRuns),
    version: versionOf(snapshot.updateTime),
  };
}

export async function updatePlan(
  planId: string,
  input: unknown
) {
  const actor = await requireAdminWrite();

  if (!isEditablePlanId(planId)) {
    return failure(
      "Invalid or protected plan ID."
    );
  }

  const parsed = updatePlanSchema.safeParse(input);

  if (!parsed.success) {
    return failure(
      parsed.error.issues[0]?.message ||
      "Invalid plan configuration."
    );
  }

  const values = parsed.data;

  const db = adminDb();

  const ref = db.collection("plans").doc(planId);

  const auditRef = db
    .collection("platform")
    .doc("planManagement")
    .collection("auditLogs")
    .doc();

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);

    if (!snapshot.exists || !snapshot.updateTime) {
      return failure("Plan not found.", 404);
    }

    if (versionOf(snapshot.updateTime) !== values.version) {
      return failure(
        "This plan has changed. Reload before editing.",
        409
      );
    }

    const data = snapshot.data();

    const rawLimits = data?.limits;

    if (
      rawLimits !== undefined &&
      !isMap(rawLimits)
    ) {
      return failure(
        "Malformed limits structure requires review.",
        409
      );
    }

    const limits = isMap(rawLimits)
      ? rawLimits
      : {};

    const before = {
      brands: validAllowance(limits.brands),
      geoRuns: validAllowance(limits.geoRuns),
    };

    const after = {
      brands: values.brandLimit,
      geoRuns: values.geoLimit,
    };

    const updates: Record<string, number> = {};

    if (limits.brands !== after.brands) {
      updates["limits.brands"] = after.brands;
    }

    if (limits.geoRuns !== after.geoRuns) {
      updates["limits.geoRuns"] = after.geoRuns;
    }

    const fields = Object.keys(updates);

    if (fields.length === 0) {
      return {
        ok: true as const,
        planId,
        changed: false,
      };
    }

    transaction.update(ref, updates);

    transaction.create(auditRef, {
      action: "plan.updated",
      planId,
      by: actor.uid,
      at: FieldValue.serverTimestamp(),
      fields,
      before,
      after,
    });

    return {
      ok: true as const,
      planId,
      changed: true,
    };
  });
}
