import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
const project='demo-orbotriq-v2', base='http://localhost:8080';
Object.assign(process.env,{FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8081',GCLOUD_PROJECT:project,GOOGLE_CLOUD_PROJECT:project,FIREBASE_PROJECT_ID:project});
for(const k of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_CLIENT_EMAIL','FIREBASE_PRIVATE_KEY']) delete process.env[k];
const app=initializeApp({projectId:project},'phase8-regression');
const db=getFirestore(app),auth=getAuth(app);
const id='p8-'+randomUUID().replace(/-/g,''), target=id+'-b', orgId=id;
const plan=db.collection('plans').doc(id), other=db.collection('plans').doc(target), org=db.collection('orgs').doc(orgId);
const audits=db.collection('platform').doc('planManagement').collection('auditLogs');
const pp='/api/admin/plans', sp=`/api/admin/organizations/${orgId}/subscription`;
let admin,customer,count=0,started=false;
const day=86400000;
const ver=s=>`${s.updateTime.seconds}:${s.updateTime.nanoseconds}`;
async function login(email,uid,isAdmin){
 const r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'LocalTest@2026',returnSecureToken:true}),signal:AbortSignal.timeout(30000)});
 assert.equal(r.status,200); const s=await auth.createSessionCookie((await r.json()).idToken,{expiresIn:3600000}); const d=await auth.verifySessionCookie(s,true); assert.equal(d.uid,uid); assert.equal(d.platformAdmin===true,isAdmin); return s;
}
async function req(path,method,input,status,session=admin,origin=base,type='application/json'){
 const r=await fetch(base+path,{method,redirect:'error',headers:{Origin:origin,'Content-Type':type,...(session?{Cookie:`orbotriq_emulator_session=${session}`}:{})},body:JSON.stringify(input),signal:AbortSignal.timeout(60000)}); const result=await r.json(); assert.equal(r.status,status,`${method} ${path}: expected ${status}, got ${r.status}; response: ${JSON.stringify(result)}`); return result;
}
async function test(name,fn){await fn();count++;console.log('PASS: '+name);}
async function events(){return (await audits.where('planId','==',id).get()).docs;}
async function sub(overrides={}){return {planId:target,extendDays:0,version:ver(await org.get()),planVersion:ver(await other.get()),...overrides};}
async function unchanged(ref,fn){const a=await ref.get();await fn();const b=await ref.get();assert.equal(a.exists,b.exists);if(a.exists){assert.ok(a.updateTime.isEqual(b.updateTime));assert.deepEqual(a.data(),b.data());}}
try{
 admin=await login('admin@orbotriq.test','test-platform-admin',true);customer=await login('test-digital-agency@orbotriq.test','test-digital-agency-owner',false);
 const before=await db.collection('orgs').get(), plansBefore=await db.collection('plans').get();
 assert.ok(!(await plan.get()).exists&&!(await other.get()).exists&&!(await org.get()).exists);started=true;
 const input={planId:id,brandLimit:25,geoLimit:500};
 for(const [path,method] of [[pp,'POST'],[pp+'/'+id,'PATCH'],[sp,'PATCH']]){
  await test(method+' '+path+' unauthenticated',()=>req(path,method,{},401,null));
  await test(method+' '+path+' customer denied',()=>req(path,method,{},403,customer));
  await test(method+' '+path+' cross origin denied',()=>req(path,method,{},403,admin,'http://example.invalid'));
  await test(method+' '+path+' content type rejected',()=>req(path,method,{},415,admin,base,'text/plain'));
 }
 for(const bad of [{planId:'trial'},{planId:'demo'},{planId:'create'},{brandLimit:0},{geoLimit:-1},{brandLimit:1.5},{extra:true}]) await test('Invalid create '+JSON.stringify(bad),()=>req(pp,'POST',{...input,...bad},400));
 await test('Create plan and atomic audit',async()=>{await req(pp,'POST',input,201);assert.deepEqual((await plan.get()).data(),{limits:{brands:25,geoRuns:500}});const e=await events();assert.equal(e.length,1);assert.equal(e[0].data().action,'plan.created');assert.equal(e[0].data().by,'test-platform-admin');});
 await test('Duplicate rejected without writes',()=>unchanged(plan,()=>req(pp,'POST',input,409)));
 await plan.update({priceMarker:123,'limits.extra':7});
 const edit={brandLimit:30,geoLimit:600,version:ver(await plan.get())};
 await test('Update preserves unrelated fields',async()=>{await req(pp+'/'+id,'PATCH',edit,200);assert.deepEqual((await plan.get()).data(),{priceMarker:123,limits:{brands:30,geoRuns:600,extra:7}});assert.equal((await events()).length,2);});
 await test('Stale plan update rejected',()=>unchanged(plan,()=>req(pp+'/'+id,'PATCH',edit,409)));
 await test('No-op plan update',async()=>{await unchanged(plan,async()=>{const r=await req(pp+'/'+id,'PATCH',{...edit,version:ver(await plan.get())},200);assert.equal(r.changed,false);});assert.equal((await events()).length,2);});
 await test('Protected plan edit rejected',()=>req(pp+'/trial','PATCH',edit,400));
 await other.create({limits:{brands:20,geoRuns:300}});
 const expiry=Timestamp.fromMillis(Date.now()+10*day), month=new Date().toISOString().slice(0,7);
 await org.create({name:'Temporary Phase 8 test',plan:id,status:'suspended',isDemo:false,institutionCount:8,limits:{institutions:30,geoRuns:600,extra:9},usage:{month,geoRuns:40},paidUntil:expiry});
 await test('Assignment and expiry preserve status and usage',async()=>{await req(sp,'PATCH',await sub({extendDays:30}),200);const d=(await org.get()).data();assert.equal(d.plan,target);assert.equal(d.status,'suspended');assert.deepEqual(d.limits,{institutions:20,geoRuns:300,extra:9});assert.deepEqual(d.usage,{month,geoRuns:40});assert.equal(d.paidUntil.toMillis(),expiry.toMillis()+30*day);assert.equal((await org.collection('auditLogs').get()).size,1);});
 await test('Subscription no-op',async()=>{await unchanged(org,async()=>{assert.equal((await req(sp,'PATCH',await sub(),200)).changed,false);});assert.equal((await org.collection('auditLogs').get()).size,1);});
 await test('Stale organization rejected',()=>unchanged(org,async()=>req(sp,'PATCH',await sub({version:'0:0'}),409)));
 await test('Stale target plan rejected',()=>unchanged(org,async()=>req(sp,'PATCH',await sub({planVersion:'0:0'}),409)));
 await org.update({plan:id});
 await other.update({'limits.brands':7});
 await test('Brand quota reduction rejected',()=>unchanged(org,async()=>req(sp,'PATCH',await sub(),400)));
 await other.update({'limits.brands':20,'limits.geoRuns':39});
 await test('GEO quota reduction rejected',()=>unchanged(org,async()=>req(sp,'PATCH',await sub(),400)));
 await other.update({'limits.geoRuns':300});
 await test('Invalid extension rejected',()=>unchanged(org,async()=>req(sp,'PATCH',await sub({extendDays:91}),400)));
 await org.update({plan:'trial',status:'trialing'});
 await test('Trial conversion rejected',()=>unchanged(org,async()=>req(sp,'PATCH',await sub(),409)));
 await org.update({plan:target,status:'demo',isDemo:true});
 await test('Demo conversion rejected',()=>unchanged(org,async()=>req(sp,'PATCH',await sub(),409)));
 await test('Existing organization and plan documents unchanged',async()=>{for(const s of [...before.docs,...plansBefore.docs]){const now=await s.ref.get();assert.ok(now.exists&&s.updateTime.isEqual(now.updateTime));assert.deepEqual(now.data(),s.data());}});
}finally{
 try{if(started){await db.recursiveDelete(org);await plan.delete();await other.delete();for(const e of await events())await e.ref.delete();assert.ok(!(await org.get()).exists&&!(await plan.get()).exists&&!(await other.get()).exists);assert.equal((await events()).length,0);console.log('PASS: Temporary fixtures cleaned up');}}finally{await deleteApp(app);}
}
console.log(`${count} Phase 8 integration checks passed.`);
