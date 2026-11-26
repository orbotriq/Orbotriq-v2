import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
function load(file){const src=fs.readFileSync(new URL('../src/lib/admin/'+file+'.ts',import.meta.url),'utf8');const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const exports={};new Function('exports',js)(exports);return exports;}
const {validateConversion,eligibleConversionStatus,conversionView}=load('lead-conversion-view');
const {csvCell,leadCsv}=load('lead-csv');
const good={name:' Test company ',trialDays:14,version:'123:45'};
const id='12345678901234567890';
const checks=[
 ['Valid input normalized',()=>assert.deepEqual(validateConversion(good),{ok:true,name:'Test company',trialDays:14,version:'123:45'})],
 ['Short name rejected',()=>assert.equal(validateConversion({...good,name:'x'}).ok,false)],
 ['Long name rejected',()=>assert.equal(validateConversion({...good,name:'a'.repeat(81)}).ok,false)],
 ['Control character rejected',()=>assert.equal(validateConversion({...good,name:'a\nb'}).ok,false)],
 ['Invalid trial duration rejected',()=>{for(const trialDays of [0,91,1.5,'14',null])assert.equal(validateConversion({...good,trialDays}).ok,false);}],
 ['Invalid version rejected',()=>assert.equal(validateConversion({...good,version:'x'}).ok,false)],
 ['Injected owner rejected',()=>assert.equal(validateConversion({...good,ownerEmail:'x@orbotriq.test'}).ok,false)],
 ['Null input rejected',()=>assert.equal(validateConversion(null).ok,false)],
 ['Eligible statuses',()=>{for(const s of ['qualified','proposal sent','demo given'])assert.ok(eligibleConversionStatus(s));}],
 ['Ineligible statuses',()=>{for(const s of ['new','contacted','won','lost',null])assert.equal(eligibleConversionStatus(s),false);}],
 ['No conversion',()=>assert.deepEqual(conversionView(undefined),{state:'none',orgId:null})],
 ['Pending conversion',()=>assert.equal(conversionView({state:'reserved',orgId:id}).state,'pending')],
 ['Provisioned conversion pending',()=>assert.equal(conversionView({state:'provisioned',orgId:id}).state,'pending')],
 ['Completed conversion',()=>assert.deepEqual(conversionView({state:'complete',orgId:id}),{state:'complete',orgId:id})],
 ['Malformed conversion requires review',()=>assert.equal(conversionView({state:'complete',orgId:'../bad'}).state,'review')],
 ['CSV quotes and separators escaped',()=>assert.equal(csvCell('a,"b"'),'"a,""b"""')],
 ['Formula prefixes neutralized',()=>{for(const v of ['=1+1','+123','-12','@SUM(A1)','  =1','\t=1','＝1'])assert.ok(csvCell(v).startsWith("\"'"));}],
 ['CSV multiline quoted',()=>assert.equal(csvCell('a\nb'),'"a\nb"')],
 ['CSV header and CRLF',()=>assert.equal(leadCsv([['Name','Email'],['A','a@test.test']]),'\uFEFF"Name","Email"\r\n"A","a@test.test"\r\n')],
 ['CSV blank cells',()=>assert.equal(csvCell(''),'""')]
];
for(const [label,run] of checks){run();console.log('PASS: '+label);}
console.log(`${checks.length}/${checks.length} Phase 13D validation tests passed.`);
