import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

const source = fs.readFileSync(
  "src/lib/admin/update-organization.ts",
  "utf8"
);

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 25, 12);
const MONTH = "2026-11";

class TestDate extends Date {
  constructor(...args) {
    super(...(args.length ? args : [NOW]));
  }

  static now() {
    return NOW;
  }
}

class Timestamp {
  constructor(milliseconds) {
    this.milliseconds = milliseconds;
    this.seconds = Math.floor(milliseconds / 1000);
    this.nanoseconds = (milliseconds % 1000) * 1000000;
  }

  static fromMillis(value) {
    return new Timestamp(value);
  }

  toMillis() {
    return this.milliseconds;
  }

  toDate() {
    return new Date(this.milliseconds);
  }
}

const version = new Timestamp(NOW);

const validInput = {
  name: "Updated Organization",
  notes: "Updated notes",
  brandLimit: 10,
  geoLimit: 100,
  extendDays: 0,
  version: `${version.seconds}:${version.nanoseconds}`,
};

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function setup(options = {}) {
  const current = {
    name: "Original Organization",
    notes: "",
    ownerEmail: "owner@orbotriq.test",
    ownerUid: "original-owner",
    plan: "trial",
    status: "trialing",
    isDemo: false,
    institutionCount: 3,
    limits: {
      institutions: 5,
      geoRuns: 50,
      otherLimit: 25,
    },
    usage: {},
    trialEndsAt: Timestamp.fromMillis(NOW + 14 * DAY),
    ...options.current,
  };

  const before = plain(current);
  const calls = [];
  const committed = [];
  const exports = {};

  function ref(path) {
    return {
      path,
      id: path.split("/").pop(),

      collection(name) {
        return collection(`${path}/${name}`);
      },
    };
  }

  function collection(path) {
    return {
      doc(id = "generated-audit-id") {
        return ref(`${path}/${id}`);
      },
    };
  }

  const db = {
    collection,

    async runTransaction(callback) {
      calls.push("transaction");

      const pending = [];

      const result = await callback({
        async get(reference) {
          calls.push("get");

          return {
            id: reference.id,
            exists: options.mode !== "missing",
            updateTime: version,
            data: () => current,
          };
        },

        update(reference, data) {
          calls.push("update");

          if (options.mode === "update-failure") {
            throw new Error("Simulated update failure");
          }

          pending.push({
            type: "update",
            path: reference.path,
            data,
          });
        },

        create(reference, data) {
          calls.push("audit");

          if (options.mode === "audit-failure") {
            throw new Error("Simulated audit failure");
          }

          pending.push({
            type: "create",
            path: reference.path,
            data,
          });
        },
      });

      if (options.mode === "commit-failure") {
        throw new Error("Simulated commit failure");
      }

      committed.push(...pending);

      return result;
    },
  };

  vm.runInNewContext(compiled, {
    exports,
    Buffer,
    Date: TestDate,
    Object,

    require(name) {
      switch (name) {
        case "server-only":
          return {};

        case "zod":
          return { z };

        case "firebase-admin/firestore":
          return {
            Timestamp,
            FieldValue: {
              serverTimestamp: () => "SERVER_TIMESTAMP",
            },
          };

        case "@/lib/firebase/admin":
          return {
            adminDb() {
              calls.push("adminDb");
              return db;
            },
          };

        case "@/lib/admin/write-guard":
          return {
            async requireAdminWrite() {
              if (options.mode === "unauthorized") {
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
    current,
    before,
    calls,
    committed,

    update(input = validInput, id = "test-org") {
      return exports.updateOrganization(id, input);
    },
  };
}

const tests = [];

function test(name, run) {
  tests.push({ name, run });
}

function unchanged(s) {
  assert.equal(s.committed.length, 0);
  assert.deepEqual(plain(s.current), s.before);
}

function successful(s, result) {
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(s.committed.length, 2);

  const [update, audit] = s.committed;

  assert.equal(update.type, "update");
  assert.equal(update.path, "orgs/test-org");

  assert.equal(audit.type, "create");
  assert.equal(
    audit.path,
    "orgs/test-org/auditLogs/generated-audit-id"
  );

  assert.equal(audit.data.action, "org.updated_by_admin");
  assert.equal(audit.data.by, "test-platform-admin");
  assert.equal(audit.data.at, "SERVER_TIMESTAMP");

  assert.deepEqual(
    [...audit.data.fields].sort(),
    Object.keys(update.data).sort()
  );

  assert.deepEqual(plain(s.current), s.before);
}

async function rejected(s, input, status, message) {
  const result = await s.update(input);

  assert.equal(result.ok, false);
  assert.equal(result.status, status);
  assert.match(result.error, message);

  unchanged(s);
}

test("Successful update and audit attribution", async () => {
  const s = setup();
  const result = await s.update();

  successful(s, result);

  assert.deepEqual(plain(s.committed[0].data), {
    name: "Updated Organization",
    notes: "Updated notes",
    "limits.institutions": 10,
    "limits.geoRuns": 100,
  });
});

test("Protected fields and nested limits preserved", async () => {
  const s = setup();
  const result = await s.update();

  successful(s, result);

  const keys = Object.keys(s.committed[0].data);

  for (const field of [
    "ownerEmail",
    "ownerUid",
    "plan",
    "status",
    "isDemo",
    "institutionCount",
    "usage",
    "limits",
    "limits.otherLimit",
    "paidUntil",
  ]) {
    assert.equal(keys.includes(field), false);
  }
});

test("Unchanged submission creates no audit", async () => {
  const s = setup();

  const result = await s.update({
    ...validInput,
    name: s.current.name,
    notes: s.current.notes,
    brandLimit: s.current.limits.institutions,
    geoLimit: s.current.limits.geoRuns,
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, false);

  unchanged(s);
});

test("Unauthorized administrator rejected", async () => {
  const s = setup({ mode: "unauthorized" });

  await assert.rejects(
    () => s.update(),
    /Access denied/
  );

  assert.equal(s.calls.length, 0);
  unchanged(s);
});

test("Invalid organization ID rejected", async () => {
  const s = setup();
  const result = await s.update(validInput, "../invalid");

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(s.calls.length, 0);

  unchanged(s);
});

test("Protected field injection rejected", async () => {
  const s = setup();

  await rejected(
    s,
    { ...validInput, ownerUid: "attacker" },
    400,
    /Check the organization/
  );

  assert.equal(s.calls.length, 0);
});

test("Invalid numeric input rejected", async () => {
  const s = setup();

  await rejected(
    s,
    { ...validInput, geoLimit: -1 },
    400,
    /Check the organization/
  );

  assert.equal(s.calls.length, 0);
});

test("Missing organization rejected", async () => {
  const s = setup({ mode: "missing" });

  await rejected(
    s,
    validInput,
    404,
    /Organization not found/
  );
});

test("Stale version rejected", async () => {
  const s = setup();

  await rejected(
    s,
    { ...validInput, version: "0:0" },
    409,
    /Organization changed/
  );
});

test("Brand limit below usage rejected", async () => {
  const s = setup();

  await rejected(
    s,
    { ...validInput, brandLimit: 2 },
    400,
    /Brand limit cannot/
  );
});

test("Malformed brand usage rejected", async () => {
  const s = setup({
    current: { institutionCount: "3" },
  });

  await rejected(
    s,
    validInput,
    409,
    /Current brand usage/
  );
});

const geoCases = [
  {
    name: "GEO allowance below consumption rejected",
    usage: { month: MONTH, geoRuns: 35 },
    limit: 20,
    status: 400,
  },
  {
    name: "GEO allowance equal to consumption accepted",
    usage: { month: MONTH, geoRuns: 35 },
    limit: 35,
  },
  {
    name: "GEO allowance above consumption accepted",
    usage: { month: MONTH, geoRuns: 35 },
    limit: 100,
  },
  {
    name: "Zero GEO consumption and allowance accepted",
    usage: { month: MONTH, geoRuns: 0 },
    limit: 0,
  },
  {
    name: "Previous month consumption ignored",
    usage: { month: "2026-10", geoRuns: 35 },
    limit: 10,
  },
  {
    name: "Empty usage map accepted",
    usage: {},
    limit: 10,
  },
  {
    name: "Missing usage accepted",
    usage: undefined,
    limit: 10,
  },
  {
    name: "Missing current-month counter accepted",
    usage: { month: MONTH },
    limit: 10,
  },
  {
    name: "Negative GEO consumption rejected",
    usage: { month: MONTH, geoRuns: -1 },
    limit: 100,
    status: 409,
  },
  {
    name: "String GEO consumption rejected",
    usage: { month: MONTH, geoRuns: "35" },
    limit: 100,
    status: 409,
  },
  {
    name: "Fractional GEO consumption rejected",
    usage: { month: MONTH, geoRuns: 1.5 },
    limit: 100,
    status: 409,
  },
  {
    name: "Invalid usage month rejected",
    usage: { month: "2026-13", geoRuns: 35 },
    limit: 100,
    status: 409,
  },
  {
    name: "Future usage month rejected",
    usage: { month: "2026-12", geoRuns: 35 },
    limit: 100,
    status: 409,
  },
  {
    name: "Nonempty usage without month rejected",
    usage: { geoRuns: 35 },
    limit: 100,
    status: 409,
  },
  {
    name: "Invalid usage container rejected",
    usage: [],
    limit: 100,
    status: 409,
  },
];

for (const item of geoCases) {
  test(item.name, async () => {
    const s = setup({
      current: { usage: item.usage },
    });

    const input = {
      ...validInput,
      geoLimit: item.limit,
    };

    if (item.status) {
      await rejected(
        s,
        input,
        item.status,
        /GEO/
      );
    } else {
      const result = await s.update(input);

      successful(s, result);

      assert.equal(
        s.committed[0].data["limits.geoRuns"],
        item.limit
      );

      assert.equal(
        "usage" in s.committed[0].data,
        false
      );
    }
  });
}

test("Valid trial extension uses existing expiry", async () => {
  const s = setup();

  const result = await s.update({
    ...validInput,
    extendDays: 7,
  });

  successful(s, result);

  assert.equal(
    s.committed[0].data.trialEndsAt.toMillis(),
    NOW + 21 * DAY
  );
});

test("Past trial expiry extends from current time", async () => {
  const s = setup({
    current: {
      trialEndsAt: Timestamp.fromMillis(NOW - DAY),
    },
  });

  const result = await s.update({
    ...validInput,
    extendDays: 7,
  });

  successful(s, result);

  assert.equal(
    s.committed[0].data.trialEndsAt.toMillis(),
    NOW + 7 * DAY
  );
});

test("Paid organization trial extension rejected", async () => {
  const s = setup({
    current: {
      plan: "professional",
      status: "active",
    },
  });

  await rejected(
    s,
    { ...validInput, extendDays: 7 },
    400,
    /Trial extensions/
  );
});

test("Suspended trial extension rejected", async () => {
  const s = setup({
    current: { status: "suspended" },
  });

  await rejected(
    s,
    { ...validInput, extendDays: 7 },
    400,
    /Trial extensions/
  );
});

test("Demo trial extension rejected", async () => {
  const s = setup({
    current: { isDemo: true },
  });

  await rejected(
    s,
    { ...validInput, extendDays: 7 },
    400,
    /Trial extensions/
  );
});

test("Invalid trial expiry rejected", async () => {
  const s = setup({
    current: { trialEndsAt: "invalid-date" },
  });

  await rejected(
    s,
    { ...validInput, extendDays: 7 },
    409,
    /Current trial expiry/
  );
});

for (const mode of [
  "update-failure",
  "audit-failure",
  "commit-failure",
]) {
  test(`Transaction ${mode} leaves no committed writes`, async () => {
    const s = setup({ mode });

    await assert.rejects(
      () => s.update(),
      /Simulated/
    );

    unchanged(s);
  });
}

let passed = 0;

for (const item of tests) {
  try {
    await item.run();
    passed++;
    console.log(`PASS: ${item.name}`);
  } catch (error) {
    console.error(`FAIL: ${item.name}`);
    console.error(error.message);
  }
}

console.log(`\n${passed}/${tests.length} update tests passed.`);
console.log("No Firebase connections or database writes performed.");

if (passed !== tests.length) {
  process.exitCode = 1;
}
