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
const id='p910-'+randomUUID().replace(/-/g,''), org=db.collection('orgs').doc(id), plan=db.collection('plans').doc(id);
const lp=`/api/admin/organizations/${id}/lifecycle`, dp='/api/admin/organizations/demo', sp=`/api/admin/organizations/${id}/subscription`;
const day=86400000, ver=s=>`${s.updateTime.seconds}:${s.updateTime.nanoseconds}`;
let admin,customer,count=0,owned=false,demoId,uid;
const email=id+'@example.test';
async function login(email,uid,isAdmin){
 const r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'LocalTest@2026',returnSecureToken:true}),signal:AbortSignal.timeout(30000)});
 assert.equal(r.status,200); const s=await auth.createSessionCookie((await r.json()).idToken,{expiresIn:3600000}); const d=await auth.verifySessionCookie(s,true); assert.equal(d.uid,uid); assert.equal(d.platformAdmin===true,isAdmin); return s;
}
async function req(path,method,input,status,session=admin,origin=base,type='application/json'){
 const r=await fetch(base+path,{method,redirect:'error',headers:{Origin:origin,'Content-Type':type,...(session?{Cookie:`orbotriq_emulator_session=${session}`}:{})},body:JSON.stringify(input),signal:AbortSignal.timeout(60000)}); const result=await r.json(); assert.equal(r.status,status,`${method} ${path}: expected ${status}, got ${r.status}; response: ${JSON.stringify(result)}`); return result;
}
async function test(name,fn){await fn();count++;console.log('PASS: '+name);}
async function payload(action,extra={}){return {action,reason:'Integration test',days:0,version:ver(await org.get()),...extra};}
async function reject(action,status,extra={}){const before=await org.get(), n=(await org.collection('auditLogs').get()).size;await req(lp,'PATCH',await payload(action,extra),status);assert.ok(before.updateTime.isEqual((await org.get()).updateTime));assert.equal((await org.collection('auditLogs').get()).size,n);}
try{
 admin=await login('admin@orbotriq.test','test-platform-admin',true);customer=await login('test-digital-agency@orbotriq.test','test-digital-agency-owner',false);
 assert.ok(!(await org.get()).exists&&!(await plan.get()).exists);owned=true;
 const expiry=Timestamp.fromMillis(Date.now()+10*day);
 await org.create({name:'Temporary lifecycle test',plan:id,status:'active',isDemo:false,paidUntil:expiry,institutionCount:8,limits:{institutions:25,geoRuns:500},usage:{month:new Date().toISOString().slice(0,7),geoRuns:40},billingMarker:123});
 for(const [path,method] of [[lp,'PATCH'],[dp,'POST']]){
 await test(path+' unauthenticated',()=>req(path,method,{},401,null));
 await test(path+' customer denied',()=>req(path,method,{},403,customer));
 await test(path+' cross origin denied',()=>req(path,method,{},403,admin,'http://example.invalid'));
 await test(path+' wrong content type',()=>req(path,method,{},415,admin,base,'text/plain'));
 }
 await test('Reason required',()=>reject('suspend',400,{reason:''}));
 await test('Unknown fields rejected',()=>reject('suspend',400,{status:'active'}));
 await test('Stale version rejected',()=>reject('suspend',409,{version:'0:0'}));
 await test('Suspend with audit and preserved fields',async()=>{const before=(await org.get()).data();await req(lp,'PATCH',await payload('suspend'),200);assert.deepEqual((await org.get()).data(),{...before,status:'suspended'});const e=(await org.collection('auditLogs').get()).docs;assert.equal(e.length,1);assert.equal(e[0].data().action,'org.suspend');assert.equal(e[0].data().by,'test-platform-admin');assert.equal(e[0].data().reason,'Integration test');});
 await test('Repeated suspension rejected',()=>reject('suspend',409));
 await test('Reactivate',async()=>{await req(lp,'PATCH',await payload('reactivate'),200);assert.equal((await org.get()).data().status,'active');});
 await test('Concurrent suspension only once',async()=>{const body=await payload('suspend');const responses=await Promise.all([200,200].map(()=>fetch(base+lp,{method:'PATCH',headers:{Origin:base,'Content-Type':'application/json',Cookie:`orbotriq_emulator_session=${admin}`},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)})));assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);});
 await org.update({paidUntil:Timestamp.fromMillis(Date.now()-day)});
 await test('Expired reactivation rejected',()=>reject('reactivate',409));
 await org.update({paidUntil:expiry});await plan.create({limits:{brands:5,geoRuns:10}});
 await test('Same-plan extension preserves custom quotas',async()=>{const before=(await org.get()).data();await req(sp,'PATCH',{planId:id,extendDays:1,version:ver(await org.get()),planVersion:ver(await plan.get())},200);assert.deepEqual((await org.get()).data(),{...before,paidUntil:Timestamp.fromMillis(expiry.toMillis()+day)});});
 const input={name:'Temporary demo',ownerEmail:email,trialDays:7,notes:'Integration test'};
 await test('Real email rejected',()=>req(dp,'POST',{...input,ownerEmail:'example@example.com'},400));
 await test('Demo provisioning',async()=>{const r=await req(dp,'POST',input,201);demoId=r.orgId;assert.equal(typeof demoId,'string');const ref=db.collection('orgs').doc(demoId),d=(await ref.get()).data();uid=d.ownerUid;assert.equal(d.ownerEmail,email);assert.equal(d.plan,'demo');assert.equal(d.status,'demo');assert.equal(d.isDemo,true);assert.deepEqual(d.limits,{institutions:5,geoRuns:50});const u=await auth.getUser(uid);assert.equal(u.email,email);assert.equal(u.disabled,false);assert.equal(u.customClaims.orgId,demoId);assert.equal(u.customClaims.role,'owner');assert.ok((await ref.collection('members').doc(uid).get()).exists);assert.ok((await db.collection('users').doc(uid).get()).exists);});
 await test('Duplicate demo email rejected',()=>req(dp,'POST',input,400));
 await org.update({plan:'demo',isDemo:true,status:'demo',trialEndsAt:expiry});
 await test('Demo suspension rejected',()=>reject('suspend',409));
 await test('Demo extension',async()=>{await req(lp,'PATCH',await payload('extend-demo',{days:3}),200);assert.equal((await org.get()).data().trialEndsAt.toMillis(),expiry.toMillis()+3*day);});
 await test('Demo expiration',async()=>{await req(lp,'PATCH',await payload('expire-demo'),200);assert.equal((await org.get()).data().status,'expired');});
 await test('Expired demo extension',async()=>{await req(lp,'PATCH',await payload('extend-demo',{days:1}),200);assert.equal((await org.get()).data().status,'demo');});
}finally{
 try{if(owned){await db.recursiveDelete(org);await plan.delete();}if(demoId&&uid){const u=await auth.getUser(uid);assert.equal(u.email,email);assert.equal(u.customClaims.orgId,demoId);await auth.deleteUser(uid);await db.recursiveDelete(db.collection('orgs').doc(demoId));await db.collection('users').doc(uid).delete();}else if(demoId){console.warn('Review temporary demo manually:',demoId);}}finally{await deleteApp(app);}
}
console.log(`${count} Phase 9–10 checks passed.`);
