import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore,Timestamp} from 'firebase-admin/firestore';
const project='demo-orbotriq-v2',base='http://localhost:8080';
Object.assign(process.env,{FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8081',GCLOUD_PROJECT:project,GOOGLE_CLOUD_PROJECT:project,FIREBASE_PROJECT_ID:project});
for(const k of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_CLIENT_EMAIL','FIREBASE_PRIVATE_KEY']) delete process.env[k];
const app=initializeApp({projectId:project},'phase14a-regression'),db=getFirestore(app),auth=getAuth(app);
const prefix='p14a-'+randomUUID().replace(/-/g,'');
const refs=[];let count=0;
async function login(email,uid,isAdmin){
 const r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'LocalTest@2026',returnSecureToken:true}),signal:AbortSignal.timeout(30000)});
 assert.equal(r.status,200);const session=await auth.createSessionCookie((await r.json()).idToken,{expiresIn:3600000});const user=await auth.verifySessionCookie(session,true);assert.equal(user.uid,uid);assert.equal(user.platformAdmin===true,isAdmin);return session;
}
async function page(path='/admin/audit',session){const r=await fetch(base+path,{redirect:'manual',headers:session?{Cookie:`orbotriq_emulator_session=${session}`}:{},signal:AbortSignal.timeout(90000)});return {status:r.status,location:r.headers.get('location'),html:await r.text()};}
async function test(name,fn){await fn();count++;console.log('PASS: '+name)}
try{
 const admin=await login('admin@orbotriq.test','test-platform-admin',true),customer=await login('test-digital-agency@orbotriq.test','test-digital-agency-owner',false);
 const sources=[`orgs/${prefix}/auditLogs`,'platform/planManagement/auditLogs','platform/userManagement/auditLogs','platform/leadManagement/auditLogs'];
 const actions=['invoice.paid','plan.created','user.provisioned','lead.created'];
 const batch=db.batch();
 for(let i=0;i<30;i++){const ref=db.collection(sources[i%4]).doc(`${prefix}-${String(i).padStart(2,'0')}`);refs.push(ref);batch.create(ref,{action:actions[i%4],by:prefix,at:Timestamp.fromMillis(Date.parse('2099-01-01T00:00:00Z')),orgId:prefix,leadId:prefix,planId:prefix,uid:prefix,note:`private-note-${prefix}`,paymentRef:`private-payment-${prefix}`});}
 const unrelated=db.collection(`platform/unsupported/auditLogs`).doc(prefix+'-private');refs.push(unrelated);batch.create(unrelated,{action:'lead.created',by:prefix+'-private',at:Timestamp.fromMillis(Date.parse('2099-01-02T00:00:00Z'))});
 await batch.commit();
 await test('Unauthenticated audit data not exposed',async()=>{const r=await page();assert.ok([200,303,307,308].includes(r.status));assert.ok(!r.html.includes(prefix));assert.ok(r.location?.includes('/login')||r.html.includes('/login'));});
 await test('Customer audit data not exposed',async()=>{const r=await page('/admin/audit',customer);assert.ok([200,303,307,308].includes(r.status));assert.ok(!r.html.includes(prefix));assert.ok(r.location?.includes('/login')||r.location?.includes('/dashboard')||r.html.includes('/login')||r.html.includes('/dashboard'));});
 const first=await page('/admin/audit',admin);
 await test('Authorized audit page loads',()=>{assert.equal(first.status,200);assert.ok(first.html.includes('Global audit logs'));assert.ok(first.html.includes(prefix));});
 await test('All four source categories represented',()=>{for(const action of actions)assert.ok(first.html.includes(action),action);});
 await test('Private data and unrelated paths omitted',()=>{for(const marker of [`private-note-${prefix}`,`private-payment-${prefix}`,`${prefix}-private`])assert.ok(!first.html.includes(marker),marker);});
 const next=first.html.match(/href="(\/admin\/audit\?cursor=[A-Za-z0-9_-]+)"/);
 await test('Older page cursor exists',()=>assert.ok(next));
 const second=await page(next[1],admin);
 await test('Pagination contains remaining fixtures without overlap',()=>{assert.equal(second.status,200);for(const ref of refs.slice(0,30)){const a=first.html.includes(ref.id),b=second.html.includes(ref.id);assert.notEqual(a,b,ref.id);}});
 await test('Invalid cursor fails safely',async()=>{const r=await page('/admin/audit?cursor=invalid',admin);assert.equal(r.status,200);assert.ok(r.html.includes('Invalid page cursor'));assert.ok(!r.html.includes(prefix));});
}finally{try{if(refs.length){const b=db.batch();for(const r of refs)b.delete(r);await b.commit();console.log('Temporary Phase 14A audit fixtures removed.');}}finally{await deleteApp(app);}}
console.log(`${count} Phase 14A integration checks passed.`);
