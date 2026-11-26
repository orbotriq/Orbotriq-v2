import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore,Timestamp} from 'firebase-admin/firestore';
const project='demo-orbotriq-v2',base='http://localhost:8080';
Object.assign(process.env,{FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8081',GCLOUD_PROJECT:project,GOOGLE_CLOUD_PROJECT:project,FIREBASE_PROJECT_ID:project});
for(const k of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_CLIENT_EMAIL','FIREBASE_PRIVATE_KEY']) delete process.env[k];
const app=initializeApp({projectId:project},'phase14b-regression'),db=getFirestore(app),auth=getAuth(app);
const prefix='p14b-'+randomUUID().replace(/-/g,'');
const refs=[];let count=0;
async function login(email,uid,isAdmin){
 const r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'LocalTest@2026',returnSecureToken:true}),signal:AbortSignal.timeout(30000)});
 assert.equal(r.status,200);const session=await auth.createSessionCookie((await r.json()).idToken,{expiresIn:3600000});const user=await auth.verifySessionCookie(session,true);assert.equal(user.uid,uid);assert.equal(user.platformAdmin===true,isAdmin);return session;
}
async function page(path='/admin/audit',session){const r=await fetch(base+path,{redirect:'manual',headers:session?{Cookie:`orbotriq_emulator_session=${session}`}:{},signal:AbortSignal.timeout(90000)});return {status:r.status,location:r.headers.get('location'),html:await r.text()};}
async function test(name,fn){await fn();count++;console.log('PASS: '+name)}
try {
 const admin=await login('admin@orbotriq.test','test-platform-admin',true),customer=await login('test-digital-agency@orbotriq.test','test-digital-agency-owner',false);
 const ref=db.collection(`orgs/${prefix}/auditLogs`).doc(prefix);refs.push(ref);
 await ref.create({action:'org.updated_by_admin',by:prefix,at:Timestamp.fromMillis(Date.parse('2099-01-01T00:00:00Z')),previousPlan:'private-plan-old',nextPlan:'private-plan-new',note:'private-note-'+prefix});
 await test('Unauthenticated export unavailable',async()=>{const r=await page();assert.ok(!r.html.includes('Export filtered CSV'));assert.ok(!r.html.includes(prefix));});
 await test('Customer export unavailable',async()=>{const r=await page('/admin/audit',customer);assert.ok(!r.html.includes('Export filtered CSV'));assert.ok(!r.html.includes(prefix));});
 const first=await page('/admin/audit',admin);
 await test('Authorized export available with loaded records',()=>{assert.equal(first.status,200);assert.ok(first.html.includes('Export filtered CSV'));assert.ok(first.html.includes(prefix));});
 await test('Subscription label and category with private metadata excluded',()=>{assert.ok(first.html.includes('Subscription updated'));for(const marker of ['private-plan-old','private-plan-new','private-note-'+prefix])assert.ok(!first.html.includes(marker),marker);});
 await test('Invalid cursor returns disabled export',async()=>{const r=await page('/admin/audit?cursor=invalid',admin);assert.equal(r.status,200);assert.ok(r.html.includes('Invalid page cursor'));assert.match(r.html,/<button[^>]*disabled[^>]*>Export filtered CSV<\/button>/);assert.ok(!r.html.includes(prefix));});
}finally{try{if(refs.length){const b=db.batch();for(const r of refs)b.delete(r);await b.commit();console.log('Temporary Phase 14B audit fixtures removed.');}}finally{await deleteApp(app);}}
console.log(`${count} Phase 14B integration checks passed.`);
