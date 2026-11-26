import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore,Timestamp} from 'firebase-admin/firestore';
const project='demo-orbotriq-v2';
Object.assign(process.env,{NODE_ENV:'development',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8081',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',FIREBASE_PROJECT_ID:project,GCLOUD_PROJECT:project,GOOGLE_CLOUD_PROJECT:project});
for(const k of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_CLIENT_EMAIL','FIREBASE_PRIVATE_KEY'])delete process.env[k];
const require=createRequire(import.meta.url),cache=new Map();
function load(name){if(cache.has(name))return cache.get(name);const exports={};cache.set(name,exports);const code=ts.transpileModule(readFileSync(new URL('../src/lib/admin/'+name+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports','require',code)(exports,k=>k==='server-only'?{}:k.startsWith('./')?load(k.slice(2)):require(k));return exports;}
const {settleConfirmedCashfree:settle}=load('cashfree-settlement');
const app=initializeApp({projectId:project},'phase16d3-'+randomUUID()),db=getFirestore(app),created=[],orgs=[];
const day=86400000,old=Timestamp.fromMillis(Date.now()+30*day),amount=11200;
let n=0;async function test(name,fn){await fn();n++;console.log('PASS: '+name)}
async function fixture({status='active',renew=true,orgId='test-p16d3-'+randomUUID(),paymentId=BigInt('0x'+randomBytes(14).toString('hex')).toString(),orderStatus='reserved',demo=false}={}){
 const invoiceId='TST-26-27-0001',orderId='orb_'+createHash('sha256').update(`${orgId}/${invoiceId}`).digest('hex').slice(0,40),e={orgId,invoiceId,orderId,paymentId,amount};
 const org=db.doc('orgs/'+orgId),invoice=org.collection('invoices').doc(invoiceId),order=db.doc('phase12CashfreeOrders/'+orderId),payment=db.doc('phase12CashfreePayments/'+paymentId);
 await org.create({name:'Phase16D3 temporary',plan:'professional',status,isDemo:demo,paidUntil:old,limits:{institutions:3},usage:{month:'2026-11',geoRuns:2}});created.push(org);orgs.push(org);
 await invoice.create({phase12Test:true,kind:'tax',status:'issued',cashfreeOrderId:orderId,totalPaise:amount,number:'TST/26-27/0001',...(renew?{apply:{planId:'professional',days:30}}:{})});created.push(invoice);
 await order.create({orgId,invoiceId,amountPaise:amount,status:orderStatus});created.push(order);
 // Receipt may be created by settlement; never delete a pre-existing receipt.
 if(!(await payment.get()).exists)created.push(payment);
 return {e,org,invoice,order,payment,run:(actor='test-admin')=>settle(db,e,actor)};
}
async function audit(f,action){return (await f.org.collection('auditLogs').where('action','==',action).get()).size}
try{
 const f=await fixture();
 await test('Concurrent admin and webhook settlement actors produce one write',async()=>{const r=await Promise.all([f.run(),f.run('cashfree-sandbox-webhook'),f.run('cashfree-sandbox-webhook')]);assert.equal(r.filter(x=>!x.duplicate).length,1);assert.equal(r.filter(x=>x.duplicate).length,2)});
 await test('One payment receipt and linked paid order',async()=>{const [p,o,i]=await Promise.all([f.payment.get(),f.order.get(),f.invoice.get()]);assert.equal(p.get('amountPaise'),amount);assert.equal(p.get('orgId'),f.e.orgId);assert.equal(o.get('status'),'paid');assert.equal(o.get('paymentId'),f.e.paymentId);assert.equal(i.get('status'),'paid');assert.equal(i.get('paymentRef'),f.e.paymentId)});
 await test('Subscription extends exactly once',async()=>{const o=await f.org.get();assert.equal(o.get('paidUntil').toMillis(),old.toMillis()+30*day);assert.equal(o.get('limits.institutions'),3);assert.equal(o.get('usage.geoRuns'),2);assert.equal((await f.invoice.get()).get('renewalStatus'),'applied')});
 await test('Payment and renewal audits exactly once',async()=>{assert.equal(await audit(f,'invoice.paid'),1);assert.equal(await audit(f,'subscription.renewed'),1)});
 await test('Repeated settlement leaves paid records untouched',async()=>{const before=await Promise.all([f.invoice.get(),f.org.get(),f.payment.get(),f.order.get()]);assert.equal((await f.run()).duplicate,true);const after=await Promise.all([f.invoice.get(),f.org.get(),f.payment.get(),f.order.get()]);for(let i=0;i<before.length;i++)assert.ok(before[i].updateTime.isEqual(after[i].updateTime));assert.equal(await audit(f,'invoice.paid'),1)});
 const conflict=await fixture({paymentId:f.e.paymentId});
 await test('Payment ID reuse across organizations rejected',async()=>{await assert.rejects(conflict.run());assert.equal((await conflict.invoice.get()).get('status'),'issued');assert.equal((await conflict.order.get()).get('status'),'reserved');assert.equal(await audit(conflict,'invoice.paid'),0)});
 await test('Wrong amount rejected without writes',async()=>{await assert.rejects(settle(db,{...conflict.e,amount:amount+1},'test-admin'));assert.equal((await conflict.invoice.get()).get('status'),'issued')});
 const suspended=await fixture({status:'suspended'});
 await test('Suspended organization payment records without renewal',async()=>{await suspended.run();assert.equal((await suspended.org.get()).get('status'),'suspended');assert.equal((await suspended.org.get()).get('paidUntil').toMillis(),old.toMillis());assert.equal((await suspended.invoice.get()).get('renewalStatus'),'review');assert.equal(await audit(suspended,'subscription.renewed'),0)});
 const noRenew=await fixture({renew:false});
 await test('Nonrenewal invoice settles without changing expiry',async()=>{await noRenew.run();assert.equal((await noRenew.invoice.get()).get('status'),'paid');assert.equal((await noRenew.org.get()).get('paidUntil').toMillis(),old.toMillis());assert.equal(await audit(noRenew,'subscription.renewed'),0)});
 const broken=await fixture({orderStatus:'paid'});
 await test('Inconsistent order state blocks settlement',async()=>{await assert.rejects(broken.run());assert.equal((await broken.payment.get()).exists,false);assert.equal((await broken.invoice.get()).get('status'),'issued')});
 const demo=await fixture({demo:true});
 await test('Demo settlement denied',async()=>{await assert.rejects(demo.run());assert.equal((await demo.payment.get()).exists,false)});
 await test('Wrong deterministic order ID and invalid payment ID denied',async()=>{await assert.rejects(settle(db,{...broken.e,orderId:'orb_'+'a'.repeat(40)},'test-admin'));await assert.rejects(settle(db,{...broken.e,paymentId:'bad'},'test-admin'))});
}finally{try{for(const org of orgs)for(const doc of (await org.collection('auditLogs').get()).docs)await doc.ref.delete();for(const r of created.reverse())await r.delete();console.log('Temporary Phase 16D3 fixtures removed.')}finally{await deleteApp(app)}}
assert.equal(n,12);console.log(`${n} Phase 16D3 Firestore settlement checks passed.`);
