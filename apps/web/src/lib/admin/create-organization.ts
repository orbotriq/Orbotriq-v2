import "server-only";
import { randomBytes } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { requireAdminWrite } from "@/lib/admin/write-guard";

import { loadProvisioningForWrite } from "./platform-provisioning";
import { workspaceDefaults } from "./platform-provisioning-view";

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  ownerEmail: z.string()
    .trim()
    .toLowerCase()
    .email()
    .max(254)
    .refine(email => email.endsWith(".test"), {
      message: "Use a fictional .test email in emulator mode.",
    }),
  trialDays: z.number().int().min(1).max(90),
  notes: z.string().trim().max(500),
}).strict();

export async function createOrganization(input: unknown, demo = false) {
  const actor = await requireAdminWrite();

  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false as const,
      error: "Check the organization name, email, trial days and notes.",
    };
  }

  const { name, ownerEmail, trialDays, notes } = parsed.data;

  const auth = adminAuth();
  const db = adminDb();

  if (
    auth.app.options.projectId !== "demo-orbotriq-v2" ||
    process.env.FIREBASE_PROJECT_ID !== "demo-orbotriq-v2"
  ) {
    throw new Error("Unsafe provisioning project.");
  }

  const defaults = workspaceDefaults(await loadProvisioningForWrite(), demo);

  try {
    await auth.getUserByEmail(ownerEmail);

    return {
      ok: false as const,
      error: "An account already exists with this email address.",
    };
  } catch (error) {
    if (
      (error as { code?: string }).code !== "auth/user-not-found"
    ) {
      throw error;
    }
  }

  const orgRef = db.collection("orgs").doc();
  const uid = `owner-${orgRef.id}`;

  const password =
    `Ob${randomBytes(24).toString("base64url")}#7`;

  let accountCreated = false;
  let commitAttempted = false;

  try {
    await auth.createUser({
      uid,
      email: ownerEmail,
      password,
      displayName: name,
      emailVerified: false,
      disabled: true,
    });

    accountCreated = true;

    await auth.setCustomUserClaims(uid, {
      orgId: orgRef.id,
      role: "owner",
    });

    const batch = db.batch();

    batch.create(orgRef, {
      name,
      ownerUid: uid,
      ownerEmail,
      plan: demo ? "demo" : "trial",
      status: demo ? "demo" : "trialing",
      isDemo: demo,
      trialEndsAt: Timestamp.fromMillis(
        Date.now() + trialDays * 86400000
      ),
      paidUntil: null,
      limits: {
        institutions: defaults.brands,
        geoRuns: defaults.geo,
      },
      usage: {},
      institutionCount: 0,
      notes,
      logoUrl: "",
      brandColor: "#22d3ee",
      createdBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    batch.create(
      orgRef.collection("members").doc(uid),
      {
        email: ownerEmail,
        role: "owner",
        mustChangePassword: true,
        createdAt: FieldValue.serverTimestamp(),
      }
    );

    batch.create(
      db.collection("users").doc(uid),
      {
        email: ownerEmail,
        displayName: name,
        orgId: orgRef.id,
        createdAt: FieldValue.serverTimestamp(),
      }
    );

    batch.create(
      orgRef.collection("auditLogs").doc(),
      {
        action: demo ? "org.demo_created" : "org.created_by_admin",
        by: actor.uid,
        at: FieldValue.serverTimestamp(),
      }
    );

    commitAttempted = true;

    await batch.commit();

    await auth.updateUser(uid, {
      disabled: false,
    });

    return {
      ok: true as const,
      orgId: orgRef.id,
    };
  } catch (error) {
    const code = (error as { code?: string }).code;

    if (accountCreated && !commitAttempted) {
      try {
        await auth.deleteUser(uid);
      } catch {
        console.error(
          "Provisioning cleanup required:",
          uid,
          orgRef.id
        );

        return {
          ok: false as const,
          error: "Provisioning requires administrator review. Do not retry.",
        };
      }
    }

    if (commitAttempted) {
      console.error(
        "Provisioning reconciliation required:",
        uid,
        orgRef.id,
        code
      );

      return {
        ok: false as const,
        error: "Provisioning may be incomplete. Administrator review required. Do not retry.",
      };
    }

    if (code === "auth/email-already-exists") {
      return {
        ok: false as const,
        error: "An account already exists with this email address.",
      };
    }

    console.error("Organization provisioning failed:", uid, code);

    return {
      ok: false as const,
      error: "Unable to create organization. Check the server logs.",
    };
  }
}
