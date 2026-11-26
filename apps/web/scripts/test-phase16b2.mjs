import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
function load(file){const e={};new Function('exports',ts.transpileModule(fs.readFileSync(new URL('../src/lib/auth/'+file+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(e);return e}
const p=load('onboarding-policy'),c=load('customer-policy');
const valid={idToken:'token',currentPassword:'temporary',newPassword:'NewPassphrase!2026'};
const now=1700000000000,token={auth_time:now/1000,firebase:{sign_in_provider:'password'}};
const fixture=()=>({token:{uid:'owner1',orgId:'org1',role:'owner',email:'owner@example.test',email_verified:true,auth_time:now/1000},account:{uid:'owner1',email:'owner@example.test',disabled:false,emailVerified:true,claims:{orgId:'org1',role:'owner'}},profile:{orgId:'org1',email:'owner@example.test'},member:{email:'owner@example.test',role:'owner',mustChangePassword:true},org:{name:'Test Org',ownerUid:'owner1',plan:'trial',status:'trialing',isDemo:false},locked:false,expiryMs:now+1000,now});
let count=0;function test(n,f){f();count++;console.log('PASS: '+n)}
test('Valid password request',()=>assert.deepEqual(p.parseOnboarding(valid),valid));
test('Weak passwords denied',()=>{for(const v of ['short!A1','alllowercase!123','ALLUPPERCASE!123','NoNumberSymbol!','NoSymbol12345','With Space!123','A1!'+ 'a'.repeat(126)])assert.equal(p.strongPassword(v),false)});
test('Boundary password lengths',()=>{assert.ok(p.strongPassword('Aa1!abcdefgh'));assert.ok(p.strongPassword('Aa1!'+ 'x'.repeat(124)))});
test('Current and new must differ',()=>assert.equal(p.parseOnboarding({...valid,currentPassword:valid.newPassword}),null));
test('Missing and injected fields rejected',()=>{assert.equal(p.parseOnboarding({idToken:'x'}),null);assert.equal(p.parseOnboarding({...valid,orgId:'other'}),null)});
test('Invalid payloads rejected',()=>{for(const v of [null,[],42,'x'])assert.equal(p.parseOnboarding(v),null)});
test('Token length bounded',()=>assert.equal(p.parseOnboarding({...valid,idToken:'x'.repeat(16385)}),null));
test('Current password bounded',()=>assert.equal(p.parseOnboarding({...valid,currentPassword:'x'.repeat(4097)}),null));
test('Recent password provider accepted',()=>assert.equal(p.recentPasswordToken(token,now),true));
test('Non-password provider denied',()=>assert.equal(p.recentPasswordToken({...token,firebase:{sign_in_provider:'google.com'}},now),false));
test('Stale or future authentication denied',()=>{for(const n of [now/1000-301,now/1000+1,NaN,1.5])assert.equal(p.recentPasswordToken({...token,auth_time:n},now),false)});
test('Pending member can set password only',()=>{assert.ok(c.customerContext(fixture(),'onboarding'));assert.equal(c.customerContext(fixture()),null)});
test('Already active member cannot onboard',()=>{const x=fixture();x.member.mustChangePassword=false;assert.equal(c.customerContext(x,'onboarding'),null);assert.ok(c.customerContext(x))});
for(const [label,mutate] of [['Locked member',x=>x.locked=true],['Unverified member',x=>x.token.email_verified=false],['Disabled account',x=>x.account.disabled=true],['Wrong tenant',x=>x.profile.orgId='other'],['Wrong role',x=>x.member.role='viewer'],['Platform account',x=>x.token.platformAdmin=true],['Suspended org',x=>x.org.status='suspended'],['Expired org',x=>x.expiryMs=now]])test(label+' denied onboarding',()=>{const x=fixture();mutate(x);assert.equal(c.customerContext(x,'onboarding'),null)});
test('Cutoff advances to following second',()=>assert.equal(p.nextAuthTime(now+999),now/1000+1));
test('Old auth time cannot establish workspace',()=>{const x=fixture();x.member.mustChangePassword=false;x.member.minAuthTime=now/1000+1;assert.equal(c.customerContext(x),null);x.token.auth_time++;assert.ok(c.customerContext(x))});
test('Malformed cutoff fails closed',()=>{const x=fixture();x.member.mustChangePassword=false;x.member.minAuthTime='0';assert.equal(c.customerContext(x),null)});
console.log(`${count}/${count} Phase 16B2 onboarding tests passed.`);
