import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
function load(name,deps={}) {const exports={};const code=ts.transpileModule(fs.readFileSync(new URL(`../src/lib/admin/${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports','require',code)(exports,k=>{if(!Object.hasOwn(deps,k))throw Error('Unexpected '+k);return deps[k]});return exports;}
const v=load('cashfree-review-view'), policy=load('cashfree-recovery'), audit=load('global-audit-view');
const e={orgId:'test-a',invoiceId:'TST-26-27-0001',orderId:'orb_example',amount:11200,invoiceVersion:1,orderVersion:2};
const base={phase12Test:true,kind:'tax',status:'issued',cashfreeOrderId:e.orderId,totalPaise:e.amount,number:'TST/26-27/0001'};
const order={orgId:e.orgId,invoiceId:e.invoiceId,amountPaise:e.amount,status:'reserved'};
const svc=load('cashfree-review',{'server-only':{},'firebase-admin/firestore':{FieldValue:{serverTimestamp:()=> 'STAMP'}},'./cashfree-review-view':v});
let count=0;async function test(name,fn){await fn();count++;console.log('PASS: '+name)}
await test('Only known classifications',()=>{for(const code of v.REVIEW_CODES)assert.equal(v.reviewCode(code),code);for(const code of ['PAID','constructor','__proto__',null,{},'SETTLE'])assert.equal(v.reviewCode(code),null)});
await test('Historical labels bounded',()=>{assert.match(v.reviewLabel('EXPIRED_REVIEW'),/reserved/);assert.equal(v.reviewLabel('secret'), '')});
await test('Missing historical review',()=>assert.deepEqual(v.recoveryReviewFields(null),{code:null,at:''}));
await test('Historical review projects only allowed fields',()=>assert.deepEqual(v.recoveryReviewFields({code:'PENDING',observedAt:{toMillis:()=>0},by:'private',secret:'secret'}),{code:'PENDING',at:'1970-01-01T00:00:00.000Z'}));
await test('Malformed timestamp safe',()=>assert.equal(v.recoveryReviewFields({code:'REVIEW',observedAt:{toMillis(){throw Error()}}}).at,''));
await test('Valid reservation',()=>assert.equal(v.reviewLinkValid(base,order,e),true));
await test('Non-test invoice denied',()=>assert.equal(v.reviewLinkValid({...base,phase12Test:false},order,e),false));
await test('Paid invoice denied review write',()=>assert.equal(v.reviewLinkValid({...base,status:'paid'},order,e),false));
await test('Wrong kind denied',()=>assert.equal(v.reviewLinkValid({...base,kind:'proforma'},order,e),false));
await test('Wrong amount and order link denied',()=>{assert.equal(v.reviewLinkValid({...base,totalPaise:1},order,e),false);assert.equal(v.reviewLinkValid({...base,cashfreeOrderId:'other'},order,e),false)});
await test('Wrong tenant and invoice denied',()=>{assert.equal(v.reviewLinkValid(base,{...order,orgId:'other'},e),false);assert.equal(v.reviewLinkValid(base,{...order,invoiceId:'other'},e),false)});
await test('Nonreserved order denied',()=>assert.equal(v.reviewLinkValid(base,{...order,status:'paid'},e),false));
await test('Review never creates order',()=>{assert.equal(policy.mayCreateMissingOrder('review',true),false);assert.equal(policy.mayCreateMissingOrder('review',false),false)});
await test('Expired order remains held',()=>assert.equal(policy.recoveryDecision(e.orderId,'EXPIRED',[],false,false),'EXPIRED_REVIEW'));
await test('Confirmed late paid order remains settle eligible',()=>assert.equal(policy.recoveryDecision(e.orderId,'PAID',[{order_id:e.orderId,payment_status:'SUCCESS'}],false,false),'SETTLE'));
const org={id:'org',collection:()=>({doc:()=>({id:'audit'})})}, ref={id:'invoice'}, orderRef={id:'order'};
function fixture({invoice=base,reservation=order,orgData={isDemo:false},iv=1,rv=2}={}) {const writes=[];const snap=(data,version)=>({exists:data!==null,updateTime:{isEqual:v=>v===version},get:k=>data?.[k],data:()=>data});const data={org:snap(orgData,0),invoice:snap(invoice,iv),order:snap(reservation,rv)};const db={runTransaction:async fn=>fn({get:async r=>data[r.id],update:(r,d)=>writes.push([r.id,d]),create:(r,d)=>writes.push([r.id,d])})};return {writes,run:(code='EXPIRED_REVIEW')=>svc.recordCashfreeReview(db,org,ref,orderRef,e,code,'test-admin')};}
await test('First review writes only metadata and audit',async()=>{const f=fixture();assert.deepEqual(await f.run(),{reviewRecorded:true,reviewChanged:true});assert.deepEqual(f.writes,[['invoice',{cashfreeReview:{code:'EXPIRED_REVIEW',observedAt:'STAMP',by:'test-admin'}}],['audit',{action:'invoice.cashfree_reviewed',number:base.number,reviewCode:'EXPIRED_REVIEW',by:'test-admin',at:'STAMP'}]])});
await test('Repeated classification refreshes without duplicate audit',async()=>{const f=fixture({invoice:{...base,cashfreeReview:{code:'EXPIRED_REVIEW'}}});assert.equal((await f.run()).reviewChanged,false);assert.equal(f.writes.length,1)});
await test('Changed classification audited',async()=>{const f=fixture({invoice:{...base,cashfreeReview:{code:'PENDING'}}});assert.equal((await f.run()).reviewChanged,true);assert.equal(f.writes.length,2)});
await test('Stale invoice version blocked without writes',async()=>{const f=fixture({iv:3});await assert.rejects(f.run());assert.equal(f.writes.length,0)});
await test('Stale reservation version blocked without writes',async()=>{const f=fixture({rv:3});await assert.rejects(f.run());assert.equal(f.writes.length,0)});
await test('Concurrent settlement state blocked',async()=>{const f=fixture({invoice:{...base,status:'paid'}});await assert.rejects(f.run());assert.equal(f.writes.length,0)});
await test('Missing records and demo blocked',async()=>{for(const x of [{invoice:null},{reservation:null},{orgData:null},{orgData:{isDemo:true}}]){const f=fixture(x);await assert.rejects(f.run());assert.equal(f.writes.length,0)}});
await test('Unknown classification blocked',async()=>{const f=fixture();await assert.rejects(f.run('PAID'));assert.equal(f.writes.length,0)});
await test('Audit classification and redaction',()=>{const row=audit.normalizeAudit('orgs/test-a/auditLogs/event1',{action:'invoice.cashfree_reviewed',number:base.number,by:'test-admin',reviewCode:'EXPIRED_REVIEW',secret:'hidden'},Date.now());assert.equal(row.category,'Billing');assert.equal(row.label,'Cashfree recovery reviewed');assert.equal(row.invoice,base.number);assert.ok(!JSON.stringify(row).includes('hidden'))});
console.log(`${count}/${count} Phase 16D2 review tests passed.`);
