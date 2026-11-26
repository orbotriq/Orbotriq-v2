import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
function load(name,deps={}){const source=fs.readFileSync(new URL(`../src/lib/admin/${name}.ts`,import.meta.url),'utf8');const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const exports={};new Function('exports','require',compiled)(exports,k=>{if(!Object.hasOwn(deps,k))throw Error('Unexpected dependency '+k);return deps[k]});return exports;}
const v=load('platform-provisioning-view'),d=v.DEFAULT_PROVISIONING,p={...d,trialDays:21,trialBrands:3,trialGeo:10,demoDays:7,demoBrands:6,demoGeo:25,cashfreeCheckoutEnabled:false};
const tests=[
 ['Legacy defaults',()=>assert.deepEqual(v.resolveProvisioning(false,undefined,undefined),d)],
 ['Valid configuration',()=>assert.deepEqual(v.validateProvisioning(p),{ok:true,fields:p})],
 ['Trial duration boundaries',()=>{for(const trialDays of [0,91,1.5,'14'])assert.equal(v.validateProvisioning({...p,trialDays}).ok,false);for(const trialDays of [1,90])assert.equal(v.validateProvisioning({...p,trialDays}).ok,true)}],
 ['Demo duration boundaries',()=>{for(const demoDays of [0,91,NaN])assert.equal(v.validateProvisioning({...p,demoDays}).ok,false)}],
 ['Brand limit boundaries',()=>{for(const k of ['trialBrands','demoBrands'])for(const n of [0,10001,-1,2.2])assert.equal(v.validateProvisioning({...p,[k]:n}).ok,false)}],
 ['GEO limit boundaries',()=>{for(const k of ['trialGeo','demoGeo']){assert.equal(v.validateProvisioning({...p,[k]:0}).ok,true);for(const n of [-1,1000001,'5'])assert.equal(v.validateProvisioning({...p,[k]:n}).ok,false)}}],
 ['Boolean checkout only',()=>{for(const cashfreeCheckoutEnabled of [1,'false',null])assert.equal(v.validateProvisioning({...p,cashfreeCheckoutEnabled}).ok,false)}],
 ['Missing field rejected',()=>{const rest={...p};delete rest.trialDays;assert.equal(v.validateProvisioning(rest).ok,false)}],
 ['Unknown field rejected',()=>assert.equal(v.validateProvisioning({...p,secret:'private'}).ok,false)],
 ['Invalid body rejected',()=>{for(const x of [null,[],1])assert.equal(v.validateProvisioning(x).ok,false)}],
 ['Version validation',()=>{for(const version of ['missing','10:0'])assert.equal(v.validateProvisioningUpdate({provisioning:p,version}).ok,true);for(const version of ['bad',null])assert.equal(v.validateProvisioningUpdate({provisioning:p,version}).ok,false)}],
 ['Top-level injection rejected',()=>assert.equal(v.validateProvisioningUpdate({provisioning:p,version:'missing',by:'admin'}).ok,false)],
 ['Non-test stored configuration rejected',()=>assert.throws(()=>v.resolveProvisioning(true,false,p))],
 ['Corrupt stored configuration rejected',()=>assert.throws(()=>v.resolveProvisioning(true,true,{}))],
 ['Trial defaults resolved',()=>assert.deepEqual(v.workspaceDefaults(p),{days:21,brands:3,geo:10})],
 ['Demo defaults resolved',()=>assert.deepEqual(v.workspaceDefaults(p,true),{days:7,brands:6,geo:25})],
 ['Changed keys only',()=>assert.deepEqual(v.provisioningChanges(d,{...d,trialDays:30}),['trialDays'])],
 ['Sandbox readiness',()=>assert.equal(v.gatewayStatus(true,'sandbox','app','secret').checkoutAvailable,true)],
 ['Disable checkout preserves configuration status',()=>{const r=v.gatewayStatus(false,'sandbox','app','secret');assert.equal(r.ready,true);assert.equal(r.checkoutAvailable,false)}],
 ['Missing credentials fail closed',()=>{for(const a of ['',undefined,' '])assert.equal(v.gatewayStatus(true,'sandbox',a,'secret').checkoutAvailable,false)}],
 ['Unsupported mode blocked',()=>assert.equal(v.gatewayStatus(true,'production','app','secret').checkoutAvailable,false)],
 ['Credential values never serialized',()=>{const s=JSON.stringify(v.gatewayStatus(true,'sandbox','private-app-value','private-secret-value'));assert.ok(!s.includes('private-'))}],
 ['Settings audit label',()=>{const a=load('global-audit-view').normalizeAudit('platform/settingsManagement/auditLogs/event1',{action:'settings.provisioning_updated',by:'test-admin',provisioning:p},Date.now());assert.equal(a.category,'Settings');assert.equal(a.label,'Provisioning settings updated');assert.ok(!JSON.stringify(a).includes('cashfreeCheckoutEnabled'))}]
];
let data,stamp,writes,allowed=true,guard=true;
const ref={id:'provisioning'},audit={id:'audit'},snap=()=>({exists:data!==undefined,updateTime:stamp,get:k=>data?.[k]});
const db={doc:()=>ref,collection:()=>({doc:()=>audit}),runTransaction:async fn=>fn({get:async()=>snap(),create:(r,value)=>writes.push(['create',r,value]),update:(r,value)=>writes.push(['update',r,value])})};ref.get=async()=>snap();
const service=load('platform-provisioning',{'server-only':{},'firebase-admin/firestore':{FieldValue:{serverTimestamp:()=>'<server timestamp>'}},'@/lib/firebase/admin':{adminDb:()=>db},'@/lib/auth/guard':{requirePlatformAdmin:async()=>({uid:'test-admin'})},'./write-guard':{isAdminWriteEnabled:()=>guard,requireAdminWrite:async()=>{if(!allowed)throw Error('Denied');return {uid:'test-admin'}}},'./platform-provisioning-view':v});
const save=(provisioning=p,version='missing')=>service.saveProvisioningSettings({provisioning,version});
tests.push(
 ['Create configuration and audit',async()=>{data=undefined;stamp=undefined;writes=[];assert.equal((await save()).ok,true);assert.equal(writes.length,2);assert.deepEqual(writes[0][2].provisioning,p);assert.equal(writes[0][2].phase15Test,true);assert.equal(writes[1][2].action,'settings.provisioning_created');assert.equal(writes[1][2].by,'test-admin')}],
 ['Update preserves unrelated fields',async()=>{data={provisioning:p,phase15Test:true,other:1};stamp={seconds:10,nanoseconds:0};writes=[];assert.equal((await save({...p,trialDays:30},'10:0')).ok,true);assert.equal(writes[0][0],'update');assert.ok(!Object.hasOwn(writes[0][2],'other'));assert.deepEqual(writes[1][2].fields,['trialDays'])}],
 ['No-op no writes',async()=>{writes=[];assert.deepEqual(await save(p,'10:0'),{ok:true,changed:false});assert.equal(writes.length,0)}],
 ['Stale version no writes',async()=>{writes=[];assert.equal((await save()).status,409);assert.equal(writes.length,0)}],
 ['Stored non-test record protected',async()=>{data={provisioning:p};writes=[];assert.equal((await save(p,'10:0')).status,409);assert.equal(writes.length,0)}],
 ['Authorization denied',async()=>{allowed=false;writes=[];try{await assert.rejects(save());assert.equal(writes.length,0)}finally{allowed=true}}],
 ['Read disabled outside emulator',async()=>{guard=false;try{assert.equal((await service.getProvisioningSettings()).provisioning,null)}finally{guard=true}}],
 ['Write loader uses saved defaults',async()=>{data={provisioning:p,phase15Test:true};assert.deepEqual(await service.loadProvisioningForWrite(),p)}]
);
for(const [name,fn] of tests){await fn();console.log('PASS: '+name)}console.log(`${tests.length}/${tests.length} Phase 15C provisioning tests passed.`);
