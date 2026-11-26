import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore,Timestamp} from 'firebase-admin/firestore';
const project='demo-orbotriq-v2',base='http://localhost:8080';
Object.assign(process.env,{FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8081',GCLOUD_PROJECT:project,GOOGLE_CLOUD_PROJECT:project,FIREBASE_PROJECT_ID:project});
for(const k of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_CLIENT_EMAIL','FIREBASE_PRIVATE_KEY'])delete process.env[k];
const app=initializeApp({projectId:project},'phase16b2-regression'),db=getFirestore(app),auth=getAuth(app);
const id='p16b2-'+randomUUID(),uid=id+'-owner',email=uid+'@orbotriq.test',password='Tmp!Aa1'+randomBytes(20).toString('hex'),newPassword='New!Aa1'+randomBytes(20).toString('hex');
const org=db.doc('orgs/'+id),profile=db.doc('users/'+uid),member=org.collection('members').doc(uid),lock=db.doc('platform/userManagement/locks/'+uid),audits=db.collection('platform/userManagement/auditLogs');
const created=[];let userCreated=false,count=0;
async function test(n,fn){await fn();count++;console.log('PASS: '+n)}
async function signIn(p){const r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:p,returnSecureToken:true}),signal:AbortSignal.timeout(30000)});return {status:r.status,token:(await r.json()).idToken}}
async function post(path,body,origin=base,type='application/json'){const r=await fetch(base+path,{method:'POST',headers:{Origin:origin,'Content-Type':type},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')}}
const session=t=>post('/api/auth/session',{idToken:t});const setup=(body,origin,type)=>post('/api/auth/onboarding',body,origin,type);
try{
 await auth.createUser({uid,email,password,emailVerified:true});userCreated=true;await auth.setCustomUserClaims(uid,{orgId:id,role:'owner'});
 for(const [ref,data] of [[org,{name:'Onboarding '+id,ownerUid:uid,plan:'trial',status:'trialing',isDemo:false,trialEndsAt:Timestamp.fromMillis(Date.now()+86400000)}],[profile,{email,orgId:id}],[member,{email,role:'owner',mustChangePassword:true}]]){await ref.create(data);created.push(ref)}
 const login=await signIn(password);assert.equal(login.status,200);const t=login.token,body={idToken:t,currentPassword:password,newPassword};
 await test('Pending customer receives setup requirement and no session',async()=>{const r=await session(t);assert.equal(r.status,403);assert.equal(r.body.code,'PASSWORD_SETUP_REQUIRED');assert.ok(!r.cookie||r.cookie.includes('Max-Age=0'))});
 await test('Unauthenticated setup denied',async()=>assert.equal((await setup({...body,idToken:'invalid'})).status,403));
 await test('Cross-origin setup denied',async()=>assert.equal((await setup(body,'https://example.test')).status,403));
 await test('Wrong content type denied',async()=>assert.equal((await setup(body,base,'text/plain')).status,415));
 await test('Injected tenant denied',async()=>assert.equal((await setup({...body,orgId:'other'})).status,400));
 await test('Weak password denied',async()=>assert.equal((await setup({...body,newPassword:'weak'})).status,400));
 await test('Same password denied',async()=>assert.equal((await setup({...body,newPassword:password})).status,400));
 await test('Wrong current password denied',async()=>assert.equal((await setup({...body,currentPassword:'Wrong!Pass123'})).status,403));
 await test('Tenant mismatch denied without changing account',async()=>{await profile.update({orgId:id+'-other'});try{assert.ok([403,409].includes((await setup(body)).status));assert.equal((await signIn(password)).status,200)}finally{await profile.update({orgId:id})}});
 await test('Suspended organization denied',async()=>{await org.update({status:'suspended'});try{assert.ok([403,409].includes((await setup(body)).status))}finally{await org.update({status:'trialing'})}});
 await test('Rejected requests preserve pending member and create no audit',async()=>{assert.equal((await member.get()).get('mustChangePassword'),true);assert.equal((await lock.get()).exists,false);assert.equal((await audits.where('uid','==',uid).get()).size,0)});
 await test('Concurrent setup completes exactly once',async()=>{const responses=await Promise.all([setup(body),setup(body)]);assert.equal(responses.filter(r=>r.status===200).length,1);assert.ok(responses.every(r=>[200,403,409].includes(r.status)));assert.ok(responses.find(r=>r.status===200).cookie?.includes('Max-Age=0'))});
 await test('Membership activated and lock removed',async()=>{const m=(await member.get()).data();assert.equal(m.mustChangePassword,false);assert.ok(Number.isSafeInteger(m.minAuthTime));assert.ok(m.passwordChangedAt instanceof Timestamp);assert.equal((await lock.get()).exists,false)});
 await test('Password audit attributed and secret-free',async()=>{const a=await audits.where('uid','==',uid).get();assert.equal(a.size,1);const d=a.docs[0].data();assert.equal(d.action,'password.changed');assert.equal(d.by,uid);assert.equal(d.orgId,id);assert.ok(d.completedAt instanceof Timestamp);for(const secret of [password,newPassword,t])assert.ok(!JSON.stringify(d).includes(secret))});
 await test('Old password rejected',async()=>assert.notEqual((await signIn(password)).status,200));
 await test('Old token cannot create session',async()=>assert.ok([401,403].includes((await session(t)).status)));
 await new Promise(r=>setTimeout(r,2100));const fresh=await signIn(newPassword);assert.equal(fresh.status,200);
 await test('New password creates fresh customer session',async()=>{const r=await session(fresh.token);assert.equal(r.status,200);assert.ok(r.cookie?.startsWith('orbotriq_emulator_session='));const page=await fetch(base+'/dashboard',{headers:{Cookie:r.cookie.split(';')[0]},signal:AbortSignal.timeout(90000)});assert.equal(page.status,200);assert.ok((await page.text()).includes('Onboarding '+id))});
 await test('Completed account cannot repeat onboarding',async()=>assert.ok([403,409].includes((await setup({idToken:fresh.token,currentPassword:newPassword,newPassword:password})).status)));
}finally{try{if(userCreated)await auth.deleteUser(uid);for(const d of (await audits.where('uid','==',uid).get()).docs)await d.ref.delete();await lock.delete();for(const r of created.reverse())await r.delete();console.log('Temporary Phase 16B2 fixtures removed.')}finally{await deleteApp(app)}}
console.log(`${count} Phase 16B2 integration checks passed.`);
