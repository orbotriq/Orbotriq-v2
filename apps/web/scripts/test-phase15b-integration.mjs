import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
const project='demo-orbotriq-v2',base='http://localhost:8080';
Object.assign(process.env,{FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8081',GCLOUD_PROJECT:project,GOOGLE_CLOUD_PROJECT:project,FIREBASE_PROJECT_ID:project});
for(const k of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_CLIENT_EMAIL','FIREBASE_PRIVATE_KEY']) delete process.env[k];
const app=initializeApp({projectId:project},'phase15b-regression'),db=getFirestore(app),auth=getAuth(app);
let count=0;
async function login(email,uid,isAdmin){
 const r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'LocalTest@2026',returnSecureToken:true}),signal:AbortSignal.timeout(30000)});
 assert.equal(r.status,200);const session=await auth.createSessionCookie((await r.json()).idToken,{expiresIn:3600000});const user=await auth.verifySessionCookie(session,true);assert.equal(user.uid,uid);assert.equal(user.platformAdmin===true,isAdmin);return session;
}
async function page(path='/admin/settings',session){const r=await fetch(base+path,{redirect:'manual',headers:session?{Cookie:`orbotriq_emulator_session=${session}`}:{},signal:AbortSignal.timeout(90000)});return {status:r.status,location:r.headers.get('location'),html:await r.text()};}
async function test(name,fn){await fn();count++;console.log('PASS: '+name)}
const ref=db.doc('platform/v2BillingSettings');
const audit=db.collection('platform/settingsManagement/auditLogs');
async function patch(session,body,options={}) {
 const r=await fetch(base+'/api/admin/settings/billing',{method:'PATCH',redirect:'manual',headers:{Origin:options.origin??base,'Content-Type':options.type??'application/json',...(session?{Cookie:`orbotriq_emulator_session=${session}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});return r.status;
}
try {
 const admin=await login('admin@orbotriq.test','test-platform-admin',true),customer=await login('test-digital-agency@orbotriq.test','test-digital-agency-owner',false);
 const before=await ref.get(),beforeAudit=await audit.count().get(),counterRef=db.doc('platform/phase12TestCounters'),beforeCounter=await counterRef.get();
 const input={version:'0:0',billing:{address:'Fictional test address',stateCode:'33',gstRegistered:true,gstin:'',gstRate:18,taxPrefix:'TSTX',proformaPrefix:'TPRX',paymentDays:15,terms:'Test terms'}};
 await test('Unauthenticated billing settings unavailable',async()=>{const r=await page();assert.ok(!r.html.includes('Save billing settings'));});
 await test('Customer billing settings unavailable',async()=>{const r=await page('/admin/settings',customer);assert.ok(!r.html.includes('Save billing settings'));});
 await test('Authorized settings page',async()=>{const r=await page('/admin/settings',admin);assert.equal(r.status,200);assert.ok(r.html.includes('Save billing settings'));});
 await test('Unauthenticated write denied',async()=>assert.equal(await patch(null,input),401));
 await test('Customer write denied',async()=>assert.equal(await patch(customer,input),403));
 await test('Cross origin denied',async()=>assert.equal(await patch(admin,input,{origin:'https://example.test'}),403));
 await test('Wrong content type denied',async()=>assert.equal(await patch(admin,input,{type:'text/plain'}),415));
 await test('Invalid fields denied',async()=>assert.equal(await patch(admin,{...input,admin:true}),400));
 await test('Non-placeholder GSTIN denied',async()=>assert.equal(await patch(admin,{...input,billing:{...input.billing,gstin:'33ABCDE1234F1Z5'}}),400));
 await test('Invalid prefix denied',async()=>assert.equal(await patch(admin,{...input,billing:{...input.billing,taxPrefix:'INV'}}),400));
 await test('Stale version denied',async()=>assert.equal(await patch(admin,input),409));
 await test('Authorized billing page loads',async()=>{const r=await page('/admin/billing',admin);assert.equal(r.status,200);assert.ok(r.html.includes('Billing &amp; GST'));});
 await test('Settings, audits and counters unchanged',async()=>{const after=await ref.get(),afterAudit=await audit.count().get(),afterCounter=await counterRef.get();for(const [a,b] of [[after,before],[afterCounter,beforeCounter]]){assert.equal(a.exists,b.exists);assert.equal(a.updateTime?.isEqual(b.updateTime)??!b.updateTime,true);}assert.equal(afterAudit.data().count,beforeAudit.data().count);});
} finally {await deleteApp(app);}
console.log(`${count} Phase 15B integration checks passed.`);
