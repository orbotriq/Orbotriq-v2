import 'server-only';
import { PROVISIONING_PATH, provisioningFromSnapshot } from './platform-provisioning';
import { gatewayStatus } from './platform-provisioning-view';
import { validTaxInvoiceId } from './platform-billing-view';
import { recoveryDecision, mayCreateMissingOrder, safePaymentId } from './cashfree-recovery';
import { recordCashfreeReview } from './cashfree-review';
import type { ReviewCode } from './cashfree-review-view';
import { settleConfirmedCashfree } from './cashfree-settlement';
import { exactPaise } from './cashfree-settlement-policy';
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { requireAdminWrite, isAdminWriteEnabled } from './write-guard';
const inputSchema=z.object({action:z.enum(['create','verify','review']),orgId:z.string().regex(/^test-[a-zA-Z0-9_-]{1,95}$/),invoiceId:z.string().refine(validTaxInvoiceId)}).strict();
const orderSchema=z.object({order_id:z.string(),order_amount:z.number(),order_currency:z.string(),order_status:z.string(),payment_session_id:z.string().optional()});
const paymentsSchema=z.array(z.object({order_id:z.string(),cf_payment_id:z.union([z.string(),z.number()]),payment_status:z.string(),payment_amount:z.number(),payment_currency:z.string()}));
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
 const d=inputSchema.parse(input);if(!gatewayStatus(true,process.env.CASHFREE_ENV,process.env.CASHFREE_APP_ID,process.env.CASHFREE_SECRET_KEY).ready)throw new Error('Sandbox credentials required');const db=adminDb();const org=db.collection('orgs').doc(d.orgId);const ref=org.collection('invoices').doc(d.invoiceId);
 const orderId='orb_'+createHash('sha256').update(`${d.orgId}/${d.invoiceId}`).digest('hex').slice(0,40);
 const orderRef=db.collection('phase12CashfreeOrders').doc(orderId);
 const reservation=await db.runTransaction(async tx=>{if(d.action==='create'&&!provisioningFromSnapshot(await tx.get(db.doc(PROVISIONING_PATH))).cashfreeCheckoutEnabled)throw new Error('New sandbox checkout disabled');const [o,s,r]=await Promise.all([tx.get(org),tx.get(ref),tx.get(orderRef)]);const n=s.get('totalPaise');if(!o.exists||o.get('isDemo')===true||s.get('phase12Test')!==true||s.get('kind')!=='tax'||!Number.isSafeInteger(n)||n<100||n>1000000000)throw new Error('Invoice unavailable');
 if(s.get('status')!=='issued'&&!(d.action==='verify'&&s.get('status')==='paid'&&s.get('cashfreeOrderId')===orderId))throw new Error('Invoice unavailable');
 if(r.exists&&s.get('cashfreeOrderId')!==orderId)throw new Error('Order link conflict');
 if(!r.exists&&s.get('cashfreeOrderId'))throw new Error('Order link conflict');
 if(r.exists&&(r.get('amountPaise')!==n||r.get('orgId')!==d.orgId||r.get('invoiceId')!==d.invoiceId))throw new Error('Order conflict');
 if(d.action!=='create'&&!r.exists)throw new Error('Create order first');
 if(!r.exists){tx.create(orderRef,{orgId:d.orgId,invoiceId:d.invoiceId,amountPaise:n,status:'reserved',createdAt:FieldValue.serverTimestamp(),createdBy:actorUid});tx.update(ref,{cashfreeOrderId:orderId});}return {amount:n as number,newlyReserved:!r.exists,locallyPaid:s.get('status')==='paid',invoiceVersion:s.updateTime,orderVersion:r.updateTime};});
 const {amount,newlyReserved,locallyPaid,invoiceVersion,orderVersion}=reservation;
 const held=async(code:ReviewCode)=>{
  if(d.action!=='review')return {ok:true,pending:true,orderStatus:code};
  if(!invoiceVersion||!orderVersion)throw new Error('Review requires an existing reservation');
  const recorded=await recordCashfreeReview(db,org,ref,orderRef,{orgId:d.orgId,invoiceId:d.invoiceId,orderId,amount,invoiceVersion,orderVersion},code,actorUid);
  return {ok:true,pending:true,orderStatus:code,...recorded};
 };
 let raw=await api('/orders/'+orderId);
 if(raw===null&&mayCreateMissingOrder(d.action,newlyReserved))raw=await api('/orders',{order_id:orderId,order_amount:amount/100,order_currency:'INR',customer_details:{customer_id:orderId,customer_phone:'9999999999'}});
 if(raw===null)return held('MISSING_REVIEW');
 const order=orderSchema.parse(raw);if(order.order_id!==orderId||order.order_currency!=='INR'||!exactPaise(order.order_amount,amount))throw new Error('Order mismatch');
 const payments=paymentsSchema.parse(await api('/orders/'+orderId+'/payments'));
 const decision=recoveryDecision(orderId,order.order_status,payments,Boolean(order.payment_session_id),locallyPaid);
 if(decision==='CHECKOUT'&&d.action==='create'&&order.payment_session_id)return {ok:true,paymentSessionId:order.payment_session_id};
 if(decision!=='SETTLE')return held(decision==='CHECKOUT'?'ACTIVE_RETRY':decision);
 const successful=payments.filter(p=>p.payment_status==='SUCCESS');if(successful.length!==1||successful[0].payment_currency!=='INR'||!exactPaise(successful[0].payment_amount,amount))throw new Error('Payment requires review');const paymentId=safePaymentId(successful[0].cf_payment_id);if(!paymentId)throw new Error('Invalid payment ID');
 await settleConfirmedCashfree(db,{orgId:d.orgId,invoiceId:d.invoiceId,orderId,paymentId,amount},actorUid);
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
