import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
function load(name,deps={}) {
 const source=fs.readFileSync(new URL(`../src/lib/admin/${name}.ts`,import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};new Function('exports','require',compiled)(exports,k=>{if(!Object.hasOwn(deps,k))throw new Error('Unexpected dependency '+k);return deps[k]});return exports;
}
const businessView=load('platform-business-view'),math=load('billing-math'),auditView=load('global-audit-view');
const view=load('platform-billing-view',{'./billing-math':math,'./platform-business-view':businessView});
const {DEFAULT_BILLING:d,validateBilling:v,validateBillingUpdate:u,resolveInvoiceConfig:resolve,invoiceTax,invoicePreferences,storedPreferences,invoiceDueDate,validTaxInvoiceId}=view;
const b={...d,address:'Fictional Phase 15B address',gstRate:12,taxPrefix:'TSTX',proformaPrefix:'TPRX',paymentDays:15,terms:'Test payment terms'};
const business={displayName:'Test company',legalName:'Test legal name',supportEmail:'support@example.test',website:'https://example.test'};
const config=resolve(b,true,business,true);
const tests=[
 ['Legacy defaults valid',()=>assert.equal(v(d).ok,true)],
 ['Normalized input',()=>assert.deepEqual(v({...b,address:'  '+b.address+' ',taxPrefix:'tstx'}),{ok:true,fields:b})],
 ['Invalid address rejected',()=>{for(const address of ['', 'abcd','a'.repeat(301),'bad\naddress'])assert.equal(v({...b,address}).ok,false)}],
 ['Invalid state rejected',()=>{for(const stateCode of ['00','39','33x',33])assert.equal(v({...b,stateCode}).ok,false)}],
 ['Fictional GSTIN accepted',()=>assert.equal(v({...b,gstin:'33AAAAA0000A1Z0'}).ok,true)],
 ['Wrong state or real-shaped GSTIN rejected',()=>{for(const gstin of ['32AAAAA0000A1Z0','33ABCDE1234F1Z5'])assert.equal(v({...b,gstin}).ok,false)}],
 ['Invalid tax rates rejected',()=>{for(const gstRate of [3,9,-1,'18',18.1])assert.equal(v({...b,gstRate}).ok,false)}],
 ['Nonregistered tax must be zero',()=>{assert.equal(v({...b,gstRegistered:false}).ok,false);assert.equal(v({...b,gstRegistered:false,gstRate:0}).ok,true);assert.equal(v({...b,gstRegistered:false,gstRate:0,gstin:'33AAAAA0000A1Z0'}).ok,false)}],
 ['Tax and proforma prefix namespaces separate',()=>{for(const taxPrefix of ['TPR','INV','TST123','TST/'])assert.equal(v({...b,taxPrefix}).ok,false);assert.equal(v({...b,proformaPrefix:'TST'}).ok,false)}],
 ['Invalid payment duration rejected',()=>{for(const paymentDays of [-1,91,1.5,'15'])assert.equal(v({...b,paymentDays}).ok,false)}],
 ['Invalid footer rejected',()=>{for(const terms of ['a'.repeat(501),'bad\nterms'])assert.equal(v({...b,terms}).ok,false)}],
 ['Missing and injected fields rejected',()=>{assert.equal(v({address:b.address}).ok,false);assert.equal(v({...b,phase15Test:true}).ok,false)}],
 ['Request version and top-level fields validated',()=>{assert.equal(u({billing:b,version:'missing'}).ok,true);assert.equal(u({billing:b,version:'12:3'}).ok,true);assert.equal(u({billing:b,version:'bad'}).ok,false);assert.equal(u({billing:b,version:'missing',by:'x'}).ok,false)}],
 ['Legacy fallback unchanged',()=>{const c=resolve(undefined,undefined,business,true);assert.equal(c.configured,false);assert.equal(c.seller.legalName,'Orbotriq TEST ONLY');assert.equal(c.fields.gstRate,18)}],
 ['Configured seller uses saved business name',()=>{assert.equal(config.configured,true);assert.equal(config.seller.legalName,business.legalName);assert.equal(config.seller.address,b.address)}],
 ['Missing or non-test configuration fails closed',()=>{assert.throws(()=>resolve(b,false,business,true));assert.throws(()=>resolve(b,true,business,false));assert.throws(()=>resolve(undefined,true,business,true));assert.throws(()=>resolve(b,true,undefined,true))}],
 ['Same-state CGST and SGST',()=>{const x=invoiceTax(10000,'33',config);assert.equal(x.cgstPaise,600);assert.equal(x.sgstPaise,600);assert.equal(x.totalPaise,11200);assert.equal(x.taxMode,'intra')}],
 ['Other-state IGST',()=>{const x=invoiceTax(10000,'32',config);assert.equal(x.igstPaise,1200);assert.equal(x.totalPaise,11200);assert.equal(x.taxMode,'inter')}],
 ['Zero GST produces zero tax',()=>assert.equal(invoiceTax(10000,'33',resolve({...b,gstRegistered:false,gstRate:0},true,business,true)).totalPaise,10000)],
 ['Stored preference snapshot survives later changes',()=>{const p=invoicePreferences(b);assert.deepEqual(storedPreferences(p),p);assert.notEqual(p.paymentDays,invoicePreferences({...b,paymentDays:30}).paymentDays);assert.equal(storedPreferences(undefined).taxPrefix,'TST')}],
 ['Corrupt invoice preferences rejected',()=>assert.throws(()=>storedPreferences({...invoicePreferences(b),taxPrefix:'INV'}))],
 ['Due date handles month and year boundaries',()=>{assert.equal(invoiceDueDate('2026-11-26',15),'2026-12-11');assert.equal(invoiceDueDate('2026-12-31',1),'2027-01-01');assert.equal(invoiceDueDate('2028-02-28',1),'2028-02-29');assert.throws(()=>invoiceDueDate('2026-02-30',1))}],
 ['Cashfree accepts legacy and configured tax IDs only',()=>{for(const id of ['TST-26-27-0001','TSTX-26-27-0001','TSTX1-26-27-0001'])assert.equal(validTaxInvoiceId(id),true);for(const id of ['TPR-26-27-0001','TSTXYZ-26-27-0001','INV-26-27-0001','TST/26/0001'])assert.equal(validTaxInvoiceId(id),false)}],
 ['Billing audit excludes private values',()=>{const row=auditView.normalizeAudit('platform/settingsManagement/auditLogs/event1',{action:'settings.billing_updated',by:'test-admin',billing:b,fields:['address']},Date.now());assert.equal(row.category,'Settings');assert.equal(row.label,'Billing settings updated');assert.ok(!JSON.stringify(row).includes(b.address))}]
];
let data,stamp,writes,allowed=true,guard=true,businessData={business,phase15Test:true};
const ref={id:'billing'},biz={id:'business'},audit={id:'audit'};
const snapshot=r=>{const v=r===ref?data:businessData;return {exists:v!==undefined,updateTime:r===ref?stamp:{seconds:1,nanoseconds:0},get:k=>v?.[k]}};
const db={doc:p=>p.endsWith('v2BillingSettings')?ref:biz,collection:()=>({doc:()=>audit}),runTransaction:async fn=>fn({get:async r=>snapshot(r),create:(r,value)=>writes.push(['create',r,value]),update:(r,value)=>writes.push(['update',r,value])})};
const service=load('platform-billing',{'server-only':{},'firebase-admin/firestore':{FieldValue:{serverTimestamp:()=>'<server timestamp>'}},'@/lib/firebase/admin':{adminDb:()=>db},'@/lib/auth/guard':{requirePlatformAdmin:async()=>({uid:'test-admin'})},'./write-guard':{isAdminWriteEnabled:()=>guard,requireAdminWrite:async()=>{if(!allowed)throw Error('Denied');return {uid:'test-admin'}}},'./platform-billing-view':view,'./platform-business-view':businessView});
const save=(billing=b,version='missing')=>service.saveBillingSettings({billing,version});
tests.push(
 ['Create settings and audit together',async()=>{data=undefined;stamp=undefined;writes=[];assert.equal((await save()).ok,true);assert.equal(writes.length,2);assert.equal(writes[0][1],ref);assert.equal(writes[0][2].phase15Test,true);assert.equal(writes[1][2].action,'settings.billing_created');assert.equal(writes[1][2].by,'test-admin');assert.ok(!JSON.stringify(writes[1]).includes(b.address))}],
 ['Update preserves unrelated settings and audits changed keys',async()=>{data={billing:b,phase15Test:true,other:'preserved'};stamp={seconds:10,nanoseconds:0};writes=[];assert.equal((await save({...b,paymentDays:30},'10:0')).ok,true);assert.equal(writes[0][0],'update');assert.ok(!Object.hasOwn(writes[0][2],'other'));assert.deepEqual(writes[1][2].fields,['paymentDays'])}],
 ['No-op creates no writes',async()=>{writes=[];assert.deepEqual(await save(b,'10:0'),{ok:true,changed:false});assert.equal(writes.length,0)}],
 ['Stale write rejected',async()=>{writes=[];assert.equal((await save()).status,409);assert.equal(writes.length,0)}],
 ['Non-test stored record protected',async()=>{data={billing:b};writes=[];assert.equal((await save(b,'10:0')).status,409);assert.equal(writes.length,0)}],
 ['Business settings prerequisite enforced',async()=>{businessData=undefined;data=undefined;stamp=undefined;writes=[];assert.equal((await save()).status,409);assert.equal(writes.length,0);businessData={business,phase15Test:true}}],
 ['Unauthorized service call rejected',async()=>{allowed=false;writes=[];try{await assert.rejects(save());assert.equal(writes.length,0)}finally{allowed=true}}],
 ['Read disabled outside emulator',async()=>{guard=false;try{assert.equal(await service.getInvoiceConfig(),null);assert.equal((await service.getBillingSettings()).billing,null)}finally{guard=true}}],
 ['Malformed stored billing snapshot fails closed',()=>{data={phase15Test:true};assert.throws(()=>service.configFromSnapshots(snapshot(ref),snapshot(biz)))}]
);
for(const [name,fn] of tests){await fn();console.log('PASS: '+name)}
console.log(`${tests.length}/${tests.length} Phase 15B billing settings tests passed.`);
