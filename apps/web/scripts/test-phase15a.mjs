import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
function load(name,deps={}) {
 const source=fs.readFileSync(new URL(`../src/lib/admin/${name}.ts`,import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};new Function('exports','require',compiled)(exports,k=>{if(!Object.hasOwn(deps,k))throw new Error('Unexpected dependency '+k);return deps[k]});return exports;
}
const view=load('platform-business-view'),auditView=load('global-audit-view');
const {validateBusiness,validateBusinessUpdate,businessChanges,DEFAULT_BUSINESS}=view;
const sample={displayName:'  Test Company  ',legalName:'Test Legal Name',supportEmail:'HELP@EXAMPLE.TEST',website:'https://EXAMPLE.TEST/'};
const normalized={displayName:'Test Company',legalName:'Test Legal Name',supportEmail:'help@example.test',website:'https://example.test'};
const tests=[
 ['Default business valid',()=>assert.equal(validateBusiness(DEFAULT_BUSINESS).ok,true)],
 ['Normalization',()=>assert.deepEqual(validateBusiness(sample),{ok:true,fields:normalized})],
 ['Missing display name',()=>assert.equal(validateBusiness({...sample,displayName:' '}).ok,false)],
 ['Long name',()=>assert.equal(validateBusiness({...sample,displayName:'x'.repeat(101)}).ok,false)],
 ['Control characters rejected',()=>assert.equal(validateBusiness({...sample,legalName:'Bad\nName'}).ok,false)],
 ['Real email rejected',()=>assert.equal(validateBusiness({...sample,supportEmail:'help@example.com'}).ok,false)],
 ['Invalid email rejected',()=>assert.equal(validateBusiness({...sample,supportEmail:'a..b@example.test'}).ok,false)],
 ['Non HTTPS rejected',()=>assert.equal(validateBusiness({...sample,website:'http://example.test'}).ok,false)],
 ['Real website rejected',()=>assert.equal(validateBusiness({...sample,website:'https://example.com'}).ok,false)],
 ['URL credentials rejected',()=>assert.equal(validateBusiness({...sample,website:'https://user:password@example.test'}).ok,false)],
 ['URL path query fragment rejected',()=>{for(const url of ['https://example.test/a','https://example.test/?token=x','https://example.test/#x'])assert.equal(validateBusiness({...sample,website:url}).ok,false)}],
 ['Protected fields rejected',()=>assert.equal(validateBusiness({...sample,phase15Test:true}).ok,false)],
 ['Missing field rejected',()=>assert.equal(validateBusiness({displayName:'Test'}).ok,false)],
 ['Invalid version rejected',()=>assert.equal(validateBusinessUpdate({business:sample,version:'bad'}).ok,false)],
 ['Create and edit versions accepted',()=>{for(const version of ['missing','123:4'])assert.equal(validateBusinessUpdate({business:sample,version}).ok,true)}],
 ['Top-level injection rejected',()=>assert.equal(validateBusinessUpdate({business:sample,version:'missing',actor:'x'}).ok,false)],
 ['Changed keys only',()=>assert.deepEqual(businessChanges(normalized,{...normalized,legalName:'New name'}),['legalName'])],
 ['Settings audit metadata only',()=>{const row=auditView.normalizeAudit('platform/settingsManagement/auditLogs/event1',{action:'settings.business_updated',by:'test-admin',business:sample,fields:['legalName']},Date.now());assert.equal(row.category,'Settings');assert.equal(row.label,'Business settings updated');assert.ok(!JSON.stringify(row).includes('Test Legal Name'))}]
];
// Exercise actual service with isolated transaction doubles, never connect to Firebase.
let data,stamp,writes,allowed=true,guard=true;
const doc={id:'v2BusinessSettings'},audit={id:'audit'};
const snapshot=()=>({exists:data!==undefined,updateTime:stamp,get:k=>data?.[k]});
const db={doc:()=>doc,collection:()=>({doc:()=>audit}),runTransaction:async fn=>fn({get:async()=>snapshot(),create:(ref,value)=>writes.push(['create',ref,value]),update:(ref,value)=>writes.push(['update',ref,value])})};
const service=load('platform-business',{'server-only':{},'firebase-admin/firestore':{FieldValue:{serverTimestamp:()=>'<server timestamp>'}},'@/lib/firebase/admin':{adminDb:()=>db},'@/lib/auth/guard':{requirePlatformAdmin:async()=>({uid:'test-admin'})},'@/lib/admin/write-guard':{isAdminWriteEnabled:()=>guard,requireAdminWrite:async()=>{if(!allowed)throw Error('Denied');return {uid:'test-admin'}}},'./platform-business-view':view});
const save=(business=normalized,version='missing')=>service.saveBusinessSettings({business,version});
tests.push(
 ['Create settings and audit together',async()=>{data=undefined;stamp=undefined;writes=[];assert.equal((await save()).ok,true);assert.equal(writes.length,2);assert.equal(writes[0][0],'create');assert.equal(writes[0][2].phase15Test,true);assert.equal(writes[1][2].action,'settings.business_created');assert.equal(writes[1][2].by,'test-admin');assert.ok(!JSON.stringify(writes[1]).includes('help@example.test'))}],
 ['Existing settings updated and audit attributed',async()=>{data={business:normalized,phase15Test:true,other:'preserved'};stamp={seconds:10,nanoseconds:0};writes=[];assert.equal((await save({...normalized,legalName:'Other name'},'10:0')).ok,true);assert.equal(writes[0][0],'update');assert.ok(!Object.hasOwn(writes[0][2],'other'));assert.deepEqual(writes[1][2].fields,['legalName'])}],
 ['No-op creates no writes',async()=>{writes=[];assert.deepEqual(await save(normalized,'10:0'),{ok:true,changed:false});assert.equal(writes.length,0)}],
 ['Stale write rejected',async()=>{writes=[];assert.equal((await save(normalized,'missing')).status,409);assert.equal(writes.length,0)}],
 ['Non-test existing record protected',async()=>{data={business:normalized};writes=[];assert.equal((await save(normalized,'10:0')).status,409);assert.equal(writes.length,0)}],
 ['Unauthorized service call rejected',async()=>{allowed=false;writes=[];try{await assert.rejects(save());assert.equal(writes.length,0)}finally{allowed=true}}],
 ['Read disabled outside emulator',async()=>{guard=false;try{assert.equal((await service.getBusinessSettings()).business,null)}finally{guard=true}}]
);
for(const [name,fn] of tests){await fn();console.log('PASS: '+name)}
console.log(`${tests.length}/${tests.length} Phase 15A business settings tests passed.`);
