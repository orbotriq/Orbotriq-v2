import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/lib/admin/global-audit-view.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports={};new Function('exports',compiled)(exports);
const {auditSource,auditIdentifier,auditDay,normalizeAudit,filterAudit,validAuditBoundary}=exports;
const time=Date.parse('2026-11-25T19:00:00Z'),path='orgs/test-org/auditLogs/event-1';
const row=normalizeAudit(path,{action:'invoice.paid',by:'test-admin',orgId:'wrong-org',number:'TST/26-27/0001',note:'SECRET',reason:'PRIVATE',paymentRef:'SECRETREF'},time);
const lead=normalizeAudit('platform/leadManagement/auditLogs/event-1',{action:'lead.converted',leadId:'test-lead',orgId:'test-org',by:'test-admin'},time);
const boundary={path,seconds:1,nanos:2};
const tests=[
 ['Organization source',()=>assert.equal(auditSource(path).orgId,'test-org')],
 ['All three platform sources',()=>assert.ok(['planManagement','userManagement','leadManagement'].every(s=>auditSource(`platform/${s}/auditLogs/id`)))],
 ['Unrelated source omitted',()=>assert.equal(auditSource('orgs/x/private/y/auditLogs/z'),null)],
 ['Unknown platform source omitted',()=>assert.equal(auditSource('platform/secret/auditLogs/id'),null)],
 ['Identifiers reject email and whitespace',()=>assert.ok(['a@b.test','a b','a/b','a'.repeat(151),{}].every(x=>auditIdentifier(x)===''))],
 ['Organization path overrides stored ID',()=>assert.equal(row.orgId,'test-org')],
 ['Redacted fields not serialized',()=>assert.ok(!/SECRET|PRIVATE/.test(JSON.stringify(row)))],
 ['Unknown action redacted',()=>assert.equal(normalizeAudit(path,{action:'unknown-secret'},time).action,'Unknown action')],
 ['Same event ID across collections unique',()=>assert.notEqual(row.key,lead.key)],
 ['Billing invoice reference',()=>assert.equal(row.invoice,'TST/26-27/0001')],
 ['Lead target',()=>assert.equal(lead.target,'test-lead')],
 ['IST calendar boundary',()=>assert.equal(auditDay(time),'2026-11-26')],
 ['Invalid timestamp omitted',()=>assert.equal(normalizeAudit(path,{},NaN),null)],
 ['Category and actor search',()=>assert.deepEqual(filterAudit([row,lead],'TEST-ADMIN','Lead','',''),[lead])],
 ['Inclusive date range',()=>assert.deepEqual(filterAudit([row],'','all','2026-11-26','2026-11-26'),[row])],
 ['Date exclusion',()=>assert.deepEqual(filterAudit([row],'','all','','2026-11-25'),[])],
 ['Valid cursor',()=>assert.ok(validAuditBoundary(boundary))],
 ['Invalid cursor rejected',()=>assert.ok([{...boundary,path:'private/x/auditLogs/z'},{...boundary,nanos:1e9},{...boundary,seconds:-1},null].every(x=>!validAuditBoundary(x)))],
];
for(const [name,fn] of tests){fn();console.log('PASS: '+name)}
console.log(`${tests.length}/${tests.length} Phase 14A read-model tests passed.`);
