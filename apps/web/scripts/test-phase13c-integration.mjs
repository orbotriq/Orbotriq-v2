import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
const project='demo-orbotriq-v2', base='http://localhost:8080';
Object.assign(process.env,{FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8081',GCLOUD_PROJECT:project,GOOGLE_CLOUD_PROJECT:project,FIREBASE_PROJECT_ID:project});
for(const k of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_CLIENT_EMAIL','FIREBASE_PRIVATE_KEY']) delete process.env[k];
const app=initializeApp({projectId:project},'phase13c-regression');
const db=getFirestore(app),auth=getAuth(app);
const prefix='p13c-'+randomUUID().replace(/-/g,'');
const leads=db.collection('leads'), audits=db.collection('platform').doc('leadManagement').collection('auditLogs');
const ref=leads.doc(prefix), real=leads.doc(prefix+'-real');
const path='/api/admin/leads/'+ref.id+'/activity';
const ver=s=>`${s.updateTime.seconds}:${s.updateTime.nanoseconds}`;
let admin,customer,count=0,started=false;
async function login(email,uid,isAdmin){
 const r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'LocalTest@2026',returnSecureToken:true}),signal:AbortSignal.timeout(30000)});
 assert.equal(r.status,200); const s=await auth.createSessionCookie((await r.json()).idToken,{expiresIn:3600000}); const d=await auth.verifySessionCookie(s,true); assert.equal(d.uid,uid); assert.equal(d.platformAdmin===true,isAdmin); return s;
}
async function req(path,method,input,status,session=admin,origin=base,type='application/json'){
 const r=await fetch(base+path,{method,redirect:'error',headers:{Origin:origin,'Content-Type':type,...(session?{Cookie:`orbotriq_emulator_session=${session}`}:{})},body:JSON.stringify(input),signal:AbortSignal.timeout(60000)}); const result=await r.json(); assert.equal(r.status,status,`${method} ${path}: expected ${status}, got ${r.status}; response: ${JSON.stringify(result)}`); return result;
}
async function test(name,fn){await fn();count++;console.log('PASS: '+name);}
async function events(id){return (await audits.where('leadId','==',id).get()).docs;}
async function current(data){return {...data,version:ver(await ref.get())};}
const schedule={action:'schedule',followUp:'2026-12-01T10:30'};
const note={action:'record',kind:'note',note:'Fictional internal note'};
try {
 admin=await login('admin@orbotriq.test','test-platform-admin',true);
 customer=await login('test-digital-agency@orbotriq.test','test-digital-agency-owner',false);
 assert.ok(!(await ref.get()).exists);assert.ok(!(await real.get()).exists);started=true;
 await ref.create({name:'Phase 13C fixture',email:prefix+'@orbotriq.test',status:'contacted',legacyMarker:'preserve'});
 await real.create({name:'Non-test email fixture',email:prefix+'@example.invalid'});
 await test('Unauthenticated denied',()=>req(path,'POST',{},401,null));
 await test('Customer denied',()=>req(path,'POST',{},403,customer));
 await test('Cross origin denied',()=>req(path,'POST',{},403,admin,'http://example.invalid'));
 await test('Wrong content type denied',()=>req(path,'POST',{},415,admin,base,'text/plain'));
 await test('Missing lead rejected',()=>req('/api/admin/leads/'+prefix+'-missing/activity','POST',{...note,version:'1:2'},404));
 await test('Non-test email lead protected',async()=>{const before=await real.get();await req('/api/admin/leads/'+real.id+'/activity','POST',{...note,version:ver(before)},403);assert.ok((await real.get()).updateTime.isEqual(before.updateTime));});
 await test('Invalid follow-up rejected',async()=>{const before=await ref.get();await req(path,'POST',await current({...schedule,followUp:'2026-02-30T10:00'}),400);assert.ok((await ref.get()).updateTime.isEqual(before.updateTime));});
 await test('Protected field rejected',async()=>{await req(path,'POST',await current({...note,by:'bad'}),400);assert.equal((await events(ref.id)).length,0);});
 const stale=await current(schedule);
 await test('Schedule and audit atomic result',async()=>{await req(path,'POST',stale,200);const d=await ref.get();assert.equal(d.get('followUpAt').toMillis(),Date.parse('2026-12-01T05:00:00Z'));assert.equal(d.get('legacyMarker'),'preserve');assert.equal(d.get('status'),'contacted');assert.equal(d.get('updatedBy'),'test-platform-admin');const es=await events(ref.id);assert.equal(es.length,1);assert.equal(es[0].get('action'),'lead.followup_changed');assert.equal(es[0].get('by'),'test-platform-admin');});
 await test('Stale schedule rejected',async()=>{await req(path,'POST',stale,409);assert.equal((await events(ref.id)).length,1);});
 await test('Unchanged schedule no writes',async()=>{const before=await ref.get();const r=await req(path,'POST',await current(schedule),200);assert.equal(r.changed,false);assert.ok((await ref.get()).updateTime.isEqual(before.updateTime));});
 await test('Record note and attribution',async()=>{await req(path,'POST',await current(note),200);const es=await events(ref.id);assert.equal(es.length,2);assert.ok(es.some(e=>e.get('kind')==='note'&&e.get('note')===note.note&&e.get('by')==='test-platform-admin'));assert.ok((await ref.get()).get('lastActivityAt'));});
 await test('Record call email meeting',async()=>{for(const kind of ['call','email','meeting'])await req(path,'POST',await current({...note,kind}),200);const es=await events(ref.id);assert.equal(es.length,5);for(const kind of ['call','email','meeting'])assert.ok(es.some(e=>e.get('kind')===kind));});
 await test('Concurrent activity allows exactly one',async()=>{const data=await current(note);const make=()=>fetch(base+path,{method:'POST',redirect:'error',headers:{Origin:base,'Content-Type':'application/json',Cookie:`orbotriq_emulator_session=${admin}`},body:JSON.stringify(data),signal:AbortSignal.timeout(60000)});const rs=await Promise.all([make(),make()]);assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);assert.equal((await events(ref.id)).length,6);});
 await test('Clear follow-up and preserve activity',async()=>{await req(path,'POST',await current({...schedule,followUp:null}),200);assert.equal((await ref.get()).get('followUpAt'),null);assert.equal((await events(ref.id)).length,7);});
 await test('Repeat clear no writes',async()=>{const before=await ref.get();const r=await req(path,'POST',await current({...schedule,followUp:null}),200);assert.equal(r.changed,false);assert.ok((await ref.get()).updateTime.isEqual(before.updateTime));assert.equal((await events(ref.id)).length,7);});
} finally {
 try {if(started){for(const d of [ref,real]){for(const event of await events(d.id))await event.ref.delete();await d.delete();}console.log('Temporary Phase 13C fixtures removed.');}} finally {await deleteApp(app);}
}
console.log(`${count} Phase 13C integration checks passed.`);
