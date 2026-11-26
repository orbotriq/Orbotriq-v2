import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
const project='demo-orbotriq-v2', base='http://localhost:8080';
Object.assign(process.env,{FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8081',GCLOUD_PROJECT:project,GOOGLE_CLOUD_PROJECT:project,FIREBASE_PROJECT_ID:project});
for(const k of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_CLIENT_EMAIL','FIREBASE_PRIVATE_KEY']) delete process.env[k];
const app=initializeApp({projectId:project},'phase13b-regression');
const db=getFirestore(app),auth=getAuth(app);
const prefix='p13b-'+randomUUID().replace(/-/g,'');
const email=prefix+'@orbotriq.test', otherEmail=prefix+'-changed@orbotriq.test';
const concurrentEmail=prefix+'-race@orbotriq.test';
const leads=db.collection('leads'), mgmt=db.collection('platform').doc('leadManagement');
const audits=mgmt.collection('auditLogs'), keys=mgmt.collection('emailKeys');
const path='/api/admin/leads', missing=prefix+'-missing';
const keyOf=e=>keys.doc(createHash('sha256').update(e).digest('hex'));
const ver=s=>`${s.updateTime.seconds}:${s.updateTime.nanoseconds}`;
let admin,customer,count=0,started=false,ref,editPath,legacy;
const input={name:'Fictional Phase 13B Lead',company:'Test Company',email,phone:'',message:'Website enquiry',source:'Manual',serviceInterest:'Website development',status:'new'};
async function login(email,uid,isAdmin){
 const r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'LocalTest@2026',returnSecureToken:true}),signal:AbortSignal.timeout(30000)});
 assert.equal(r.status,200); const s=await auth.createSessionCookie((await r.json()).idToken,{expiresIn:3600000}); const d=await auth.verifySessionCookie(s,true); assert.equal(d.uid,uid); assert.equal(d.platformAdmin===true,isAdmin); return s;
}
async function req(path,method,input,status,session=admin,origin=base,type='application/json'){
 const r=await fetch(base+path,{method,redirect:'error',headers:{Origin:origin,'Content-Type':type,...(session?{Cookie:`orbotriq_emulator_session=${session}`}:{})},body:JSON.stringify(input),signal:AbortSignal.timeout(60000)}); const result=await r.json(); assert.equal(r.status,status,`${method} ${path}: expected ${status}, got ${r.status}; response: ${JSON.stringify(result)}`); return result;
}
async function test(name,fn){await fn();count++;console.log('PASS: '+name);}
async function events(id){return (await audits.where('leadId','==',id).get()).docs;}
async function current(overrides={}){return {...input,version:ver(await ref.get()),...overrides};}
try {
 admin=await login('admin@orbotriq.test','test-platform-admin',true);
 customer=await login('test-digital-agency@orbotriq.test','test-digital-agency-owner',false);
 for(const e of [email,otherEmail,concurrentEmail]){assert.equal((await leads.where('email','==',e).get()).size,0);assert.ok(!(await keyOf(e).get()).exists);}
 started=true;
 for(const [url,method] of [[path,'POST'],[path+'/'+missing,'PATCH']]){
   await test(method+' unauthenticated',()=>req(url,method,{},401,null));
   await test(method+' customer denied',()=>req(url,method,{},403,customer));
   await test(method+' cross origin denied',()=>req(url,method,{},403,admin,'http://example.invalid'));
   await test(method+' wrong content type',()=>req(url,method,{},415,admin,base,'text/plain'));
 }
 await test('Real email rejected',()=>req(path,'POST',{...input,email:'fictional@example.com'},400));
 await test('Protected fields rejected',()=>req(path,'POST',{...input,createdBy:'injected'},400));
 await test('Create lead and audit',async()=>{const r=await req(path,'POST',input,201);ref=leads.doc(r.leadId);editPath=path+'/'+r.leadId;const d=(await ref.get()).data();assert.equal(d.email,email);assert.equal(d.createdBy,'test-platform-admin');assert.equal(d.status,'new');assert.equal((await keyOf(email).get()).get('leadId'),ref.id);const e=await events(ref.id);assert.equal(e.length,1);assert.equal(e[0].get('action'),'lead.created');});
 await test('Case-insensitive duplicate rejected',async()=>{await req(path,'POST',{...input,email:email.toUpperCase()},409);assert.equal((await leads.where('email','==',email).get()).size,1);assert.equal((await events(ref.id)).length,1);});
 await ref.update({legacyMarker:'preserve'});
 const edit=await current({status:'qualified',serviceInterest:'SEO'});
 await test('Edit status, service and preserve fields',async()=>{const before=await ref.get();await req(editPath,'PATCH',edit,200);const d=(await ref.get()).data();assert.equal(d.status,'qualified');assert.equal(d.serviceInterest,'SEO');assert.equal(d.legacyMarker,'preserve');assert.ok(d.createdAt.isEqual(before.get('createdAt')));assert.equal(d.updatedBy,'test-platform-admin');const e=await events(ref.id);assert.equal(e.length,2);assert.ok(e.some(a=>a.get('action')==='lead.updated'&&a.get('nextStatus')==='qualified'));});
 await test('Stale edit rejected',async()=>{const before=await ref.get();await req(editPath,'PATCH',edit,409);assert.ok((await ref.get()).updateTime.isEqual(before.updateTime));});
 await test('No-op creates no writes',async()=>{const before=await ref.get();const r=await req(editPath,'PATCH',await current({status:'qualified',serviceInterest:'SEO'}),200);assert.equal(r.changed,false);assert.ok((await ref.get()).updateTime.isEqual(before.updateTime));assert.equal((await events(ref.id)).length,2);});
 await test('Email change moves duplicate key',async()=>{await req(editPath,'PATCH',await current({email:otherEmail,status:'qualified',serviceInterest:'SEO'}),200);assert.ok(!(await keyOf(email).get()).exists);assert.equal((await keyOf(otherEmail).get()).get('leadId'),ref.id);});
 await test('Legacy exact email duplicate rejected',async()=>{legacy=leads.doc(prefix+'-legacy');await legacy.create({name:'Legacy fixture',email,status:'demo given'});await req(path,'POST',input,409);assert.equal((await leads.where('email','==',email).get()).size,1);});
 await test('Missing record rejected',()=>req(path+'/'+missing,'PATCH',{...input,version:'1:2'},404));
 await test('Concurrent creation allows exactly one',async()=>{const make=()=>fetch(base+path,{method:'POST',redirect:'error',headers:{Origin:base,'Content-Type':'application/json',Cookie:`orbotriq_emulator_session=${admin}`},body:JSON.stringify({...input,email:concurrentEmail}),signal:AbortSignal.timeout(60000)});const rs=await Promise.all([make(),make()]);assert.deepEqual(rs.map(r=>r.status).sort(),[201,409]);assert.equal((await leads.where('email','==',concurrentEmail).get()).size,1);});
 await test('Concurrent edit allows exactly one',async()=>{const data=await current({email:otherEmail,status:'won',serviceInterest:'SEO'});const make=()=>fetch(base+editPath,{method:'PATCH',redirect:'error',headers:{Origin:base,'Content-Type':'application/json',Cookie:`orbotriq_emulator_session=${admin}`},body:JSON.stringify(data),signal:AbortSignal.timeout(60000)});const rs=await Promise.all([make(),make()]);assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);assert.equal((await ref.get()).get('status'),'won');});
} finally {
 try {if(started){const ids=new Set();for(const e of [email,otherEmail,concurrentEmail]){for(const d of (await leads.where('email','==',e).get()).docs){ids.add(d.id);await d.ref.delete();}await keyOf(e).delete();}if(ref){ids.add(ref.id);await ref.delete();}if(legacy){ids.add(legacy.id);await legacy.delete();}for(const id of ids)for(const event of await events(id))await event.ref.delete();console.log('Temporary Phase 13B fixtures removed.');}} finally {await deleteApp(app);}
}
console.log(`${count} Phase 13B integration checks passed.`);
