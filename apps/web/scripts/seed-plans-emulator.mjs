import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import assert from "node:assert/strict";
import net from "node:net";

const PROJECT_ID = "demo-orbotriq-v2";
const HOST = "127.0.0.1:8081";

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
      reject(new Error("Firestore emulator unavailable."));
    });
  });
}

async function main() {
  await checkPort(8081);

  process.env.FIRESTORE_EMULATOR_HOST = HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;

  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.FIREBASE_CLIENT_EMAIL;
  delete process.env.FIREBASE_PRIVATE_KEY;

  const app = initializeApp(
    { projectId: PROJECT_ID },
    "orbotriq-plan-seed"
  );

  try {
    assert.equal(app.options.projectId, PROJECT_ID);
    assert.equal(process.env.FIRESTORE_EMULATOR_HOST, HOST);

    const db = getFirestore(app);

    const fixtures = [
      {
        id: "starter",
        limits: {
          brands: 5,
          geoRuns: 50,
        },
      },
      {
        id: "professional",
        limits: {
          brands: 25,
          geoRuns: 500,
        },
      },
      {
        id: "agency",
        limits: {
          brands: 100,
          geoRuns: 2000,
        },
      },
      {
        id: "test-invalid-plan",
        limits: {
          brands: "invalid",
          geoRuns: 100,
        },
      },
    ];

    const organizationsBefore =
      await db.collection("orgs").get();

    const batch = db.batch();

    for (const fixture of fixtures) {
      const ref = db.collection("plans").doc(fixture.id);
      const snapshot = await ref.get();

      if (snapshot.exists) {
        throw new Error(
          `Plan ${fixture.id} already exists. No fixtures written.`
        );
      }

      batch.create(ref, {
        limits: fixture.limits,
      });
    }

    await batch.commit();

    for (const fixture of fixtures) {
      const snapshot = await db
        .collection("plans")
        .doc(fixture.id)
        .get();

      assert.equal(snapshot.exists, true);
      assert.deepEqual(
        snapshot.data().limits,
        fixture.limits
      );

      console.log(`PASS: Plan ${fixture.id} verified`);
    }

    const organizationsAfter =
      await db.collection("orgs").get();

    assert.equal(
      organizationsAfter.size,
      organizationsBefore.size
    );

    for (const before of organizationsBefore.docs) {
      const after = organizationsAfter.docs.find(
        (doc) => doc.id === before.id
      );

      assert.ok(after);
      assert.ok(
        before.updateTime.isEqual(after.updateTime)
      );
      assert.deepEqual(before.data(), after.data());
    }

    console.log("PASS: Existing organizations unchanged");
    console.log("");
    console.log("PLAN FIXTURES CREATED SUCCESSFULLY");
    console.log(`Project: ${PROJECT_ID}`);
    console.log(`Plans created: ${fixtures.length}`);
    console.log(
      `Organizations preserved: ${organizationsAfter.size}`
    );
  } finally {
    await deleteApp(app);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
