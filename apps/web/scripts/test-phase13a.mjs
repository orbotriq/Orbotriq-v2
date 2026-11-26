import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const source = fs.readFileSync(new URL("../src/lib/admin/lead-view.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports = {}; new Function("exports", js)(exports);
const {normalizeLead, normalizeLeadStatus, validLeadId, filterLeads, leadDate} = exports;
const row = normalizeLead("test", {name:" Example ", company:"Demo", email:"example@orbotriq.test", secret:"not exposed"}, null);
const checks = [
  ["Legacy missing status is new", () => assert.equal(normalizeLeadStatus(undefined), "new")],
  ["Legacy demo status preserved", () => assert.equal(normalizeLeadStatus("demo given"), "demo given")],
  ["Malformed status unknown", () => assert.equal(normalizeLeadStatus({}), "unknown")],
  ["Unrecognized status unknown", () => assert.equal(normalizeLeadStatus("unexpected"), "unknown")],
  ["Contact fields normalized", () => assert.equal(row.name, "Example")],
  ["Unknown fields excluded", () => assert.equal(Object.hasOwn(row,"secret"), false)],
  ["Malformed contact safe", () => assert.equal(normalizeLead("id",{email:{}},null).email, "")],
  ["Message length bounded", () => assert.equal(normalizeLead("id",{message:"a".repeat(2100)},null).message.length,2000)],
  ["Valid identifier", () => assert.equal(validLeadId("test-1"),true)],
  ["Invalid identifiers rejected", () => assert.ok(["", "/", "..", "__reserved__", "é".repeat(751)].every(s => !validLeadId(s)))],
  ["Case-insensitive search", () => assert.equal(filterLeads([row],"DEMO","all").length,1)],
  ["Status filter", () => assert.equal(filterLeads([row],"","won").length,0)],
  ["Empty timestamp", () => assert.equal(leadDate(null),"Not recorded")],
  ["Invalid timestamp", () => assert.equal(leadDate(Infinity),"Not recorded")],
];
for (const [label, run] of checks) { run(); console.log(`PASS: ${label}`); }
console.log(`${checks.length}/${checks.length} Phase 13A read-model tests passed.`);
