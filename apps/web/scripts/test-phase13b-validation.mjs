import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
function load(name, imports={}) {
 const source=fs.readFileSync(new URL(`../src/lib/admin/${name}.ts`,import.meta.url),'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={}; new Function('exports','require',js)(exports,id=>{assert.ok(Object.hasOwn(imports,id),id);return imports[id];});return exports;
}
const {validateLead}=load('lead-validation',{'@/lib/admin/lead-view':load('lead-view')});
const good={name:' Fictional Lead ',company:'Demo',email:'EXAMPLE@ORBOTRIQ.TEST',phone:'',message:'Test',source:'Manual',serviceInterest:'Website',status:'new'};
const checks=[
 ['Normalized email and name',()=>{const r=validateLead(good,false);assert.ok(r.ok);assert.equal(r.fields.email,'example@orbotriq.test');assert.equal(r.fields.name,'Fictional Lead');}],
 ['Real email rejected',()=>assert.equal(validateLead({...good,email:'x@example.com'},false).ok,false)],
 ['Malformed email rejected',()=>assert.equal(validateLead({...good,email:'x@bad..test'},false).ok,false)],
 ['Missing name rejected',()=>assert.equal(validateLead({...good,name:' '},false).ok,false)],
 ['Phone format accepted',()=>assert.ok(validateLead({...good,phone:'+1 202-555-0100'},false).ok)],
 ['Invalid phone rejected',()=>assert.equal(validateLead({...good,phone:'123abc'},false).ok,false)],
 ['Short phone rejected',()=>assert.equal(validateLead({...good,phone:'123456'},false).ok,false)],
 ['Long message rejected',()=>assert.equal(validateLead({...good,message:'x'.repeat(2001)},false).ok,false)],
 ['Field injection rejected',()=>assert.equal(validateLead({...good,createdBy:'bad'},false).ok,false)],
 ['Missing field rejected',()=>assert.equal(validateLead({...good,source:undefined},false).ok,false)],
 ['Invalid creation status rejected',()=>assert.equal(validateLead({...good,status:'won'},false).ok,false)],
 ['Legacy status accepted on edit',()=>assert.ok(validateLead({...good,status:'demo given',version:'1:2'},true).ok)],
 ['Unknown status rejected',()=>assert.equal(validateLead({...good,status:'unknown',version:'1:2'},true).ok,false)],
 ['Invalid edit version rejected',()=>assert.equal(validateLead({...good,version:'bad'},true).ok,false)],
 ['Control characters rejected',()=>assert.equal(validateLead({...good,name:'a\u0000b'},false).ok,false)],
 ['Null body rejected',()=>assert.equal(validateLead(null,false).ok,false)],
];
for(const [label,run] of checks){run();console.log('PASS: '+label);}
console.log(`${checks.length}/${checks.length} Phase 13B validation tests passed.`);
