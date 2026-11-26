import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/lib/admin/lead-followup.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports={};new Function('exports',js)(exports);
const {parseFollowUp,followUpInput,followUpStatus,validateActivity}=exports;
const good={action:'schedule',version:'123:45',followUp:'2026-11-26T10:30'};
const note={action:'record',version:'123:45',kind:'note',note:' Test note '};
const now=Date.parse('2026-11-26T00:00:00Z');
const checks=[
 ['IST converted to UTC',()=>assert.equal(parseFollowUp(good.followUp),Date.parse('2026-11-26T05:00:00Z'))],
 ['Round trip',()=>assert.equal(followUpInput(parseFollowUp(good.followUp)),good.followUp)],
 ['Invalid date',()=>assert.equal(parseFollowUp('2026-02-30T10:00'),null)],
 ['Invalid hour',()=>assert.equal(parseFollowUp('2026-11-26T24:00'),null)],
 ['Leap date',()=>assert.notEqual(parseFollowUp('2028-02-29T10:00'),null)],
 ['Timezone injection rejected',()=>assert.equal(parseFollowUp('2026-11-26T10:00Z'),null)],
 ['Today in IST',()=>assert.equal(followUpStatus(parseFollowUp('2026-11-26T01:00'),now),'Today')],
 ['Overdue in IST',()=>assert.equal(followUpStatus(parseFollowUp('2026-11-25T23:59'),now),'Overdue')],
 ['Upcoming',()=>assert.equal(followUpStatus(parseFollowUp('2026-11-27T00:00'),now),'Upcoming')],
 ['No follow-up',()=>assert.equal(followUpStatus(null,now),'None')],
 ['Schedule valid',()=>assert.ok(validateActivity(good).ok)],
 ['Clear valid',()=>assert.ok(validateActivity({...good,followUp:null}).ok)],
 ['Missing date rejected',()=>assert.equal(validateActivity({...good,followUp:undefined}).ok,false)],
 ['Invalid version rejected',()=>assert.equal(validateActivity({...good,version:'bad'}).ok,false)],
 ['Injected field rejected',()=>assert.equal(validateActivity({...good,by:'other'}).ok,false)],
 ['Note trimmed',()=>{const r=validateActivity(note);assert.ok(r.ok);assert.equal(r.data.note,'Test note');}],
 ['All activity types',()=>{for(const kind of ['note','call','email','meeting'])assert.ok(validateActivity({...note,kind}).ok);}],
 ['Invalid type rejected',()=>assert.equal(validateActivity({...note,kind:'send'}).ok,false)],
 ['Blank note rejected',()=>assert.equal(validateActivity({...note,note:' '}).ok,false)],
 ['Long note rejected',()=>assert.equal(validateActivity({...note,note:'a'.repeat(2001)}).ok,false)],
 ['Control characters rejected',()=>assert.equal(validateActivity({...note,note:'a\u0000b'}).ok,false)],
 ['Unknown action rejected',()=>assert.equal(validateActivity({...note,action:'delete'}).ok,false)],
];
for(const [label,run] of checks){run();console.log('PASS: '+label);}
console.log(`${checks.length}/${checks.length} Phase 13C validation tests passed.`);
