import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
const project='demo-orbotriq-v2',base='http://localhost:8080';
Object.assign(process.env,{FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8081',GCLOUD_PROJECT:project,GOOGLE_CLOUD_PROJECT:project,FIREBASE_PROJECT_ID:project});
for(const k of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_CLIENT_EMAIL','FIREBASE_PRIVATE_KEY']) delete process.env[k];
const app=initializeApp({projectId:project},'phase15c-regression'),db=getFirestore(app),auth=getAuth(app);
let count=0;
async function login(email,uid,isAdmin){
 const r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'LocalTest@2026',returnSecureToken:true}),signal:AbortSignal.timeout(30000)});
 assert.equal(r.status,200);const session=await auth.createSessionCookie((await r.json()).idToken,{expiresIn:3600000});const user=await auth.verifySessionCookie(session,true);assert.equal(user.uid,uid);assert.equal(user.platformAdmin===true,isAdmin);return session;
}
async function page(path='/admin/settings',session){const r=await fetch(base+path,{redirect:'manual',headers:session?{Cookie:`orbotriq_emulator_session=${session}`}:{},signal:AbortSignal.timeout(90000)});return {status:r.status,location:r.headers.get('location'),html:await r.text()};}
async function test(name,fn){await fn();count++;console.log('PASS: '+name)}
const ref=db.doc('platform/v2ProvisioningSettings');
const audit=db.collection('platform/settingsManagement/auditLogs');
async function patch(session,body,options={}) {
 const r=await fetch(base+'/api/admin/settings/provisioning',{method:'PATCH',redirect:'manual',headers:{Origin:options.origin??base,'Content-Type':options.type??'application/json',...(session?{Cookie:`orbotriq_emulator_session=${session}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});return r.status;
}
try {
 const admin=await login('admin@orbotriq.test','test-platform-admin',true),customer=await login('test-digital-agency@orbotriq.test','test-digital-agency-owner',false);
 const before=await ref.get(),beforeAudit=await audit.count().get();
 const input={version:'0:0',provisioning:{trialDays:14,trialBrands:2,trialGeo:5,demoDays:14,demoBrands:5,demoGeo:50,cashfreeCheckoutEnabled:true}};
 await test('Unauthenticated settings unavailable',async()=>assert.ok(!(await page()).html.includes('Save provisioning settings')));
 await test('Customer settings unavailable',async()=>assert.ok(!(await page('/admin/settings',customer)).html.includes('Save provisioning settings')));
 await test('Authorized settings page',async()=>{const r=await page('/admin/settings',admin);assert.equal(r.status,200);assert.ok(r.html.includes('Save provisioning settings'));assert.ok(r.html.includes('Cashfree gateway configuration'));});
 await test('Unauthenticated write denied',async()=>assert.equal(await patch(null,input),401));
 await test('Customer write denied',async()=>assert.equal(await patch(customer,input),403));
 await test('Cross origin denied',async()=>assert.equal(await patch(admin,input,{origin:'https://example.test'}),403));
 await test('Wrong content type denied',async()=>assert.equal(await patch(admin,input,{type:'text/plain'}),415));
 await test('Injected fields denied',async()=>assert.equal(await patch(admin,{...input,admin:true}),400));
 await test('Invalid trial duration denied',async()=>assert.equal(await patch(admin,{...input,provisioning:{...input.provisioning,trialDays:0}}),400));
 await test('Invalid checkout switch denied',async()=>assert.equal(await patch(admin,{...input,provisioning:{...input.provisioning,cashfreeCheckoutEnabled:'yes'}}),400));
 await test('Stale write denied',async()=>assert.equal(await patch(admin,input),409));
 await test('Trial and demo creation pages load',async()=>{for(const path of ['/admin/organizations/create','/admin/organizations/demo']){const r=await page(path,admin);assert.equal(r.status,200);assert.ok(r.html.includes('Organization information'))}});
 await test('Settings and audits unchanged',async()=>{const after=await ref.get();assert.equal(after.exists,before.exists);assert.equal(after.updateTime?.isEqual(before.updateTime)??!before.updateTime,true);assert.equal((await audit.count().get()).data().count,beforeAudit.data().count)});
}finally{await deleteApp(app)}console.log(`${count} Phase 15C integration checks passed.`);
