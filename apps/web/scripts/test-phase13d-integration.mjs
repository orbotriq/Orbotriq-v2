import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
const project='demo-orbotriq-v2', base='http://localhost:8080';
Object.assign(process.env,{FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8081',GCLOUD_PROJECT:project,GOOGLE_CLOUD_PROJECT:project,FIREBASE_PROJECT_ID:project});
for(const k of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_CLIENT_EMAIL','FIREBASE_PRIVATE_KEY']) delete process.env[k];
const app=initializeApp({projectId:project},'phase13d-regression');
const db=getFirestore(app),auth=getAuth(app);
const prefix='p13d-'+randomUUID().replace(/-/g,'');
const leads=db.collection('leads'), audits=db.collection('platform').doc('leadManagement').collection('auditLogs');
const ref=leads.doc(prefix), real=leads.doc(prefix+'-real');
const path='/api/admin/leads/'+ref.id+'/convert';
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
const good={name:'Conversion test company',trialDays:14};
const email=prefix+'@orbotriq.test';
const existing=leads.doc(prefix+'-existing');
let linkedOrg=null;
try {
 admin=await login('admin@orbotriq.test','test-platform-admin',true);
 customer=await login('test-digital-agency@orbotriq.test','test-digital-agency-owner',false);
 for(const d of [ref,real,existing])assert.ok(!(await d.get()).exists);started=true;
 await ref.create({name:'Phase 13D fixture',email,status:'new',legacyMarker:'preserve'});
 await real.create({name:'Non-test fixture',email:prefix+'@example.invalid',status:'qualified'});
 await existing.create({name:'Existing account fixture',email:'test-digital-agency@orbotriq.test',status:'qualified'});
 await test('Unauthenticated denied',()=>req(path,'POST',{},401,null));
 await test('Customer denied',()=>req(path,'POST',{},403,customer));
 await test('Cross origin denied',()=>req(path,'POST',{},403,admin,'http://example.invalid'));
 await test('Wrong content type denied',()=>req(path,'POST',{},415,admin,base,'text/plain'));
 await test('Missing lead rejected',()=>req('/api/admin/leads/'+prefix+'-missing/convert','POST',{...good,version:'1:2'},404));
 await test('Non-test lead protected',async()=>{const before=await real.get();await req('/api/admin/leads/'+real.id+'/convert','POST',{...good,version:ver(before)},403);assert.ok((await real.get()).updateTime.isEqual(before.updateTime));});
 await test('New lead cannot convert',async()=>{const before=await ref.get();await req(path,'POST',await current(good),409);assert.ok((await ref.get()).updateTime.isEqual(before.updateTime));});
 await ref.update({status:'qualified',followUpAt:new Date()});
 await test('Existing owner account rejected',async()=>{const before=await existing.get();await req('/api/admin/leads/'+existing.id+'/convert','POST',{...good,version:ver(before)},409);assert.ok((await existing.get()).updateTime.isEqual(before.updateTime));});
 await test('Protected field injection rejected',async()=>req(path,'POST',await current({...good,ownerEmail:'evil@orbotriq.test'}),400));
 await test('Invalid trial duration rejected',async()=>await req(path,'POST',await current({...good,trialDays:0}),400));
 await test('Stale conversion rejected',async()=>{const before=await ref.get();await req(path,'POST',{...good,version:'1:2'},409);assert.ok((await ref.get()).updateTime.isEqual(before.updateTime));});
 await test('Concurrent conversion exactly once',async()=>{const data=await current(good);const make=()=>fetch(base+path,{method:'POST',redirect:'error',headers:{Origin:base,'Content-Type':'application/json',Cookie:`orbotriq_emulator_session=${admin}`},body:JSON.stringify(data),signal:AbortSignal.timeout(120000)});const rs=await Promise.all([make(),make()]);const results=await Promise.all(rs.map(r=>r.json()));assert.deepEqual(rs.map(r=>r.status).sort(),[200,409],JSON.stringify(results));linkedOrg=results[rs.findIndex(r=>r.status===200)].orgId;assert.match(linkedOrg,/^[A-Za-z0-9]{20}$/);});
 await test('Lead converted and linked',async()=>{const d=await ref.get();assert.equal(d.get('status'),'won');assert.equal(d.get('conversion.state'),'complete');assert.equal(d.get('conversion.orgId'),linkedOrg);assert.equal(d.get('legacyMarker'),'preserve');assert.equal(d.get('followUpAt'),null);});
 await test('Trial organization and owner provisioned',async()=>{const d=await db.collection('orgs').doc(linkedOrg).get();assert.equal(d.get('sourceLeadId'),ref.id);assert.equal(d.get('ownerEmail'),email);assert.equal(d.get('plan'),'trial');assert.equal(d.get('status'),'trialing');const cfg=(await db.doc('platform/v2ProvisioningSettings').get()).get('provisioning');assert.equal(d.get('limits.institutions'),cfg?.trialBrands??2);assert.equal(d.get('limits.geoRuns'),cfg?.trialGeo??5);const uid=d.get('ownerUid');const u=await auth.getUser(uid);assert.equal(u.email,email);assert.equal(u.disabled,false);assert.equal(u.emailVerified,false);assert.equal(u.customClaims.orgId,linkedOrg);assert.equal(u.customClaims.role,'owner');assert.equal((await d.ref.collection('members').doc(uid).get()).get('role'),'owner');assert.equal((await db.collection('users').doc(uid).get()).get('orgId'),linkedOrg);});
 await test('Conversion audit attribution',async()=>{const es=await events(ref.id);assert.equal(es.length,3);const event=es.find(e=>e.get('action')==='lead.converted');assert.equal(event.get('by'),'test-platform-admin');assert.equal(event.get('orgId'),linkedOrg);assert.equal(event.get('nextStatus'),'won');assert.equal((await db.collection('orgs').doc(linkedOrg).collection('auditLogs').get()).size,1);});
 await test('Repeated conversion rejected without writes',async()=>{const before=await ref.get();await req(path,'POST',await current(good),409);assert.ok((await ref.get()).updateTime.isEqual(before.updateTime));assert.equal((await events(ref.id)).length,3);});
 await test('Converted lead edit rejected',async()=>{const before=await ref.get();await req('/api/admin/leads/'+ref.id,'PATCH',{name:'Changed',company:'',email,phone:'',message:'',source:'',serviceInterest:'',status:'new',version:ver(before)},409);assert.ok((await ref.get()).updateTime.isEqual(before.updateTime));});
} finally {
 try {if(started){const d=await ref.get();const id=d.get('conversion.orgId')??linkedOrg; if(typeof id==='string'&&/^[A-Za-z0-9]{20}$/.test(id)){const uid='owner-'+id;const org=db.collection('orgs').doc(id);const o=await org.get();if(o.exists){assert.equal(o.get('sourceLeadId'),ref.id);assert.equal(o.get('ownerEmail'),email);await db.recursiveDelete(org);}const user=db.collection('users').doc(uid);const ud=await user.get();if(ud.exists){assert.equal(ud.get('email'),email);assert.equal(ud.get('orgId'),id);await user.delete();}try{const u=await auth.getUser(uid);assert.equal(u.email,email);await auth.deleteUser(uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;}}
 for(const fixture of [ref,real,existing]){for(const event of await events(fixture.id))await event.ref.delete();await fixture.delete();}console.log('Temporary Phase 13D fixtures removed.');}} finally {await deleteApp(app);}
}
console.log(`${count} Phase 13D integration checks passed.`);
