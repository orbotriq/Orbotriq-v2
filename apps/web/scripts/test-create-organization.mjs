import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { randomBytes } from "node:crypto";

const source = fs.readFileSync(
  "src/lib/admin/create-organization.ts",
  "utf8"
);

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const validInput = {
  name: "Provisioning Test",
  ownerEmail: "provisioning@orbotriq.test",
  trialDays: 14,
  notes: "Automated test",
};

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function setup(mode = "success") {
  const calls = [];
  const documents = [];
  const accounts = new Map();
  const logs = [];

  function ref(path) {
    return {
      id: path.split("/").pop(),
      path,
      collection(name) {
        return collection(`${path}/${name}`);
      },
    };
  }

  function collection(path) {
    return {
      doc(id = "generated-id") {
        return ref(`${path}/${id}`);
      },
    };
  }

  const auth = {
    app: {
      options: {
        projectId: "demo-orbotriq-v2",
      },
    },

    async getUserByEmail() {
      calls.push("lookup");

      if (mode === "duplicate") {
        return { uid: "existing-user" };
      }

      throw failure("auth/user-not-found");
    },

    async createUser(data) {
      calls.push("createUser");

      if (mode === "create-failure") {
        throw failure("auth/internal-error");
      }

      accounts.set(data.uid, { ...data });

      return data;
    },

    async setCustomUserClaims(uid, claims) {
      calls.push("setClaims");

      if (
        mode === "claims-failure" ||
        mode === "cleanup-failure"
      ) {
        throw failure("auth/internal-error");
      }

      accounts.get(uid).claims = claims;
    },

    async deleteUser(uid) {
      calls.push("deleteUser");

      if (mode === "cleanup-failure") {
        throw failure("auth/internal-error");
      }

      accounts.delete(uid);
    },

    async updateUser(uid, data) {
      calls.push("enableUser");

      if (mode === "enable-failure") {
        throw failure("auth/internal-error");
      }

      Object.assign(accounts.get(uid), data);
    },
  };

  const db = {
    collection,

    batch() {
      const pending = [];

      return {
        create(reference, data) {
          pending.push({
            path: reference.path,
            data,
          });
        },

        async commit() {
          calls.push("commit");

          if (mode === "commit-failure") {
            throw failure("firestore/unavailable");
          }

          documents.push(...pending);

          if (mode === "ambiguous-commit") {
            throw failure("firestore/deadline-exceeded");
          }
        },
      };
    },
  };

  const exports = {};

  vm.runInNewContext(compiled, {
    exports,
    process: {
      env: {
        FIREBASE_PROJECT_ID: "demo-orbotriq-v2",
      },
    },

    console: {
      error(...args) {
        logs.push(args);
      },
    },

    require(name) {
      switch (name) {
        case "server-only":
          return {};

        case "node:crypto":
          return { randomBytes };

        case "zod":
          return { z };

        case "firebase-admin/firestore":
          return {
            FieldValue: {
              serverTimestamp: () => "SERVER_TIMESTAMP",
            },
            Timestamp: {
              fromMillis: value => value,
            },
          };

        case "@/lib/firebase/admin":
          return {
            adminAuth: () => auth,
            adminDb: () => db,
          };

        case "@/lib/admin/write-guard":
          return {
            async requireAdminWrite() {
              if (mode === "unauthorized") {
                throw new Error("Access denied");
              }

              return { uid: "test-platform-admin" };
            },
          };

        default:
          throw new Error(`Unexpected import: ${name}`);
      }
    },
  });

  return {
    create: exports.createOrganization,
    calls,
    accounts,
    documents,
    logs,
  };
}

let passed = 0;

async function test(name, run) {
  await run();
  passed++;
  console.log(`PASS: ${name}`);
}

await test("Successful provisioning", async () => {
  const s = setup();
  const result = await s.create(validInput);

  assert.equal(result.ok, true);
  assert.equal(s.accounts.size, 1);
  assert.equal(s.documents.length, 4);

  const account = [...s.accounts.values()][0];

  assert.equal(account.disabled, false);
  assert.equal(account.claims.role, "owner");
  assert.equal(account.emailVerified, false);

  assert.equal(
    s.calls.join(","),
    "lookup,createUser,setClaims,commit,enableUser"
  );

  assert.equal(
    JSON.stringify(s.documents).includes(account.password),
    false
  );

  assert.equal("password" in result, false);
});

await test("Non-test email rejected", async () => {
  const s = setup();

  const result = await s.create({
    ...validInput,
    ownerEmail: "security@example.com",
  });

  assert.equal(result.ok, false);
  assert.equal(s.calls.length, 0);
  assert.equal(s.accounts.size, 0);
  assert.equal(s.documents.length, 0);
});

await test("Unauthorized request blocked", async () => {
  const s = setup("unauthorized");

  await assert.rejects(
    () => s.create(validInput),
    /Access denied/
  );

  assert.equal(s.calls.length, 0);
});

await test("Existing account protected", async () => {
  const s = setup("duplicate");
  const result = await s.create(validInput);

  assert.equal(result.ok, false);
  assert.equal(s.calls.join(","), "lookup");
  assert.equal(s.documents.length, 0);
});

await test("Account creation failure", async () => {
  const s = setup("create-failure");
  const result = await s.create(validInput);

  assert.equal(result.ok, false);
  assert.equal(s.accounts.size, 0);
  assert.equal(s.documents.length, 0);
  assert.equal(s.calls.includes("deleteUser"), false);
});

await test("Claims failure rolls back account", async () => {
  const s = setup("claims-failure");
  const result = await s.create(validInput);

  assert.equal(result.ok, false);
  assert.equal(s.accounts.size, 0);
  assert.equal(s.documents.length, 0);
  assert.equal(s.calls.includes("deleteUser"), true);
});

await test("Cleanup failure requires review", async () => {
  const s = setup("cleanup-failure");
  const result = await s.create(validInput);

  assert.equal(result.ok, false);
  assert.match(result.error, /Do not retry/);
  assert.equal(s.accounts.size, 1);
  assert.equal(s.documents.length, 0);
  assert.equal([...s.accounts.values()][0].disabled, true);
  assert.ok(s.logs.length > 0);
});

await test("Commit failure preserves disabled account", async () => {
  const s = setup("commit-failure");
  const result = await s.create(validInput);

  assert.equal(result.ok, false);
  assert.match(result.error, /Do not retry/);
  assert.equal(s.accounts.size, 1);
  assert.equal(s.documents.length, 0);
  assert.equal([...s.accounts.values()][0].disabled, true);
  assert.equal(s.calls.includes("deleteUser"), false);
  assert.equal(s.calls.includes("enableUser"), false);
});

await test("Ambiguous commit preserves records and owner", async () => {
  const s = setup("ambiguous-commit");
  const result = await s.create(validInput);

  assert.equal(result.ok, false);
  assert.match(result.error, /Do not retry/);
  assert.equal(s.documents.length, 4);
  assert.equal(s.accounts.size, 1);
  assert.equal([...s.accounts.values()][0].disabled, true);
  assert.equal(s.calls.includes("deleteUser"), false);
});

await test("Account enable failure requires review", async () => {
  const s = setup("enable-failure");
  const result = await s.create(validInput);

  assert.equal(result.ok, false);
  assert.match(result.error, /Do not retry/);
  assert.equal(s.documents.length, 4);
  assert.equal(s.accounts.size, 1);
  assert.equal([...s.accounts.values()][0].disabled, true);
  assert.equal(s.calls.includes("deleteUser"), false);
  assert.ok(s.logs.length > 0);
});

console.log(`\n${passed}/10 provisioning tests passed.`);
console.log("No Firebase connections or database writes performed.");
