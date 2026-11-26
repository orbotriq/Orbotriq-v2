import 'server-only';
import { applyRenewal } from './renewal';
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { requireAdminWrite, isAdminWriteEnabled } from './write-guard';
const inputSchema=z.object({action:z.enum(['create','verify']),orgId:z.string().regex(/^test-[a-zA-Z0-9_-]{1,95}$/),invoiceId:z.string().regex(/^TST-\d{2}-\d{2}-\d{4}$/)}).strict();
const orderSchema=z.object({order_id:z.string(),order_amount:z.number(),order_currency:z.string(),order_status:z.string(),payment_session_id:z.string().optional()});
const paymentsSchema=z.array(z.object({cf_payment_id:z.union([z.string(),z.number()]),payment_status:z.string(),payment_amount:z.number(),payment_currency:z.string()}));
async function api(path:string,body?:object){
 const app=process.env.CASHFREE_APP_ID, secret=process.env.CASHFREE_SECRET_KEY;
 if(process.env.CASHFREE_ENV!=='sandbox'||!app||!secret)throw new Error('Sandbox credentials required');
 const response=await fetch('https://sandbox.cashfree.com/pg'+path,{method:body?'POST':'GET',headers:{'x-client-id':app,'x-client-secret':secret,'x-api-version':'2023-08-01','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(response.status===404)return null;
 if(!response.ok)throw new Error('Cashfree request failed');
 return response.json() as Promise<unknown>;
}
export async function cashfree(input:unknown){
 const actor=await requireAdminWrite();return processOrder(input,actor.uid);
}
async function processOrder(input:unknown,actorUid:string){
 if(!isAdminWriteEnabled())throw new Error('Writes disabled');
 const d=inputSchema.parse(input);const db=adminDb();const org=db.collection('orgs').doc(d.orgId);const ref=org.collection('invoices').doc(d.invoiceId);
 const orderId='orb_'+createHash('sha256').update(`${d.orgId}/${d.invoiceId}`).digest('hex').slice(0,40);
 const orderRef=db.collection('phase12CashfreeOrders').doc(orderId);
 const amount=await db.runTransaction(async tx=>{const [o,s,r]=await Promise.all([tx.get(org),tx.get(ref),tx.get(orderRef)]);const n=s.get('totalPaise');if(!o.exists||o.get('isDemo')===true||s.get('phase12Test')!==true||s.get('kind')!=='tax'||!Number.isSafeInteger(n)||n<100||n>1000000000)throw new Error('Invoice unavailable');
 if(s.get('status')!=='issued'&&!(d.action==='verify'&&s.get('status')==='paid'&&s.get('cashfreeOrderId')===orderId))throw new Error('Invoice unavailable');
 if(r.exists&&(r.get('amountPaise')!==n||r.get('orgId')!==d.orgId||r.get('invoiceId')!==d.invoiceId))throw new Error('Order conflict');
 if(d.action==='verify'&&!r.exists)throw new Error('Create order first');
 if(!r.exists){tx.create(orderRef,{orgId:d.orgId,invoiceId:d.invoiceId,amountPaise:n,status:'reserved',createdAt:FieldValue.serverTimestamp(),createdBy:actorUid});tx.update(ref,{cashfreeOrderId:orderId});}return n as number;});
 let raw=await api('/orders/'+orderId);
 if(raw===null&&d.action==='create')raw=await api('/orders',{order_id:orderId,order_amount:amount/100,order_currency:'INR',customer_details:{customer_id:orderId,customer_phone:'9999999999'}});
 const order=orderSchema.parse(raw);if(order.order_id!==orderId||order.order_currency!=='INR'||Math.round(order.order_amount*100)!==amount)throw new Error('Order mismatch');
 if(d.action==='create'&&order.order_status==='ACTIVE'&&order.payment_session_id)return {ok:true,paymentSessionId:order.payment_session_id};
 if(order.order_status!=='PAID')return {ok:true,pending:true,orderStatus:order.order_status};
 const payments=paymentsSchema.parse(await api('/orders/'+orderId+'/payments'));const successful=payments.filter(p=>p.payment_status==='SUCCESS');if(successful.length!==1||successful[0].payment_currency!=='INR'||Math.round(successful[0].payment_amount*100)!==amount)throw new Error('Payment requires review');const paymentId=String(successful[0].cf_payment_id);if(!/^\d{1,40}$/.test(paymentId))throw new Error('Invalid payment ID');
 const paymentRef=db.collection('phase12CashfreePayments').doc(paymentId);
 await db.runTransaction(async tx=>{const [s,r,p,o]=await Promise.all([tx.get(ref),tx.get(orderRef),tx.get(paymentRef),tx.get(org)]);if(s.get('cashfreeOrderId')!==orderId||s.get('totalPaise')!==amount||s.get('phase12Test')!==true||r.get('amountPaise')!==amount)throw new Error('Invoice changed');if(p.exists){if(p.get('orderId')===orderId&&s.get('status')==='paid'&&s.get('paymentRef')===paymentId)return;throw new Error('Payment conflict');}if(s.get('status')!=='issued')throw new Error('Invoice already settled');tx.create(paymentRef,{orderId,orgId:d.orgId,invoiceId:d.invoiceId,amountPaise:amount,at:FieldValue.serverTimestamp()});tx.update(orderRef,{status:'paid',paymentId});const renewal=applyRenewal(tx,org,o,s,actorUid);tx.update(ref,{...renewal,status:'paid',paymentMode:'Cashfree sandbox',paymentRef:paymentId,paidAt:FieldValue.serverTimestamp(),paidOn:new Date().toISOString().slice(0,10)});tx.create(org.collection('auditLogs').doc(),{action:'invoice.paid',number:s.get('number'),by:actorUid,at:FieldValue.serverTimestamp()});});
 return {ok:true,paid:true};
}

export async function reconcileWebhook(orderId:string){
 if(!isAdminWriteEnabled()||process.env.CASHFREE_ENV!=='sandbox'||!/^orb_[a-f0-9]{40}$/.test(orderId))throw new Error('Invalid webhook order');
 const r=await adminDb().collection('phase12CashfreeOrders').doc(orderId).get();
 if(!r.exists)return {ok:true,ignored:true};
 const orgId=r.get('orgId'),invoiceId=r.get('invoiceId');
 if('orb_'+createHash('sha256').update(`${orgId}/${invoiceId}`).digest('hex').slice(0,40)!==orderId)throw new Error('Order mismatch');
 return processOrder({action:'verify',orgId,invoiceId},'cashfree-sandbox-webhook');
}
