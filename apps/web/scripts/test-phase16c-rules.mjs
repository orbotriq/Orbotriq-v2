import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldPath, Timestamp } from 'firebase-admin/firestore';

// Only the existing isolated demo project. Never accept a caller-supplied host.
const project = 'demo-orbotriq-v2';
Object.assign(process.env, { FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099', FIRESTORE_EMULATOR_HOST:'127.0.0.1:8081', GCLOUD_PROJECT:project, GOOGLE_CLOUD_PROJECT:project, FIREBASE_PROJECT_ID:project });
for (const k of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_CLIENT_EMAIL','FIREBASE_PRIVATE_KEY']) delete process.env[k];
const app = initializeApp({projectId:project}, 'phase16c-rules');
const auth = getAuth(app), db = getFirestore(app);
const id = 'p16c-'+randomUUID(), other=id+'-other';
const org='orgs/'+id, org2='orgs/'+other;
const base=`http://127.0.0.1:8081/v1/projects/${project}/databases/(default)/documents`;
const refs=[], users=[], tokens={}; let count=0;
async function fixture(path,data){const ref=db.doc(path);await ref.create(data);refs.push(ref);}
async function account(role,claims){const uid=id+'-'+role,email=uid+'@orbotriq.test',password='Tmp!Aa1'+randomBytes(20).toString('hex');await auth.createUser({uid,email,password,emailVerified:true});users.push(uid);await auth.setCustomUserClaims(uid,claims);const r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true}),signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);const {idToken}=await r.json();assert.ok(idToken);const decoded=await auth.verifyIdToken(idToken);assert.equal(decoded.uid,uid);for(const [key,value] of Object.entries(claims))assert.equal(decoded[key],value);tokens[role]=idToken;return {uid,email};}
async function check(name,fn){await fn();count++;console.log('PASS: '+name);}
async function deny(role,path,method='GET',body){const headers={};if(role)headers.Authorization='Bearer '+tokens[role];if(body)headers['Content-Type']='application/json';const r=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const result=await r.json();assert.equal(r.status,403,`${method} ${path} must be denied, got ${r.status}`);assert.equal(result.error?.status,'PERMISSION_DENIED');}
const payload={fields:{marker:{stringValue:'unauthorized'}}};
try {
 const owner=await account('owner',{orgId:id,role:'owner'});
 await fixture(org,{name:'Rules test '+id,ownerUid:owner.uid,plan:'trial',status:'trialing',isDemo:false,trialEndsAt:Timestamp.fromMillis(Date.now()+86400000)});
 await fixture(org2,{name:'Other test '+id});
 for(const role of ['owner','admin','staff','viewer']){const a=role==='owner'?owner:await account(role,{orgId:id,role});await fixture('users/'+a.uid,{email:a.email,orgId:id});await fixture(org+'/members/'+a.uid,{email:a.email,role,mustChangePassword:false});}
 await account('platform',{platformAdmin:true});
 for(const path of [org+'/invoices/'+id,org+'/_secrets/'+id,org+'/settings/'+id,org+'/seoKeywords/'+id,'platform/'+id,'leads/'+id,'plans/'+id,'site/'+id,'reportShares/'+id])await fixture(path,{marker:'synthetic'});
 const audit1=org+'/auditLogs/'+id, audit2=org2+'/auditLogs/'+id;const at=Timestamp.fromMillis(Date.now());await fixture(audit1,{at,action:'org.created',by:owner.uid});await fixture(audit2,{at,action:'org.created',by:owner.uid});
 await check('Admin SDK can read seeded fixture',async()=>assert.equal((await db.doc(org).get()).get('name'),'Rules test '+id));
 await check('Unauthenticated organization read denied',()=>deny(null,'/'+org));
 await check('Unauthenticated public plan read denied in v2',()=>deny(null,'/plans/'+id));
 await check('Unauthenticated public site read denied in v2',()=>deny(null,'/site/'+id));
 await check('Unauthenticated lead submission denied in v2',()=>deny(null,'/leads/'+id+'-new','PATCH',payload));
 for(const role of ['owner','admin','staff','viewer'])await check(`${role} direct own organization read denied`,()=>deny(role,'/'+org));
 await check('Cross-tenant read denied',()=>deny('owner','/'+org2));
 await check('Cross-tenant list denied',()=>deny('owner','/orgs'));
 await check('Own user profile read denied',()=>deny('owner','/users/'+owner.uid));
 await check('Own membership read denied',()=>deny('owner','/'+org+'/members/'+owner.uid));
 await check('Owner direct invoice read denied',()=>deny('owner','/'+org+'/invoices/'+id));
 await check('Direct secret read denied',()=>deny('owner','/'+org+'/_secrets/'+id));
 await check('Direct platform document read denied',()=>deny('owner','/platform/'+id));
 await check('Direct share read denied',()=>deny('viewer','/reportShares/'+id));
 await check('Owner direct organization update denied',()=>deny('owner','/'+org,'PATCH',payload));
 await check('Admin direct settings update denied',()=>deny('admin','/'+org+'/settings/'+id,'PATCH',payload));
 await check('Staff direct keyword delete denied',()=>deny('staff','/'+org+'/seoKeywords/'+id,'DELETE'));
 await check('Viewer direct keyword update denied',()=>deny('viewer','/'+org+'/seoKeywords/'+id,'PATCH',payload));
 await check('Platform admin browser read denied',()=>deny('platform','/platform/'+id));
 await check('Platform admin browser write denied',()=>deny('platform','/platform/'+id,'PATCH',payload));
 await check('Platform admin browser collection-group query denied',()=>deny('platform',':runQuery','POST',{structuredQuery:{from:[{collectionId:'auditLogs',allDescendants:true}],limit:1}}));
 await check('Admin SDK collection group ordering and cursor work locally',async()=>{const ordered=db.collectionGroup('auditLogs').orderBy('at','desc').orderBy(FieldPath.documentId(),'desc');const page=await ordered.startAt(at,db.doc(audit1)).limit(2).get();assert.ok(page.docs.some(d=>d.ref.path===audit1));const next=await ordered.startAfter(at,db.doc(audit1)).limit(2).get();assert.ok(next.docs.every(d=>d.ref.path!==audit1));assert.ok((await db.doc(audit2).get()).exists);});
 await check('Rejected direct writes preserve fixtures',async()=>{assert.equal((await db.doc(org).get()).get('name'),'Rules test '+id);for(const path of [org+'/settings/'+id,org+'/seoKeywords/'+id,'platform/'+id])assert.equal((await db.doc(path).get()).get('marker'),'synthetic');assert.equal((await db.doc('leads/'+id+'-new').get()).exists,false);});
} finally {
 try { for(const ref of [...refs,db.doc('leads/'+id+'-new')].reverse())await ref.delete();for(const uid of users)await auth.deleteUser(uid);console.log('Temporary Phase 16C fixtures removed.'); } finally {await deleteApp(app);}
}
assert.equal(count,26);console.log(`${count} Phase 16C direct Firestore checks passed.`);
