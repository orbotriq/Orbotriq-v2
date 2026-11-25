import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { adminDb } from "@/lib/firebase/admin";
import { requireAdminWrite } from "@/lib/admin/write-guard";

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  notes: z.string().trim().max(500),
  brandLimit: z.number().int().min(0).max(10000),
  geoLimit: z.number().int().min(0).max(1000000),
  extendDays: z.number().int().min(0).max(90),
  version: z.string().regex(/^\d+:\d+$/),
}).strict();

function validId(value: string): boolean {
  return (
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= 1500 &&
    !value.includes("/") &&
    value !== "." &&
    value !== ".."
  );
}

function versionOf(value: Timestamp): string {
  return `${value.seconds}:${value.nanoseconds}`;
}

function failure(error: string, status = 400) {
  return { ok: false as const, error, status };
}

export async function getOrganizationForEdit(orgId: string) {
  await requireAdminWrite();

  if (!validId(orgId)) return null;

  const snapshot = await adminDb()
    .collection("orgs")
    .doc(orgId)
    .get();

  if (!snapshot.exists || !snapshot.updateTime) return null;

  const data = snapshot.data()!;

  return {
    id: snapshot.id,
    name: typeof data.name === "string" ? data.name : "",
    notes: typeof data.notes === "string" ? data.notes : "",
    ownerEmail: typeof data.ownerEmail === "string"
      ? data.ownerEmail : "-",
    ownerUid: typeof data.ownerUid === "string"
      ? data.ownerUid : "-",
    plan: typeof data.plan === "string" ? data.plan : "-",
    status: typeof data.status === "string" ? data.status : "-",
    brandLimit: typeof data.limits?.institutions === "number"
      ? data.limits.institutions : null,
    geoLimit: typeof data.limits?.geoRuns === "number"
      ? data.limits.geoRuns : null,
    institutionCount: typeof data.institutionCount === "number"
      ? data.institutionCount : null,
    trialEndsAt: data.trialEndsAt instanceof Timestamp
      ? data.trialEndsAt.toDate().toISOString() : null,
    canExtendTrial:
      data.plan === "trial" &&
      data.status === "trialing" &&
      data.isDemo !== true,
    version: versionOf(snapshot.updateTime),
  };
}

export async function updateOrganization(
  orgId: string,
  input: unknown
) {
  const actor = await requireAdminWrite();

  if (!validId(orgId)) {
    return failure("Invalid organization ID.");
  }

  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    return failure("Check the organization name, notes, limits and trial extension.");
  }

  const values = parsed.data;
  const db = adminDb();
  const ref = db.collection("orgs").doc(orgId);
  const auditRef = ref.collection("auditLogs").doc();

  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);

    if (!snapshot.exists || !snapshot.updateTime) {
      return failure("Organization not found.", 404);
    }

    if (versionOf(snapshot.updateTime) !== values.version) {
      return failure(
        "Organization changed since you opened this form. Reload before editing.",
        409
      );
    }

    const current = snapshot.data()!;

    if (
      !Number.isSafeInteger(current.institutionCount) ||
      current.institutionCount < 0
    ) {
      return failure(
        "Current brand usage requires administrator review.",
        409
      );
    }

    if (values.brandLimit < current.institutionCount) {
      return failure(
        "Brand limit cannot be lower than current brand usage."
      );
    }

    // Match the legacy UTC calendar-month quota period.
    const currentMonth = new Date().toISOString().slice(0, 7);
    const usage = current.usage;

    let geoUsed = 0;

    if (usage !== undefined) {
      if (
        usage === null ||
        typeof usage !== "object" ||
        Array.isArray(usage) ||
        Object.getPrototypeOf(usage) !== Object.prototype
      ) {
        return failure(
          "Current GEO usage requires administrator review.",
          409
        );
      }

      if (usage.month === undefined) {
        if (Object.keys(usage).length > 0) {
          return failure(
            "Current GEO usage period requires administrator review.",
            409
          );
        }
      } else {
        if (
          typeof usage.month !== "string" ||
          !/^\d{4}-(0[1-9]|1[0-2])$/.test(usage.month) ||
          usage.month > currentMonth
        ) {
          return failure(
            "Current GEO usage period requires administrator review.",
            409
          );
        }

        if (usage.month === currentMonth) {
          const consumed =
            usage.geoRuns === undefined ? 0 : usage.geoRuns;

          if (
            !Number.isSafeInteger(consumed) ||
            consumed < 0
          ) {
            return failure(
              "Current GEO usage requires administrator review.",
              409
            );
          }

          geoUsed = consumed;
        }
      }
    }

    if (values.geoLimit < geoUsed) {
      return failure(
        `GEO allowance cannot be lower than current monthly usage (${geoUsed}).`
      );
    }

    const updates: Record<string, string | number | Timestamp> = {};
    const fields: string[] = [];

    if (values.name !== current.name) {
      updates.name = values.name;
      fields.push("name");
    }

    if (values.notes !== (current.notes ?? "")) {
      updates.notes = values.notes;
      fields.push("notes");
    }

    if (values.brandLimit !== current.limits?.institutions) {
      updates["limits.institutions"] = values.brandLimit;
      fields.push("limits.institutions");
    }

    if (values.geoLimit !== current.limits?.geoRuns) {
      updates["limits.geoRuns"] = values.geoLimit;
      fields.push("limits.geoRuns");
    }

    if (values.extendDays > 0) {
      if (
        current.plan !== "trial" ||
        current.status !== "trialing" ||
        current.isDemo === true
      ) {
        return failure(
          "Trial extensions are available only for trialing organizations."
        );
      }

      if (!(current.trialEndsAt instanceof Timestamp)) {
        return failure(
          "Current trial expiry requires administrator review.",
          409
        );
      }

      const base = Math.max(
        Date.now(),
        current.trialEndsAt.toMillis()
      );

      updates.trialEndsAt = Timestamp.fromMillis(
        base + values.extendDays * 86400000
      );

      fields.push("trialEndsAt");
    }

    if (fields.length === 0) {
      return {
        ok: true as const,
        changed: false,
        orgId,
      };
    }

    transaction.update(ref, updates);

    transaction.create(auditRef, {
      action: "org.updated_by_admin",
      by: actor.uid,
      fields,
      at: FieldValue.serverTimestamp(),
    });

    return {
      ok: true as const,
      changed: true,
      orgId,
    };
  });
}
