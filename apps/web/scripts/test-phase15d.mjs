import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
function load(name,deps={}){const source=fs.readFileSync(new URL(`../src/lib/admin/${name}.ts`,import.meta.url),'utf8');const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const exports={};new Function('exports','require',compiled)(exports,k=>{if(!Object.hasOwn(deps,k))throw Error('Unexpected dependency '+k);return deps[k]});return exports;}
const v=load('platform-access-view'),d=v.DEFAULT_ACCESS,p={...d,maintenance:true,message:'Test maintenance',modules:{...d.modules,seo:false}};
const tests=[
 ['Default allows all 13 modules',()=>{assert.equal(v.MODULE_KEYS.length,13);for(const k of v.MODULE_KEYS)assert.equal(v.decideAccess(d,k).kind,'allowed')}],
 ['Default copy independent',()=>{const a=v.resolveAccess(false,undefined,undefined);a.modules.seo=false;assert.equal(d.modules.seo,true)}],
 ['Valid settings',()=>assert.deepEqual(v.validateAccess(p),{ok:true,fields:p})],
 ['Message trimmed',()=>assert.equal(v.validateAccess({...p,message:' Test '}).fields.message,'Test')],
 ['Invalid message',()=>{for(const message of ['', ' ', 'x'.repeat(241),'x\n',null])assert.equal(v.validateAccess({...p,message}).ok,false)}],
 ['Message boundary',()=>assert.equal(v.validateAccess({...p,message:'x'.repeat(240)}).ok,true)],
 ['Maintenance boolean only',()=>assert.equal(v.validateAccess({...p,maintenance:'yes'}).ok,false)],
 ['Module boolean only',()=>assert.equal(v.validateAccess({...p,modules:{...p.modules,seo:0}}).ok,false)],
 ['Missing module rejected',()=>{const modules={...p.modules};delete modules.seo;assert.equal(v.validateAccess({...p,modules}).ok,false)}],
 ['Unknown module rejected',()=>assert.equal(v.validateAccess({...p,modules:{...p.modules,admin:false}}).ok,false)],
 ['Unknown fields rejected',()=>assert.equal(v.validateAccess({...p,actor:'admin'}).ok,false)],
 ['Invalid body',()=>{for(const x of [null,[],1])assert.equal(v.validateAccess(x).ok,false)}],
 ['Version and request shape',()=>{for(const version of ['missing','10:0'])assert.equal(v.validateAccessUpdate({access:p,version}).ok,true);for(const version of ['bad',null])assert.equal(v.validateAccessUpdate({access:p,version}).ok,false);assert.equal(v.validateAccessUpdate({access:p,version:'missing',extra:true}).ok,false)}],
 ['Non-test settings protected',()=>assert.throws(()=>v.resolveAccess(true,false,p))],
 ['Malformed settings protected',()=>assert.throws(()=>v.resolveAccess(true,true,{}))],
 ['Known route keys only',()=>{assert.equal(v.moduleKey('seo'),true);for(const x of ['constructor','__proto__','toString','admin'])assert.equal(v.moduleKey(x),false)}],
 ['Maintenance covers overview and all modules',()=>{for(const k of [undefined,...v.MODULE_KEYS])assert.deepEqual(v.decideAccess(p,k),{kind:'maintenance',message:p.message})}],
 ['Disabled module blocked',()=>assert.equal(v.decideAccess({...p,maintenance:false},'seo').kind,'disabled')],
 ['Other modules and overview remain available',()=>{for(const k of [undefined,'geo','clients','projects'])assert.equal(v.decideAccess({...p,maintenance:false},k).kind,'allowed')}],
 ['Unreadable settings fail closed',()=>assert.equal(v.decideAccess(null).kind,'unavailable')],
 ['Changed field names only',()=>assert.deepEqual(v.accessChanges(d,p),['maintenance','message','modules.seo'])],
 ['Audit label excludes message',()=>{const a=load('global-audit-view').normalizeAudit('platform/settingsManagement/auditLogs/event1',{action:'settings.access_updated',by:'test-admin',access:p},Date.now());assert.equal(a.category,'Settings');assert.equal(a.label,'Workspace access settings updated');assert.ok(!JSON.stringify(a).includes(p.message))}]
];
let data,stamp,writes,allowed=true,guard=true,readError=false,reads=0;
const ref={id:'access'},audit={id:'audit'},snap=()=>({exists:data!==undefined,updateTime:stamp,get:k=>data?.[k]});
const db={doc:()=>ref,collection:()=>({doc:()=>audit}),runTransaction:async fn=>fn({get:async()=>snap(),create:(r,value)=>writes.push(['create',r,value]),update:(r,value)=>writes.push(['update',r,value])})};ref.get=async()=>{reads++;if(readError)throw Error('read failed');return snap()};
const requireUser=async()=>{if(!allowed)throw Error('Denied');return {uid:'test-admin',role:'platform'}};
const service=load('platform-access',{'server-only':{},'firebase-admin/firestore':{FieldValue:{serverTimestamp:()=>'<server timestamp>'}},'@/lib/firebase/admin':{adminDb:()=>db},'@/lib/auth/guard':{requirePlatformAdmin:requireUser,requireUser},'@/lib/auth/workspace-identity':{requireWorkspaceIdentity:requireUser},'@/lib/auth/customer-policy':{canViewWorkspaceModule:()=>true},'./write-guard':{isAdminWriteEnabled:()=>guard,requireAdminWrite:requireUser},'./platform-access-view':v});
const save=(access=p,version='missing')=>service.saveAccessSettings({access,version});
tests.push(
 ['Create settings and audit',async()=>{data=undefined;stamp=undefined;writes=[];assert.equal((await save()).ok,true);assert.equal(writes.length,2);assert.deepEqual(writes[0][2].access,p);assert.equal(writes[0][2].phase15Test,true);assert.equal(writes[1][2].action,'settings.access_created');assert.equal(writes[1][2].by,'test-admin');assert.ok(!JSON.stringify(writes[1]).includes(p.message))}],
 ['Update preserves unrelated fields',async()=>{data={access:p,phase15Test:true,other:1};stamp={seconds:10,nanoseconds:0};writes=[];assert.equal((await save({...p,maintenance:false},'10:0')).ok,true);assert.equal(writes[0][0],'update');assert.ok(!Object.hasOwn(writes[0][2],'other'));assert.deepEqual(writes[1][2].fields,['maintenance'])}],
 ['No-op no writes',async()=>{writes=[];assert.deepEqual(await save(p,'10:0'),{ok:true,changed:false});assert.equal(writes.length,0)}],
 ['Stale version no writes',async()=>{writes=[];assert.equal((await save()).status,409);assert.equal(writes.length,0)}],
 ['Stored non-test record protected',async()=>{data={access:p};writes=[];assert.equal((await save(p,'10:0')).status,409);assert.equal(writes.length,0)}],
 ['Authorization before read/write',async()=>{allowed=false;writes=[];const before=reads;try{await assert.rejects(save());await assert.rejects(service.workspaceAccess('seo'));await assert.rejects(service.getAccessSettings());assert.equal(writes.length,0);assert.equal(reads,before)}finally{allowed=true}}],
 ['Outside emulator skips settings reads',async()=>{guard=false;const before=reads;try{assert.equal((await service.getAccessSettings()).access,null);assert.equal((await service.workspaceAccess('seo')).kind,'allowed');assert.equal(reads,before)}finally{guard=true}}],
 ['Fresh server reads reflect switch changes',async()=>{data={access:p,phase15Test:true};assert.equal((await service.workspaceAccess('seo')).kind,'maintenance');data={access:{...p,maintenance:false},phase15Test:true};assert.equal((await service.workspaceAccess('seo')).kind,'disabled');assert.equal((await service.workspaceAccess('geo')).kind,'allowed')}],
 ['Read failure blocks workspace but returns admin notice',async()=>{readError=true;try{assert.equal((await service.workspaceAccess()).kind,'unavailable');assert.equal((await service.getAccessSettings()).access,null)}finally{readError=false}}]
);
for(const [name,fn] of tests){await fn();console.log('PASS: '+name)}console.log(`${tests.length}/${tests.length} Phase 15D access settings tests passed.`);
