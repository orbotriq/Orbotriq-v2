import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

console.log("Starting emulator authorization tests...");

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8081";
process.env.GCLOUD_PROJECT = "demo-orbotriq-v2";
process.env.GOOGLE_CLOUD_PROJECT = "demo-orbotriq-v2";

delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.FIREBASE_CLIENT_EMAIL;
delete process.env.FIREBASE_PRIVATE_KEY;

const app = initializeApp(
  { projectId: "demo-orbotriq-v2" },
  "authorization-test"
);

const auth = getAuth(app);
const base = "http://localhost:8080";

try {
  const login = await fetch(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key",
    {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: "test-digital-agency@orbotriq.test",
        password: "LocalTest@2026",
        returnSecureToken: true
      })
    }
  );

  if (!login.ok) {
    throw new Error("Emulator customer login failed: HTTP " + login.status);
  }

  const credentials = await login.json();

  const session = await auth.createSessionCookie(
    credentials.idToken,
    { expiresIn: 300000 }
  );

  const decoded = await auth.verifySessionCookie(
    session,
    true
  );

  if (
    decoded.uid !== "test-digital-agency-owner" ||
    decoded.platformAdmin === true ||
    decoded.role !== "owner" ||
    decoded.orgId !== "test-digital-agency"
  ) {
    throw new Error("Unexpected test account permissions.");
  }

  console.log("PASS: Valid non-admin session confirmed.");

  const tests = [
    {
      name: "Customer cannot create organization",
      path: "/api/admin/organizations",
      method: "POST"
    },
    {
      name: "Customer cannot edit own organization",
      path: "/api/admin/organizations/test-digital-agency",
      method: "PATCH"
    },
    {
      name: "Customer cannot edit another organization",
      path: "/api/admin/organizations/test-software-company",
      method: "PATCH"
    }
  ];

  let passed = 0;

  for (const test of tests) {
    const response = await fetch(base + test.path, {
      method: test.method,
      redirect: "error",
      headers: {
        "Origin": base,
        "Content-Type": "application/json",
        "Cookie": `orbotriq_emulator_session=${session}`
      },
      body: JSON.stringify({})
    });

    const body = await response.json();

    const success =
      response.status === 403 &&
      body.error === "Access denied.";

    if (success) passed++;

    console.log(
      `${success ? "PASS" : "FAIL"}: ${test.name} - HTTP ${response.status}`
    );
  }

  console.log(`\nAuthorization tests: ${passed}/${tests.length} passed`);

  if (passed !== tests.length) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error("Test failed:", error.message);
  process.exitCode = 1;
} finally {
  await deleteApp(app);
}
