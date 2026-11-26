import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
function load(name, deps={}) {
 const source=fs.readFileSync(new URL(`../src/lib/admin/${name}.ts`,import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};new Function('exports','require',compiled)(exports,key=>{if(!Object.hasOwn(deps,key))throw new Error('Unexpected dependency '+key);return deps[key]});return exports;
}
const {normalizeAudit,filterAudit}=load('global-audit-view');
const {auditCsv}=load('global-audit-csv',{'./lead-csv':load('lead-csv')});
const time=Date.parse('2026-11-25T19:00:00Z'),path='orgs/test-org/auditLogs/event-1';
const row=normalizeAudit(path,{action:'invoice.paid',by:'test-admin',number:'TST/26-27/0001',note:'DO-NOT-EXPORT',paymentRef:'PRIVATE-REF'},time);
const subscription=normalizeAudit(path,{action:'org.updated_by_admin',previousPlan:'professional',nextPlan:'professional'},time);
const tests=[
 ['Known action label',()=>assert.equal(row.label,'Invoice paid')],
 ['Unknown action label redacted',()=>assert.equal(normalizeAudit(path,{action:'secret-action'},time).label,'Unknown action')],
 ['Subscription update categorized',()=>assert.equal(subscription.category,'Subscription')],
 ['Same plan extension labeled',()=>assert.equal(subscription.label,'Subscription updated')],
 ['Ordinary organization edit unchanged',()=>assert.equal(normalizeAudit(path,{action:'org.updated_by_admin'},time).category,'Organization')],
 ['Malformed plan metadata ignored',()=>assert.equal(normalizeAudit(path,{action:'org.updated_by_admin',previousPlan:{},nextPlan:'professional'},time).category,'Organization')],
 ['Plan names not serialized',()=>assert.ok(!JSON.stringify(subscription).includes('professional'))],
 ['Renewal invoice metadata retained',()=>assert.equal(normalizeAudit(path,{action:'subscription.renewed',number:'TST/26-27/0001'},time).invoice,'TST/26-27/0001')],
 ['Label search',()=>assert.deepEqual(filterAudit([row,subscription],'subscription updated','all','',''),[subscription])],
 ['UTF-8 BOM and CRLF',()=>{const csv=auditCsv([row]);assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.endsWith('\r\n'));assert.equal(csv.split('\r\n').length,3)}],
 ['UTC timestamp exported',()=>assert.ok(auditCsv([row]).includes('2026-11-25T19:00:00.000Z'))],
 ['Selected rows only',()=>assert.ok(!auditCsv([row]).includes('Subscription updated'))],
 ['No raw fields exported',()=>assert.ok(!/DO-NOT-EXPORT|PRIVATE-REF|EXTRA-SECRET/.test(auditCsv([{...row,note:'EXTRA-SECRET'}])))],
 ['Formula prefixes neutralized',()=>{for(const actor of ['=1+1','+1','-1','@SUM(1)','  =1','\t=1','＝1','\x00=1'])assert.ok(auditCsv([{...row,actor}]).includes(`"'`),actor)}],
 ['Quotes and comma escaped',()=>assert.ok(auditCsv([{...row,actor:'a,"b"'}]).includes('"a,""b"""'))],
 ['Empty data header only',()=>assert.equal(auditCsv([]).split('\r\n').length,2)],
];
for(const [name,fn] of tests){fn();console.log('PASS: '+name)}
console.log(`${tests.length}/${tests.length} Phase 14B audit export tests passed.`);
