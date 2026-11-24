import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import net from "node:net";

const PROJECT_ID = "demo-orbotriq-v2";

function checkPort(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: "127.0.0.1",
      port,
    });

    socket.setTimeout(3000);

    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });

    socket.once("error", reject);

    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`Emulator port ${port} unavailable`));
    });
  });
}

async function main() {
  await checkPort(9099);
  await checkPort(8081);

  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8081";
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
  process.env.FIREBASE_PROJECT_ID = PROJECT_ID;

  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.FIREBASE_CLIENT_EMAIL;
  delete process.env.FIREBASE_PRIVATE_KEY;

  const app = initializeApp({
    projectId: PROJECT_ID,
  }, "orbotriq-test-seed");

  const auth = getAuth(app);
  const db = getFirestore(app);

  try {
    if (app.options.projectId !== PROJECT_ID) {
      throw new Error("Unsafe project configuration.");
    }

    const password = "LocalTest@2026";

    async function ensureUser(uid, email, name, claims) {
      try {
        await auth.getUser(uid);

        await auth.updateUser(uid, {
          email,
          password,
          displayName: name,
          emailVerified: true,
          disabled: false,
        });
      } catch (error) {
        if (error.code !== "auth/user-not-found") {
          throw error;
        }

        await auth.createUser({
          uid,
          email,
          password,
          displayName: name,
          emailVerified: true,
        });
      }

      await auth.setCustomUserClaims(uid, claims);

      return uid;
    }

    await ensureUser(
      "test-platform-admin",
      "admin@orbotriq.test",
      "Test Super Admin",
      { platformAdmin: true }
    );

    const organizations = [
      {
        id: "test-digital-agency",
        name: "Test Digital Agency",
        plan: "trial",
        status: "trialing",
        isDemo: false,
        brands: 1,
        brandLimit: 2,
        geoLimit: 5,
      },
      {
        id: "test-software-company",
        name: "Test Software Company",
        plan: "professional",
        status: "active",
        isDemo: false,
        brands: 8,
        brandLimit: 25,
        geoLimit: 500,
      },
      {
        id: "test-demo-workspace",
        name: "Test Demo Workspace",
        plan: "demo",
        status: "demo",
        isDemo: true,
        brands: 3,
        brandLimit: 5,
        geoLimit: 50,
      },
      {
        id: "test-suspended-company",
        name: "Test Suspended Company",
        plan: "professional",
        status: "suspended",
        isDemo: false,
        brands: 4,
        brandLimit: 25,
        geoLimit: 500,
      },
    ];

    for (const org of organizations) {
      const uid = `${org.id}-owner`;
      const email = `${org.id}@orbotriq.test`;

      await ensureUser(uid, email, org.name, {
        orgId: org.id,
        role: "owner",
      });

      const ref = db.collection("orgs").doc(org.id);
      const batch = db.batch();

      batch.set(ref, {
        name: org.name,
        ownerUid: uid,
        ownerEmail: email,
        plan: org.plan,
        status: org.status,
        isDemo: org.isDemo,
        institutionCount: org.brands,
        limits: {
          institutions: org.brandLimit,
          geoRuns: org.geoLimit,
        },
        usage: {},
        brandColor: "#39c6d8",
        createdAt: FieldValue.serverTimestamp(),
        createdBy: "test-platform-admin",
        trialEndsAt: org.plan === "trial"
          ? Timestamp.fromMillis(Date.now() + 14 * 86400000)
          : null,
        paidUntil: org.plan === "professional"
          ? Timestamp.fromMillis(Date.now() + 30 * 86400000)
          : null,
      }, { merge: true });

      batch.set(ref.collection("members").doc(uid), {
        email,
        role: "owner",
        mustChangePassword: false,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      batch.set(db.collection("users").doc(uid), {
        email,
        displayName: org.name,
        orgId: org.id,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      batch.set(ref.collection("auditLogs").doc("seed-created"), {
        action: org.isDemo
          ? "org.demo_created"
          : "org.created_by_admin",
        by: "test-platform-admin",
        at: FieldValue.serverTimestamp(),
      });

      await batch.commit();

      console.log(`Created test organization: ${org.name}`);
    }

    // Seed enough events to test audit pagination.
    const audit = db.collection("orgs")
      .doc("test-digital-agency")
      .collection("auditLogs");

    const batch = db.batch();

    for (let i = 1; i <= 60; i++) {
      batch.set(audit.doc(`test-event-${i}`), {
        action: "org.updated_by_admin",
        by: "test-platform-admin",
        fields: ["name", "limits"],
        at: Timestamp.fromMillis(Date.now() - i * 3600000),
      });
    }

    await batch.commit();

    console.log("");
    console.log("LOCAL EMULATOR SEED COMPLETE");
    console.log(`Project: ${PROJECT_ID}`);
    console.log("Test accounts: 5");
    console.log("Test organizations: 4");
    console.log("Test audit events: 64");
  } finally {
    await deleteApp(app);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
