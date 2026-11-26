import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
const project='demo-orbotriq-v2',base='http://localhost:8080';
Object.assign(process.env,{FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8081',GCLOUD_PROJECT:project,GOOGLE_CLOUD_PROJECT:project,FIREBASE_PROJECT_ID:project});
for(const k of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_CLIENT_EMAIL','FIREBASE_PRIVATE_KEY']) delete process.env[k];
const app=initializeApp({projectId:project},'phase15d-regression'),db=getFirestore(app),auth=getAuth(app);
let count=0;
async function login(email,uid,isAdmin){
 const r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'LocalTest@2026',returnSecureToken:true}),signal:AbortSignal.timeout(30000)});
 assert.equal(r.status,200);const session=await auth.createSessionCookie((await r.json()).idToken,{expiresIn:3600000});const user=await auth.verifySessionCookie(session,true);assert.equal(user.uid,uid);assert.equal(user.platformAdmin===true,isAdmin);return session;
}
async function page(path='/admin/settings',session){const r=await fetch(base+path,{redirect:'manual',headers:session?{Cookie:`orbotriq_emulator_session=${session}`}:{},signal:AbortSignal.timeout(90000)});return {status:r.status,location:r.headers.get('location'),html:await r.text()};}
async function test(name,fn){await fn();count++;console.log('PASS: '+name)}
const ref=db.doc('platform/v2AccessSettings');
const audit=db.collection('platform/settingsManagement/auditLogs');
async function patch(session,body,options={}) {
 const r=await fetch(base+'/api/admin/settings/access',{method:'PATCH',redirect:'manual',headers:{Origin:options.origin??base,'Content-Type':options.type??'application/json',...(session?{Cookie:`orbotriq_emulator_session=${session}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});return r.status;
}
const keys=['brands','social','ads','seo','geo','competitors','copilot','alerts','reports','billing','settings','clients','projects'];
const defaults={maintenance:false,message:'Workspace maintenance is in progress. Please try again later.',modules:Object.fromEntries(keys.map(k=>[k,true]))};
try {
 const admin=await login('admin@orbotriq.test','test-platform-admin',true),customer=await login('test-digital-agency@orbotriq.test','test-digital-agency-owner',false);
 const before=await ref.get(),beforeAudit=await audit.count().get(),config=before.exists?before.get('access'):defaults;
 const input={version:'0:0',access:defaults};
 await test('Unauthenticated settings unavailable',async()=>assert.ok(!(await page()).html.includes('Save access settings')));
 await test('Customer settings unavailable',async()=>assert.ok(!(await page('/admin/settings',customer)).html.includes('Save access settings')));
 await test('Authorized settings page',async()=>{const r=await page('/admin/settings',admin);assert.equal(r.status,200);assert.ok(r.html.includes('Save access settings'));});
 await test('Unauthenticated write denied',async()=>assert.equal(await patch(null,input),401));
 await test('Customer write denied',async()=>assert.equal(await patch(customer,input),403));
 await test('Cross origin denied',async()=>assert.equal(await patch(admin,input,{origin:'https://example.test'}),403));
 await test('Wrong content type denied',async()=>assert.equal(await patch(admin,input,{type:'text/plain'}),415));
 await test('Injected fields denied',async()=>assert.equal(await patch(admin,{...input,admin:true}),400));
 await test('Invalid maintenance switch denied',async()=>assert.equal(await patch(admin,{...input,access:{...defaults,maintenance:'yes'}}),400));
 await test('Invalid module denied',async()=>assert.equal(await patch(admin,{...input,access:{...defaults,modules:{...defaults.modules,admin:false}}}),400));
 await test('Invalid message denied',async()=>assert.equal(await patch(admin,{...input,access:{...defaults,message:' '}}),400));
 await test('Stale write denied',async()=>assert.equal(await patch(admin,input),409));
 await test('Unauthenticated workspace unavailable',async()=>{const r=await page('/dashboard');assert.ok(r.location?.includes('/login')||r.html.includes('/login'));assert.ok(!r.html.includes('<h1>Your growth, connected.</h1>'));});
 await test('Customer workspace unavailable under current admin-only auth',async()=>{const r=await page('/dashboard/seo',customer);assert.ok(r.location?.includes('/login')||r.html.includes('/login'));assert.ok(!r.html.includes('<h1>SEO &amp; Analytics</h1>'));});
 await test('Workspace overview reflects saved maintenance state',async()=>{const r=await page('/dashboard',admin);assert.equal(r.status,200);assert.ok(r.html.includes(config.maintenance?'<h1>Workspace maintenance</h1>':'<h1>Your growth, connected.</h1>'));});
 await test('All 13 direct module routes reflect saved settings',async()=>{for(const k of keys){const path=(k==='clients'||k==='projects'?'/agency/':'/dashboard/')+k;const r=await page(path,admin);assert.equal(r.status,200,path);const restricted=config.maintenance?'Workspace maintenance':!config.modules[k]?'Module disabled':null;if(restricted)assert.ok(r.html.includes(`<h1>${restricted}</h1>`),path);else {assert.ok(!r.html.includes('<h1>Module disabled</h1>')&&!r.html.includes('<h1>Workspace maintenance</h1>')&&!r.html.includes('<h1>Workspace unavailable</h1>'),path);assert.ok(r.html.includes(k==='clients'?'CRM foundation':k==='projects'?'Project management foundation':'Implementation status'),path)}}});
 await test('Admin settings and audit remain accessible',async()=>{for(const path of ['/admin/settings','/admin/audit']){const r=await page(path,admin);assert.equal(r.status,200);assert.ok(!r.html.includes('<h1>Workspace maintenance</h1>'));}});
 await test('Settings and audits unchanged',async()=>{const after=await ref.get();assert.equal(after.exists,before.exists);assert.equal(after.updateTime?.isEqual(before.updateTime)??!before.updateTime,true);assert.equal((await audit.count().get()).data().count,beforeAudit.data().count)});
}finally{await deleteApp(app)}console.log(`${count} Phase 15D integration checks passed.`);
