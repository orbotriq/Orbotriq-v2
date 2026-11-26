import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const compile = path => ts.transpileModule(fs.readFileSync(path,"utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const adminCode=compile("src/lib/firebase/admin.ts"), clientCode=compile("src/lib/firebase/client.ts");
const safe={NODE_ENV:"development",ORBOTRIQ_FIREBASE_MODE:"emulator",NEXT_PUBLIC_FIREBASE_MODE:"emulator",FIREBASE_PROJECT_ID:"demo-orbotriq-v2",NEXT_PUBLIC_FIREBASE_PROJECT_ID:"demo-orbotriq-v2",FIREBASE_AUTH_EMULATOR_HOST:"127.0.0.1:9099",FIRESTORE_EMULATOR_HOST:"127.0.0.1:8081",NEXT_PUBLIC_FIREBASE_API_KEY:"demo-api-key",NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:"demo-orbotriq-v2.firebaseapp.com",NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:"demo-orbotriq-v2.appspot.com",NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:"123456789",NEXT_PUBLIC_FIREBASE_APP_ID:"1:123456789:web:orbotriq-demo"};
function load(code, overrides={}, existing=[]) {
 const exports={}, calls=[], apps=[...existing], auth={}, db={}, credential={};
 vm.runInNewContext(code,{exports,process:{env:{...safe,...overrides}},require(name){
  if(name==="server-only") return {};
  if(name==="firebase-admin/app"||name==="firebase/app") return {applicationDefault(){calls.push("adc");return credential;},getApps:()=>apps,initializeApp(options,name){calls.push("initialize");const app={name,options};apps.push(app);return app;}};
  if(name==="firebase-admin/auth"||name==="firebase/auth") return {getAuth(){calls.push("auth");return auth;},connectAuthEmulator(a,url){assert.equal(a,auth);assert.equal(url,"http://127.0.0.1:9099");calls.push("auth-emulator");}};
  if(name==="firebase-admin/firestore"||name==="firebase/firestore") return {getFirestore(){calls.push("db");return db;},connectFirestoreEmulator(d,h,p){assert.equal(d,db);assert.equal(h,"127.0.0.1");assert.equal(p,8081);calls.push("db-emulator");}};
  throw new Error("Unexpected import: "+name);
 }});
 return {exports,calls,apps};
}
const stage={NODE_ENV:"production",ORBOTRIQ_FIREBASE_MODE:"staging",ORBOTRIQ_STAGING_RUNTIME:"approved-readonly",K_SERVICE:"staging-service",NEXT_PUBLIC_FIREBASE_MODE:"staging",FIREBASE_PROJECT_ID:"orbotriq-v2-staging",NEXT_PUBLIC_FIREBASE_PROJECT_ID:"orbotriq-v2-staging",NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST:undefined,FIREBASE_AUTH_EMULATOR_HOST:undefined,FIRESTORE_EMULATOR_HOST:undefined,NEXT_PUBLIC_FIREBASE_API_KEY:"AIza"+"A".repeat(35),NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:"orbotriq-v2-staging.firebaseapp.com",NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:"orbotriq-v2-staging.firebasestorage.app",NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:"587902200294",NEXT_PUBLIC_FIREBASE_APP_ID:"1:587902200294:web:698daec9d83ec460934e27",CASHFREE_ENV:"disabled"};
let passed=0;
function test(name,fn){fn();passed++;console.log("PASS: "+name);}
function denyAdmin(name,env){test(name,()=>{const a=load(adminCode,{...stage,...env});assert.throws(()=>a.exports.adminDb(),/Firebase/);assert.equal(a.calls.length,0);});}
function denyClient(name,env){test(name,()=>{const a=load(clientCode,{...stage,...env});assert.throws(()=>a.exports.firebaseAuth(),/Firebase/);assert.equal(a.calls.length,0);});}
test("Approved staging uses explicit project and ADC",()=>{const a=load(adminCode,stage);a.exports.adminAuth();a.exports.adminDb();assert.deepEqual(a.calls,["adc","initialize","auth","adc","db"]);assert.equal(a.apps[0].options.projectId,stage.FIREBASE_PROJECT_ID);assert.equal(a.apps[0].name,"orbotriq-staging-readonly");assert.ok(a.apps[0].options.credential);});
denyAdmin("Local development denied staging",{NODE_ENV:"development"});
denyAdmin("Missing runtime approval denied",{ORBOTRIQ_STAGING_RUNTIME:undefined});
denyAdmin("Missing Cloud Run marker denied",{K_SERVICE:undefined});
denyAdmin("Shared project denied",{FIREBASE_PROJECT_ID:"vaanio-app",NEXT_PUBLIC_FIREBASE_PROJECT_ID:"vaanio-app"});
denyAdmin("Wrong public project denied",{NEXT_PUBLIC_FIREBASE_PROJECT_ID:"vaanio-app"});
denyAdmin("Wrong public mode denied",{NEXT_PUBLIC_FIREBASE_MODE:"emulator"});
denyAdmin("Wrong web app denied",{NEXT_PUBLIC_FIREBASE_APP_ID:"not-approved"});
denyAdmin("Wrong auth domain denied",{NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:"vaanio-app.firebaseapp.com"});
denyAdmin("Wrong sender denied",{NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:"123"});
denyAdmin("Wrong Google Cloud project denied",{GOOGLE_CLOUD_PROJECT:"vaanio-app"});
denyAdmin("Wrong legacy cloud project denied",{GCLOUD_PROJECT:"vaanio-app"});
denyAdmin("Auth emulator contamination denied",{FIREBASE_AUTH_EMULATOR_HOST:"127.0.0.1:9099"});
denyAdmin("Firestore emulator contamination denied",{FIRESTORE_EMULATOR_HOST:"127.0.0.1:8081"});
denyAdmin("Credential file override denied",{GOOGLE_APPLICATION_CREDENTIALS:"dummy.json"});
denyAdmin("Private key override denied",{FIREBASE_PRIVATE_KEY:"dummy"});
denyAdmin("Explicit service account override denied",{FIREBASE_CLIENT_EMAIL:"dummy"});
denyAdmin("Live payment mode denied",{CASHFREE_ENV:"production"});
denyAdmin("Sandbox payment mode remains disabled",{CASHFREE_ENV:"sandbox"});
denyAdmin("Unexpected gateway ID denied",{CASHFREE_APP_ID:"dummy"});
denyAdmin("Unexpected gateway secret denied",{CASHFREE_SECRET_KEY:"dummy"});
test("Unexpected cached staging credential rejected",()=>{const a=load(adminCode,stage,[{name:"orbotriq-staging-readonly",options:{projectId:stage.FIREBASE_PROJECT_ID,credential:{}}}]);assert.throws(()=>a.exports.adminDb(),/Firebase/);assert.deepEqual(a.calls,["adc"]);});
test("Staging client initializes auth only",()=>{const a=load(clientCode,stage);a.exports.firebaseAuth();a.exports.firebaseAuth();assert.deepEqual(a.calls,["initialize","auth","auth"]);assert.throws(()=>a.exports.firestore(),/Firebase/);assert.equal(a.apps[0].name,"orbotriq-staging-readonly");});
denyClient("Client rejects wrong project",{NEXT_PUBLIC_FIREBASE_PROJECT_ID:"vaanio-app"});
denyClient("Client rejects wrong app",{NEXT_PUBLIC_FIREBASE_APP_ID:"other"});
denyClient("Client rejects wrong auth domain",{NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:"vaanio-app.firebaseapp.com"});
denyClient("Client rejects wrong sender",{NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:"123"});
denyClient("Client rejects malformed API key",{NEXT_PUBLIC_FIREBASE_API_KEY:"demo-api-key"});
denyClient("Client rejects wrong bucket",{NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:"vaanio-app.appspot.com"});
denyClient("Client rejects staging in dev",{NODE_ENV:"development"});
test("Optional storage bucket supported",()=>{const a=load(clientCode,{...stage,NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:undefined});a.exports.firebaseAuth();assert.deepEqual(a.calls,["initialize","auth"]);});
const authCode=compile("src/lib/auth/authorization.ts");
const token={uid:"orbotriq-staging-admin",email:"staging-admin@orbotriq.test",email_verified:true,platformAdmin:true,firebase:{sign_in_provider:"password"}};
const account={uid:token.uid,email:token.email,disabled:false,emailVerified:true,customClaims:{platformAdmin:true}};
async function approval(t,u,mode="staging") {const exports={};vm.runInNewContext(authCode,{exports,process:{env:{ORBOTRIQ_FIREBASE_MODE:mode}},require(name){if(name==="server-only")return {};if(name==="@/lib/firebase/admin")return {adminAuth:()=>({getUser:async()=>u})};throw Error(name);}});return exports.isApprovedUser(t);}
async function check(name,t,u,expected,mode){assert.equal(await approval(t,u,mode),expected);passed++;console.log("PASS: "+name);}
await check("Approved staging admin accepted",token,account,true);
await check("Other UID rejected",{...token,uid:"other"},account,false);
await check("Other email rejected",{...token,email:"other@orbotriq.test"},account,false);
await check("Other provider rejected",{...token,firebase:{sign_in_provider:"google.com"}},account,false);
await check("Missing platform claim rejected",{...token,platformAdmin:false},account,false);
await check("Live email mismatch denied",token,{...account,email:"other@orbotriq.test"},false);
await check("Disabled account denied",token,{...account,disabled:true},false);
await check("Revoked live admin claim denied",token,{...account,customClaims:{}},false);
await check("Emulator approval unchanged",{...token,uid:"other"},account,true,"emulator");
test("Write guard unchanged and disabled in staging",()=>{const exports={};vm.runInNewContext(compile("src/lib/admin/write-guard.ts"),{exports,process:{env:stage},require(){return {};}});assert.equal(exports.isAdminWriteEnabled(),false);});
assert.equal(passed,41);console.log(`${passed}/${passed} Phase 16E3 staging tests passed.`);
