import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
const project='demo-orbotriq-v2', base='http://localhost:8080';
Object.assign(process.env,{FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8081',GCLOUD_PROJECT:project,GOOGLE_CLOUD_PROJECT:project,FIREBASE_PROJECT_ID:project});
for(const k of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_CLIENT_EMAIL','FIREBASE_PRIVATE_KEY']) delete process.env[k];
const app=initializeApp({projectId:project},'phase11-regression');
const db=getFirestore(app),auth=getAuth(app);
const id='p11-'+randomUUID(),org=db.collection('orgs').doc(id),email=id+'@example.test';
let admin,customer,count=0,uid;
async function login(email,uid,isAdmin){
 const r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'LocalTest@2026',returnSecureToken:true}),signal:AbortSignal.timeout(30000)});
 assert.equal(r.status,200); const s=await auth.createSessionCookie((await r.json()).idToken,{expiresIn:3600000}); const d=await auth.verifySessionCookie(s,true); assert.equal(d.uid,uid); assert.equal(d.platformAdmin===true,isAdmin); return s;
}
async function req(path,method,input,status,session=admin,origin=base,type='application/json'){
 const r=await fetch(base+path,{method,redirect:'error',headers:{Origin:origin,'Content-Type':type,...(session?{Cookie:`orbotriq_emulator_session=${session}`}:{})},body:JSON.stringify(input),signal:AbortSignal.timeout(60000)}); const result=await r.json(); assert.equal(r.status,status,`${method} ${path}: expected ${status}, got ${r.status}; response: ${JSON.stringify(result)}`); return result;
}
async function test(name,fn){await fn();count++;console.log('PASS: '+name);}
try{
 admin=await login('admin@orbotriq.test','test-platform-admin',true);customer=await login('test-digital-agency@orbotriq.test','test-digital-agency-owner',false);
 await org.create({name:'Temporary user test',ownerUid:'fixture-owner',status:'active',paidUntil:Timestamp.fromMillis(Date.now()+86400000)});
 const path='/api/admin/users',input={orgId:id,name:'Temporary staff',email,role:'staff',reason:'Integration test'};
 await test('Unauthenticated provisioning denied',()=>req(path,'POST',input,401,null));
 await test('Customer provisioning denied',()=>req(path,'POST',input,403,customer));
 await test('Cross origin denied',()=>req(path,'POST',input,403,admin,'http://example.invalid'));
 await test('Real email rejected',()=>req(path,'POST',{...input,email:'staff@example.com'},400));
 await test('Owner role rejected',()=>req(path,'POST',{...input,role:'owner'},400));
 await test('Provisioning',async()=>{uid=(await req(path,'POST',input,201)).uid;const u=await auth.getUser(uid);assert.equal(u.email,email);assert.equal(u.disabled,false);assert.equal(u.customClaims.role,'staff');assert.equal(u.customClaims.orgId,id);assert.equal((await org.collection('members').doc(uid).get()).data().role,'staff');assert.equal((await db.collection('users').doc(uid).get()).data().orgId,id);});
 await test('Duplicate email rejected',()=>req(path,'POST',input,409));
 const status=path+'/'+uid,role=status+'/role';
 await test('Role change',async()=>{await req(role,'PATCH',{role:'viewer',expectedRole:'staff',reason:'Integration test'},200);assert.equal((await auth.getUser(uid)).customClaims.role,'viewer');assert.equal((await org.collection('members').doc(uid).get()).data().role,'viewer');});
 await test('Stale role rejected',()=>req(role,'PATCH',{role:'admin',expectedRole:'staff',reason:'Integration test'},409));
 await test('Disable',async()=>{await req(status,'PATCH',{disabled:true,expectedDisabled:false,reason:'Integration test'},200);assert.equal((await auth.getUser(uid)).disabled,true);});
 await test('Enable',async()=>{await req(status,'PATCH',{disabled:false,expectedDisabled:true,reason:'Integration test'},200);assert.equal((await auth.getUser(uid)).disabled,false);});
 await test('Owner protected',()=>req(path+'/test-digital-agency-owner/role','PATCH',{role:'viewer',expectedRole:'staff',reason:'Integration test'},403));
 await test('Admin protected',()=>req(path+'/test-platform-admin','PATCH',{disabled:true,expectedDisabled:false,reason:'Integration test'},403));
 await test('Audit records',async()=>{const docs=await db.collection('platform').doc('userManagement').collection('auditLogs').where('uid','==',uid).get();assert.equal(docs.size,4);});
}finally{try{if(!uid){try{const u=await auth.getUserByEmail(email);if(u.customClaims?.orgId===id)uid=u.uid;}catch(e){if(e.code!=='auth/user-not-found')throw e;}}if(uid){const u=await auth.getUser(uid);assert.equal(u.email,email);assert.equal(u.customClaims.orgId,id);await auth.deleteUser(uid);await db.collection('users').doc(uid).delete();const r=db.collection('platform').doc('userManagement');await r.collection('locks').doc(uid).delete();for(const d of (await r.collection('auditLogs').where('uid','==',uid).get()).docs)await d.ref.delete();}await db.recursiveDelete(org);}finally{await deleteApp(app);}}
console.log(`${count} Phase 11 checks passed.`);
