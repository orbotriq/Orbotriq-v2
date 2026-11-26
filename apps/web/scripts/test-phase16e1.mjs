import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const compile = path => ts.transpileModule(fs.readFileSync(path,"utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const adminCode=compile("src/lib/firebase/admin.ts"), clientCode=compile("src/lib/firebase/client.ts");
const safe={NODE_ENV:"development",ORBOTRIQ_FIREBASE_MODE:"emulator",NEXT_PUBLIC_FIREBASE_MODE:"emulator",FIREBASE_PROJECT_ID:"demo-orbotriq-v2",NEXT_PUBLIC_FIREBASE_PROJECT_ID:"demo-orbotriq-v2",FIREBASE_AUTH_EMULATOR_HOST:"127.0.0.1:9099",FIRESTORE_EMULATOR_HOST:"127.0.0.1:8081",NEXT_PUBLIC_FIREBASE_API_KEY:"demo-api-key",NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:"demo-orbotriq-v2.firebaseapp.com",NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:"demo-orbotriq-v2.appspot.com",NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:"123456789",NEXT_PUBLIC_FIREBASE_APP_ID:"1:123456789:web:orbotriq-demo"};
function load(code, overrides={}, existing=[]) {
 const exports={}, calls=[], apps=[...existing], auth={}, db={};
 vm.runInNewContext(code,{exports,process:{env:{...safe,...overrides}},require(name){
  if(name==="server-only") return {};
  if(name==="firebase-admin/app"||name==="firebase/app") return {getApps:()=>apps,initializeApp(options,name){calls.push("initialize");const app={name,options};apps.push(app);return app;}};
  if(name==="firebase-admin/auth"||name==="firebase/auth") return {getAuth(){calls.push("auth");return auth;},connectAuthEmulator(a,url){assert.equal(a,auth);assert.equal(url,"http://127.0.0.1:9099");calls.push("auth-emulator");}};
  if(name==="firebase-admin/firestore"||name==="firebase/firestore") return {getFirestore(){calls.push("db");return db;},connectFirestoreEmulator(d,h,p){assert.equal(d,db);assert.equal(h,"127.0.0.1");assert.equal(p,8081);calls.push("db-emulator");}};
  throw new Error("Unexpected import: "+name);
 }});
 return {exports,calls};
}
let passed=0;
function test(name,fn){fn();passed++;console.log("PASS: "+name);}
function adminDenied(name,env,apps){test(name,()=>{const a=load(adminCode,env,apps);assert.throws(()=>a.exports.adminAuth(),/Firebase/);assert.throws(()=>a.exports.adminDb(),/Firebase/);assert.equal(a.calls.length,0);});}
function clientDenied(name,env,apps){test(name,()=>{const a=load(clientCode,env,apps);assert.throws(()=>a.exports.firebaseAuth(),/Firebase/);assert.throws(()=>a.exports.firestore(),/Firebase/);assert.equal(a.calls.length,0);});}
test("Admin isolated emulator initializes and reuses named app",()=>{const a=load(adminCode);a.exports.adminAuth();a.exports.adminDb();assert.deepEqual(a.calls,["initialize","auth","db"]);});
adminDenied("Admin missing mode fails before SDK",{ORBOTRIQ_FIREBASE_MODE:undefined});
adminDenied("Admin production mode denied",{NODE_ENV:"production"});
adminDenied("Admin disabled hosting denied",{ORBOTRIQ_FIREBASE_MODE:"disabled"});
adminDenied("Admin dummy build cannot access database",{ORBOTRIQ_FIREBASE_MODE:"build-validation",FIREBASE_PROJECT_ID:"demo-orbotriq-build"});
adminDenied("Admin unapproved staging denied",{ORBOTRIQ_FIREBASE_MODE:"staging",FIREBASE_PROJECT_ID:"orbotriq-v2-staging"});
adminDenied("Admin shared project denied",{FIREBASE_PROJECT_ID:"vaanio-app",NEXT_PUBLIC_FIREBASE_PROJECT_ID:"vaanio-app"});
adminDenied("Admin mismatched client project denied",{NEXT_PUBLIC_FIREBASE_PROJECT_ID:"vaanio-app"});
adminDenied("Admin mismatched client mode denied",{NEXT_PUBLIC_FIREBASE_MODE:"disabled"});
adminDenied("Admin remote Auth endpoint denied",{FIREBASE_AUTH_EMULATOR_HOST:"example.test:9099"});
adminDenied("Admin remote Firestore endpoint denied",{FIRESTORE_EMULATOR_HOST:"example.test:8081"});
adminDenied("Admin missing emulator hosts denied",{FIREBASE_AUTH_EMULATOR_HOST:undefined,FIRESTORE_EMULATOR_HOST:undefined});
adminDenied("Admin stale named cloud app rejected",{},[{name:"orbotriq-emulator",options:{projectId:"vaanio-app"}}]);
test("Admin default cloud app never reused",()=>{const a=load(adminCode,{},[{name:"[DEFAULT]",options:{projectId:"vaanio-app"}}]);a.exports.adminDb();assert.deepEqual(a.calls,["initialize","db"]);});
test("Client emulator connects Auth and Firestore exactly once",()=>{const a=load(clientCode);a.exports.firebaseAuth();a.exports.firebaseAuth();a.exports.firestore();a.exports.firestore();assert.deepEqual(a.calls,["initialize","auth","auth-emulator","auth","db","db-emulator","db"]);});
clientDenied("Client missing mode denied",{NEXT_PUBLIC_FIREBASE_MODE:undefined});
clientDenied("Client production mode denied",{NODE_ENV:"production"});
clientDenied("Client build dummy denied",{NEXT_PUBLIC_FIREBASE_MODE:"build-validation"});
clientDenied("Client disabled hosting denied",{NEXT_PUBLIC_FIREBASE_MODE:"disabled"});
clientDenied("Client shared project denied",{NEXT_PUBLIC_FIREBASE_PROJECT_ID:"vaanio-app"});
clientDenied("Client wrong API key denied",{NEXT_PUBLIC_FIREBASE_API_KEY:"not-demo"});
clientDenied("Client wrong Auth domain denied",{NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:"vaanio-app.firebaseapp.com"});
clientDenied("Client wrong app ID denied",{NEXT_PUBLIC_FIREBASE_APP_ID:"not-demo"});
clientDenied("Client wrong bucket denied",{NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:"vaanio-app.appspot.com"});
clientDenied("Client wrong sender ID denied",{NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:"987654"});
clientDenied("Client stale named app rejected",{},[{name:"orbotriq-emulator",options:{projectId:"vaanio-app"}}]);
test("Both hosting configurations disable cloud Firebase",()=>{for(const p of ["apphosting.yaml","../../apphosting.yaml"]){const s=fs.readFileSync(p,"utf8");assert.match(s,/variable: ORBOTRIQ_FIREBASE_MODE\s+value: disabled/);assert.match(s,/variable: NEXT_PUBLIC_FIREBASE_MODE\s+value: disabled/);assert.doesNotMatch(s,/vaanio-app|AIza|secret:|FIREBASE_PRIVATE_KEY/);}});
assert.equal(passed,27);console.log(`${passed}/${passed} Phase 16E1 environment isolation tests passed.`);
