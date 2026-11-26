import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load(path,deps={}){const exports={};const code=ts.transpileModule(readFileSync(new URL('../src/'+path+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports','require',code)(exports,k=>Object.hasOwn(deps,k)?deps[k]:require(k));return exports;}
const p=load('lib/admin/cashfree-settlement-policy'), w=load('lib/admin/cashfree-webhook-policy'), sig=load('lib/admin/cashfree-signature');
const e={orgId:'test-a',invoiceId:'TST-26-27-0001',orderId:'orb_'+'a'.repeat(40),paymentId:'123',amount:11200},i={phase12Test:true,kind:'tax',status:'issued',cashfreeOrderId:e.orderId,totalPaise:e.amount},o={orgId:e.orgId,invoiceId:e.invoiceId,amountPaise:e.amount,status:'reserved'},pay={...e,amountPaise:e.amount};
const raw=JSON.stringify({type:'PAYMENT_SUCCESS_WEBHOOK',data:{order:{order_id:e.orderId},payment:{payment_status:'SUCCESS'}}});
let n=0;async function test(name,fn){await fn();n++;console.log('PASS: '+name)}
await test('Exact paise accepts decimal currency',()=>{assert.ok(p.exactPaise(112,11200));assert.ok(p.exactPaise(1.01,101));assert.ok(p.exactPaise(9999999.99,999999999))});
await test('Fractional paise rejected',()=>assert.equal(p.exactPaise(112.004,11200),false));
await test('Wrong amount and nonnumeric values rejected',()=>{for(const x of [111.99,'112',NaN,Infinity,null])assert.equal(p.exactPaise(x,11200),false)});
await test('Valid reservation settles',()=>assert.equal(p.settlementState(i,o,null,e),'SETTLE'));
await test('Wrong tenant invoice or amount conflicts',()=>{for(const patch of [{orgId:'other'},{invoiceId:'other'},{amountPaise:1}])assert.equal(p.settlementState(i,{...o,...patch},null,e),'CONFLICT')});
await test('Non-test or proforma conflicts',()=>{for(const patch of [{phase12Test:false},{kind:'proforma'},{cashfreeOrderId:'wrong'}])assert.equal(p.settlementState({...i,...patch},o,null,e),'CONFLICT')});
await test('Paid invoice without receipt conflicts',()=>assert.equal(p.settlementState({...i,status:'paid'},o,null,e),'CONFLICT'));
await test('Nonreserved order conflicts',()=>assert.equal(p.settlementState(i,{...o,status:'paid'},null,e),'CONFLICT'));
const pi={...i,status:'paid',paymentRef:e.paymentId},po={...o,status:'paid',paymentId:e.paymentId};
await test('Consistent prior settlement is duplicate',()=>assert.equal(p.settlementState(pi,po,pay,e),'DUPLICATE'));
await test('Prior payment identity conflicts',()=>{for(const patch of [{orderId:'wrong'},{orgId:'other'},{invoiceId:'other'},{amountPaise:1}])assert.equal(p.settlementState(pi,po,{...pay,...patch},e),'CONFLICT')});
await test('Inconsistent paid order conflicts',()=>assert.equal(p.settlementState(pi,{...po,paymentId:'999'},pay,e),'CONFLICT'));
await test('Success event recognized',()=>assert.deepEqual(w.webhookEvent(raw),{kind:'success',orderId:e.orderId}));
await test('Malformed event rejected',()=>{for(const v of ['{','null','[]','{}'])assert.equal(w.webhookEvent(v).kind,'invalid')});
await test('Non-success event ignored',()=>assert.equal(w.webhookEvent('{"type":"PAYMENT_FAILED_WEBHOOK"}').kind,'ignore'));
await test('Invalid success order or status rejected',()=>{for(const v of [raw.replace(e.orderId,'other'),raw.replace('"SUCCESS"','"PENDING"')])assert.equal(w.webhookEvent(v).kind,'invalid')});
await test('Bounded body preserves original text',async()=>{const v=' {"x":"₹"} ';assert.equal(await w.boundedWebhookBody(new Response(v).body),v)});
await test('Byte limit enforced',async()=>assert.equal(await w.boundedWebhookBody(new Response('₹'.repeat(22000)).body),null));
await test('Malformed UTF-8 rejected',async()=>assert.rejects(w.boundedWebhookBody(new Response(new Uint8Array([255])).body)));
const saved={env:process.env.CASHFREE_ENV,secret:process.env.CASHFREE_SECRET_KEY};let calls=0,enabled=true,pending=false,fail=false;
try{process.env.CASHFREE_ENV='sandbox';process.env.CASHFREE_SECRET_KEY='fictional-unit-test-secret';
const route=load('app/api/webhooks/cashfree/route',{'next/server':{NextResponse:{json:(body,opts)=>({body,status:opts?.status??200})}},'@/lib/admin/write-guard':{isAdminWriteEnabled:()=>enabled},'@/lib/admin/cashfree-signature':sig,'@/lib/admin/cashfree-webhook-policy':w,'@/lib/admin/cashfree':{reconcileWebhook:async id=>{assert.equal(id,e.orderId);calls++;if(fail)throw Error('simulated');return pending?{pending:true}:{ok:true,paid:true}}}});
function req(body,stamp=String(Date.now()),signature){return new Request('http://localhost:8080/api/webhooks/cashfree',{method:'POST',body,headers:{'x-webhook-timestamp':stamp,'x-webhook-signature':signature??createHmac('sha256',process.env.CASHFREE_SECRET_KEY).update(stamp+body).digest('base64')}})}
await test('Disabled route rejects before reconciliation',async()=>{enabled=false;assert.equal((await route.POST(req(raw))).status,403);enabled=true;assert.equal(calls,0)});
await test('Bad signature rejected before reconciliation',async()=>{assert.equal((await route.POST(req(raw,String(Date.now()),'bad'))).status,401);assert.equal(calls,0)});
await test('Stale and future timestamps rejected',async()=>{for(const delta of [-301000,301000])assert.equal((await route.POST(req(raw,String(Date.now()+delta)))).status,401);assert.equal(calls,0)});
await test('Signed malformed event rejected',async()=>{assert.equal((await route.POST(req('{'))).status,400);assert.equal(calls,0)});
await test('Signed non-success event ignored',async()=>{assert.equal((await route.POST(req('{"type":"PAYMENT_FAILED_WEBHOOK"}'))).status,200);assert.equal(calls,0)});
await test('Signed success triggers server verification',async()=>{assert.equal((await route.POST(req(raw))).status,200);assert.equal(calls,1)});
await test('Pending and gateway failure return retry response',async()=>{pending=true;assert.equal((await route.POST(req(raw))).status,503);fail=true;assert.equal((await route.POST(req(raw))).status,503);assert.equal(calls,3)});
}finally{for(const [k,v] of [['CASHFREE_ENV',saved.env],['CASHFREE_SECRET_KEY',saved.secret]]){if(v===undefined)delete process.env[k];else process.env[k]=v}}
assert.equal(n,25);console.log(`${n}/${n} Phase 16D3 policy and webhook handler tests passed.`);
