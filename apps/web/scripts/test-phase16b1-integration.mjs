import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore,Timestamp} from 'firebase-admin/firestore';
const project='demo-orbotriq-v2',base='http://localhost:8080';
Object.assign(process.env,{FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8081',GCLOUD_PROJECT:project,GOOGLE_CLOUD_PROJECT:project,FIREBASE_PROJECT_ID:project});
for(const k of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_CLIENT_EMAIL','FIREBASE_PRIVATE_KEY'])delete process.env[k];
const app=initializeApp({projectId:project},'phase16b1-regression'),db=getFirestore(app),auth=getAuth(app);
const id='p16b1-'+randomUUID(),uid=id+'-owner',viewer=id+'-viewer',email=uid+'@orbotriq.test',viewerEmail=viewer+'@orbotriq.test',password=randomBytes(24).toString('hex'),name='Tenant '+id,otherName='Other tenant '+id;
const org=db.doc('orgs/'+id),other=db.doc('orgs/'+id+'-other'),profile=db.doc('users/'+uid),vp=db.doc('users/'+viewer),member=org.collection('members').doc(uid),vm=org.collection('members').doc(viewer),lock=db.doc('platform/userManagement/locks/'+uid);
const created=[],docs=[];let count=0;
async function test(n,fn){await fn();count++;console.log('PASS: '+n)}
async function token(email){const r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true}),signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);return (await r.json()).idToken}
async function session(idToken,origin=base,type='application/json'){const r=await fetch(base+'/api/auth/session',{method:'POST',headers:{Origin:origin,'Content-Type':type},body:JSON.stringify({idToken}),signal:AbortSignal.timeout(90000)});return {status:r.status,cookie:r.headers.get('set-cookie')?.split(';')[0]}}
async function page(path,cookie){const r=await fetch(base+path,{redirect:'manual',headers:cookie?{Cookie:cookie}:{},signal:AbortSignal.timeout(90000)});return {status:r.status,location:r.headers.get('location'),html:await r.text()}}
const denied=r=>{assert.ok(!r.html.includes('<h2>'+name+'</h2>'));assert.ok(r.location?.includes('/login')||r.html.includes('/login'))};
try{
 const access=await db.doc('platform/v2AccessSettings').get();if(access.exists){const a=access.get('access');assert.equal(a.maintenance,false,'Disable maintenance before tests');assert.equal(a.modules.billing,true,'Enable billing before tests');assert.equal(a.modules.settings,true,'Enable workspace settings before tests');}
 for(const [u,e,role] of [[uid,email,'owner'],[viewer,viewerEmail,'viewer']]){await auth.createUser({uid:u,email:e,password,emailVerified:true});created.push(u);await auth.setCustomUserClaims(u,{orgId:id,role});}
 for(const [ref,data] of [[org,{name,ownerUid:uid,plan:'trial',status:'trialing',isDemo:false,trialEndsAt:Timestamp.fromMillis(Date.now()+86400000)}],[other,{name:otherName}],[profile,{email,orgId:id}],[vp,{email:viewerEmail,orgId:id}],[member,{email,role:'owner',mustChangePassword:false}],[vm,{email:viewerEmail,role:'viewer',mustChangePassword:false}]]){await ref.create(data);docs.push(ref)}
 const t=await token(email),vt=await token(viewerEmail);let c,v;
 await test('Unauthenticated workspace denied',async()=>denied(await page('/dashboard')));
 await test('Session cross origin denied',async()=>assert.equal((await session(t,'https://example.test')).status,403));
 await test('Session wrong content type denied',async()=>assert.equal((await session(t,base,'text/plain')).status,415));
 await test('Verified owner session created',async()=>{const r=await session(t);assert.equal(r.status,200);assert.ok(r.cookie?.startsWith('orbotriq_emulator_session='));c=r.cookie});
 await test('Owner sees only own organization',async()=>{const r=await page('/dashboard?orgId='+id+'-other',c);assert.equal(r.status,200);assert.ok(r.html.includes('<h2>'+name+'</h2>'));assert.ok(!r.html.includes(otherName));assert.ok(!r.html.includes('Super Admin'))});
 await test('Owner billing route allowed',async()=>assert.ok((await page('/dashboard/billing',c)).html.includes('Implementation status')));
 await test('Customer admin page denied',async()=>{const r=await page('/admin/settings',c);assert.ok(!r.html.includes('Save access settings'));assert.ok(r.location?.includes('/login')||r.html.includes('/login'))});
 await test('Customer admin API denied',async()=>{const r=await fetch(base+'/api/admin/settings',{method:'PATCH',headers:{Origin:base,'Content-Type':'application/json',Cookie:c},body:'{}'});assert.equal(r.status,403)});
 await test('Viewer session and restricted routes',async()=>{const r=await session(vt);assert.equal(r.status,200);v=r.cookie;assert.ok(v);for(const k of ['billing','settings'])assert.ok((await page('/dashboard/'+k,v)).html.includes('Your organization role does not allow access'))});
 await test('Password change requirement blocks existing session',async()=>{await member.update({mustChangePassword:true});denied(await page('/dashboard',c));assert.equal((await session(t)).status,403);await member.update({mustChangePassword:false})});
 await test('Cross tenant profile mismatch denied',async()=>{await profile.update({orgId:id+'-other'});denied(await page('/dashboard',c));await profile.update({orgId:id})});
 await test('Suspension blocks existing session',async()=>{await org.update({status:'suspended'});denied(await page('/dashboard',c));await org.update({status:'trialing'})});
 await test('Expiry blocks existing session',async()=>{await org.update({trialEndsAt:Timestamp.fromMillis(Date.now()-1000)});denied(await page('/dashboard',c));await org.update({trialEndsAt:Timestamp.fromMillis(Date.now()+86400000)})});
 await test('Operation lock blocks existing session',async()=>{await lock.create({operation:'integration-test'});docs.push(lock);denied(await page('/dashboard',c));await lock.delete()});
 await test('Live role mismatch blocks existing session',async()=>{await auth.setCustomUserClaims(uid,{orgId:id,role:'staff'});denied(await page('/dashboard',c));await auth.setCustomUserClaims(uid,{orgId:id,role:'owner'})});
 await test('Disabled account blocks existing session',async()=>{await auth.updateUser(uid,{disabled:true});denied(await page('/dashboard',c))});
}finally{try{for(const u of created)await auth.deleteUser(u);for(const ref of docs.reverse())await ref.delete();console.log('Temporary Phase 16B1 fixtures removed.')}finally{await deleteApp(app)}}
console.log(`${count} Phase 16B1 integration checks passed.`);
