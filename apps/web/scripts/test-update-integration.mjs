import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const PROJECT = "demo-orbotriq-v2";
const BASE = "http://localhost:8080";

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8081";
process.env.GCLOUD_PROJECT = PROJECT;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT;
process.env.FIREBASE_PROJECT_ID = PROJECT;

delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.FIREBASE_CLIENT_EMAIL;
delete process.env.FIREBASE_PRIVATE_KEY;

const app = initializeApp(
  { projectId: PROJECT },
  "organization-update-integration"
);

const auth = getAuth(app);
const db = getFirestore(app);

assert.equal(app.options.projectId, PROJECT);
assert.equal(
  process.env.FIRESTORE_EMULATOR_HOST,
  "127.0.0.1:8081"
);

const orgId = `integration-update-${randomUUID()}`;
const ref = db.collection("orgs").doc(orgId);
const DAY = 86400000;
const month = new Date().toISOString().slice(0, 7);

let session;
let created = false;
let passed = 0;

async function test(name, run) {
  await run();
  passed++;
  console.log(`PASS: ${name}`);
}

async function login() {
  const response = await fetch(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key",
    {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "admin@orbotriq.test",
        password: "LocalTest@2026",
        returnSecureToken: true,
      }),
    }
  );

  assert.equal(response.status, 200);

  const data = await response.json();

  session = await auth.createSessionCookie(
    data.idToken,
    { expiresIn: 300000 }
  );

  const decoded = await auth.verifySessionCookie(
    session,
    true
  );

  assert.equal(decoded.uid, "test-platform-admin");
  assert.equal(decoded.platformAdmin, true);
  assert.equal(decoded.email_verified, true);
}

async function snapshot() {
  const doc = await ref.get();

  assert.equal(doc.exists, true);

  return doc;
}

async function payload(overrides = {}) {
  const doc = await snapshot();
  const data = doc.data();

  return {
    name: data.name,
    notes: data.notes ?? "",
    brandLimit: data.limits.institutions,
    geoLimit: data.limits.geoRuns,
    extendDays: 0,
    version: `${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}`,
    ...overrides,
  };
}

async function patch(input) {
  const response = await fetch(
    `${BASE}/api/admin/organizations/${orgId}`,
    {
      method: "PATCH",
      redirect: "error",
      headers: {
        Origin: BASE,
        "Content-Type": "application/json",
        Cookie: `orbotriq_emulator_session=${session}`,
      },
      body: JSON.stringify(input),
    }
  );

  return {
    status: response.status,
    body: await response.json(),
  };
}

async function auditCount() {
  const docs = await ref.collection("auditLogs").get();
  return docs.size;
}

async function rejectWithoutWrites(
  input,
  status,
  message
) {
  const before = await snapshot();
  const count = await auditCount();

  const result = await patch(input);

  assert.equal(
    result.status,
    status,
    JSON.stringify(result.body)
  );

  assert.match(result.body.error, message);

  const after = await snapshot();

  assert.equal(
    after.updateTime.isEqual(before.updateTime),
    true
  );

  assert.deepEqual(after.data(), before.data());
  assert.equal(await auditCount(), count);
}

try {
  console.log("Starting isolated emulator integration tests...");

  await login();

  console.log("Verified emulator platform administrator.");

  await ref.create({
    name: "Integration Test Organization",
    notes: "",
    ownerEmail: "integration@orbotriq.test",
    ownerUid: "integration-placeholder-owner",
    plan: "trial",
    status: "trialing",
    isDemo: false,
    institutionCount: 3,
    limits: {
      institutions: 5,
      geoRuns: 50,
      otherLimit: 25,
    },
    usage: {
      month,
      geoRuns: 35,
      otherCounter: 7,
    },
    trialEndsAt: Timestamp.fromMillis(
      Date.now() + 14 * DAY
    ),
    paidUntil: null,
    createdAt: Timestamp.now(),
  });

  created = true;

  console.log(`Temporary organization: ${orgId}`);

  await test("Successful update persists in Firestore", async () => {
    const result = await patch(await payload({
      name: "Integration Updated",
      notes: "Integration test notes",
      brandLimit: 10,
      geoLimit: 100,
    }));

    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.changed, true);

    const data = (await snapshot()).data();

    assert.equal(data.name, "Integration Updated");
    assert.equal(data.notes, "Integration test notes");
    assert.equal(data.limits.institutions, 10);
    assert.equal(data.limits.geoRuns, 100);
  });

  await test("Protected organization fields preserved", async () => {
    const data = (await snapshot()).data();

    assert.equal(data.ownerUid, "integration-placeholder-owner");
    assert.equal(data.ownerEmail, "integration@orbotriq.test");
    assert.equal(data.plan, "trial");
    assert.equal(data.status, "trialing");
    assert.equal(data.isDemo, false);
    assert.equal(data.institutionCount, 3);
    assert.equal(data.paidUntil, null);
    assert.equal(data.limits.otherLimit, 25);
  });

  await test("Monthly usage and other counters preserved", async () => {
    const data = (await snapshot()).data();

    assert.deepEqual(data.usage, {
      month,
      geoRuns: 35,
      otherCounter: 7,
    });
  });

  await test("Audit record persisted with correct actor", async () => {
    const docs = await ref.collection("auditLogs").get();

    assert.equal(docs.size, 1);

    const audit = docs.docs[0].data();

    assert.equal(audit.action, "org.updated_by_admin");
    assert.equal(audit.by, "test-platform-admin");
    assert.ok(audit.at instanceof Timestamp);

    assert.deepEqual(audit.fields.sort(), [
      "limits.geoRuns",
      "limits.institutions",
      "name",
      "notes",
    ]);
  });

  await test("GEO allowance below usage rejected", async () => {
    await rejectWithoutWrites(
      await payload({ geoLimit: 20 }),
      400,
      /GEO allowance cannot/
    );
  });

  await test("GEO allowance equal to usage accepted", async () => {
    const result = await patch(
      await payload({ geoLimit: 35 })
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.changed, true);

    const data = (await snapshot()).data();

    assert.equal(data.limits.geoRuns, 35);
    assert.equal(data.usage.geoRuns, 35);
    assert.equal(await auditCount(), 2);
  });

  await test("Brand limit below usage rejected", async () => {
    await rejectWithoutWrites(
      await payload({ brandLimit: 2 }),
      400,
      /Brand limit cannot/
    );
  });

  await test("Unchanged submission creates no writes", async () => {
    const before = await snapshot();
    const count = await auditCount();

    const result = await patch(await payload());

    assert.equal(result.status, 200);
    assert.equal(result.body.changed, false);

    const after = await snapshot();

    assert.equal(
      after.updateTime.isEqual(before.updateTime),
      true
    );

    assert.equal(await auditCount(), count);
  });

  await test("Stale edit rejected without database writes", async () => {
    const stale = await payload({
      name: "Stale edit",
    });

    const result = await patch(
      await payload({ name: "Latest edit" })
    );

    assert.equal(result.status, 200);

    await rejectWithoutWrites(
      stale,
      409,
      /Organization changed/
    );
  });

  await test("Concurrent edits allow exactly one update", async () => {
    const base = await payload();
    const count = await auditCount();

    const results = await Promise.all([
      patch({ ...base, name: "Concurrent A" }),
      patch({ ...base, name: "Concurrent B" }),
    ]);

    assert.deepEqual(
      results.map(r => r.status).sort(),
      [200, 409]
    );

    const data = (await snapshot()).data();

    assert.ok(
      ["Concurrent A", "Concurrent B"].includes(data.name)
    );

    assert.equal(await auditCount(), count + 1);
  });

  await test("Trial extension persisted exactly once", async () => {
    const before = (await snapshot()).data();
    const input = await payload({ extendDays: 7 });
    const count = await auditCount();

    const result = await patch(input);

    assert.equal(result.status, 200);

    const after = (await snapshot()).data();

    assert.equal(
      after.trialEndsAt.toMillis(),
      before.trialEndsAt.toMillis() + 7 * DAY
    );

    assert.equal(await auditCount(), count + 1);

    await rejectWithoutWrites(
      input,
      409,
      /Organization changed/
    );
  });

  await test("Paid organization cannot extend trial", async () => {
    await ref.update({
      plan: "professional",
      status: "active",
    });

    await rejectWithoutWrites(
      await payload({ extendDays: 7 }),
      400,
      /Trial extensions/
    );
  });

  await test("Previous month usage does not block allowance", async () => {
    const previous = new Date();

    previous.setUTCDate(1);
    previous.setUTCMonth(previous.getUTCMonth() - 1);

    const oldUsage = {
      month: previous.toISOString().slice(0, 7),
      geoRuns: 35,
      otherCounter: 7,
    };

    await ref.update({ usage: oldUsage });

    const result = await patch(
      await payload({ geoLimit: 10 })
    );

    assert.equal(result.status, 200);

    const data = (await snapshot()).data();

    assert.equal(data.limits.geoRuns, 10);
    assert.deepEqual(data.usage, oldUsage);
  });

  await test("Malformed usage rejected without writes", async () => {
    await ref.update({
      usage: {
        month,
        geoRuns: "35",
      },
    });

    await rejectWithoutWrites(
      await payload({ geoLimit: 100 }),
      409,
      /Current GEO usage/
    );
  });

  await test("Protected field injection rejected", async () => {
    await rejectWithoutWrites(
      await payload({ ownerUid: "unauthorized-owner" }),
      400,
      /Check the organization/
    );
  });

  console.log(`\n${passed}/15 integration tests passed.`);
} catch (error) {
  console.error(`FAIL after ${passed} successful tests.`);
  console.error(error.message);
  process.exitCode = 1;
} finally {
  try {
    if (created) {
      assert.ok(orgId.startsWith("integration-update-"));
      assert.equal(app.options.projectId, PROJECT);

      await db.recursiveDelete(ref);

      const remaining = await ref.get();
      const audits = await ref.collection("auditLogs").get();

      assert.equal(remaining.exists, false);
      assert.equal(audits.empty, true);

      console.log("Temporary organization and audits removed.");
    }
  } catch (error) {
    console.error(`Cleanup failed for ${orgId}: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await deleteApp(app);
  }
}
