import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(
  "src/lib/admin/write-guard.ts",
  "utf8"
);

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const safeEnv = {
  NODE_ENV: "development",
  ORBOTRIQ_FIREBASE_MODE: "emulator",
  NEXT_PUBLIC_FIREBASE_MODE: "emulator",
  FIREBASE_PROJECT_ID: "demo-orbotriq-v2",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-orbotriq-v2",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8081",
};

function loadGuard(env, authorized = true) {
  const exports = {};
  let authCalls = 0;

  vm.runInNewContext(compiled, {
    exports,
    process: { env },
    require(name) {
      if (name === "server-only") return {};

      if (name === "@/lib/auth/guard") {
        return {
          async requirePlatformAdmin() {
            authCalls++;

            if (!authorized) {
              throw new Error("Access denied");
            }

            return { uid: "test-platform-admin" };
          },
        };
      }

      throw new Error(`Unexpected import: ${name}`);
    },
  });

  return {
    ...exports,
    authCalls: () => authCalls,
  };
}

const tests = [
  ["Valid emulator configuration", {}, true],
  ["Production mode", { NODE_ENV: "production" }, false],
  ["Missing server mode", { ORBOTRIQ_FIREBASE_MODE: "" }, false],
  ["Missing client mode", { NEXT_PUBLIC_FIREBASE_MODE: "" }, false],
  ["Production project", { FIREBASE_PROJECT_ID: "vaanio-app" }, false],
  ["Wrong client project", { NEXT_PUBLIC_FIREBASE_PROJECT_ID: "vaanio-app" }, false],
  ["Missing Auth emulator", { FIREBASE_AUTH_EMULATOR_HOST: "" }, false],
  ["Wrong Auth endpoint", { FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9999" }, false],
  ["Missing Firestore emulator", { FIRESTORE_EMULATOR_HOST: "" }, false],
  ["Wrong Firestore endpoint", { FIRESTORE_EMULATOR_HOST: "127.0.0.1:9999" }, false],
];

let passed = 0;

for (const [name, overrides, expected] of tests) {
  const guard = loadGuard({
    ...safeEnv,
    ...overrides,
  });

  assert.equal(
    guard.isAdminWriteEnabled(),
    expected,
    name
  );

  if (expected) {
    const actor = await guard.requireAdminWrite();

    assert.equal(actor.uid, "test-platform-admin");
    assert.equal(guard.authCalls(), 1);
  } else {
    await assert.rejects(
      () => guard.requireAdminWrite(),
      /Administrative writes are disabled/
    );

    assert.equal(guard.authCalls(), 0);
  }

  passed++;
  console.log(`PASS: ${name}`);
}

const denied = loadGuard(safeEnv, false);

await assert.rejects(
  () => denied.requireAdminWrite(),
  /Access denied/
);

passed++;
console.log("PASS: Unauthorized administrator rejected");

console.log(`\n${passed}/${tests.length + 1} security tests passed.`);
console.log("No Firebase connections or database writes performed.");
