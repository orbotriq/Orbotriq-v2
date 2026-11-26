import 'server-only';
import {createHash} from 'node:crypto';
import {FieldValue,type Firestore} from 'firebase-admin/firestore';
import {applyRenewal} from './renewal';
import {validTaxInvoiceId} from './platform-billing-view';
import {safePaymentId} from './cashfree-recovery';
import {settlementState} from './cashfree-settlement-policy';
// Called only after the server has independently confirmed a successful gateway payment.
export async function settleConfirmedCashfree(db:Firestore,e:{orgId:string;invoiceId:string;orderId:string;paymentId:string;amount:number},actorUid:string){
 if(process.env.NODE_ENV!=='development'||process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8081'||process.env.FIREBASE_PROJECT_ID!=='demo-orbotriq-v2')throw new Error('Sandbox settlement disabled');
 if(!/^test-[a-zA-Z0-9_-]{1,95}$/.test(e.orgId)||!validTaxInvoiceId(e.invoiceId)||e.orderId!=='orb_'+createHash('sha256').update(`${e.orgId}/${e.invoiceId}`).digest('hex').slice(0,40)||safePaymentId(e.paymentId)!==e.paymentId||!Number.isSafeInteger(e.amount)||e.amount<100||e.amount>1000000000)throw new Error('Invalid settlement identity');
 const org=db.collection('orgs').doc(e.orgId),ref=org.collection('invoices').doc(e.invoiceId),orderRef=db.collection('phase12CashfreeOrders').doc(e.orderId),paymentRef=db.collection('phase12CashfreePayments').doc(e.paymentId);
 return db.runTransaction(async tx=>{
  const [s,r,p,o]=await Promise.all([tx.get(ref),tx.get(orderRef),tx.get(paymentRef),tx.get(org)]);
  if(!o.exists||o.get('isDemo')===true||!s.exists||!r.exists)throw new Error('Invoice changed');
  const state=settlementState(s.data()??{},r.data()??{},p.exists?p.data()??{}:null,e);
  if(state==='DUPLICATE')return {duplicate:true};
  if(state!=='SETTLE')throw new Error('Payment conflict');
  tx.create(paymentRef,{orderId:e.orderId,orgId:e.orgId,invoiceId:e.invoiceId,amountPaise:e.amount,at:FieldValue.serverTimestamp()});
  tx.update(orderRef,{status:'paid',paymentId:e.paymentId});
  const renewal=applyRenewal(tx,org,o,s,actorUid);
  tx.update(ref,{...renewal,status:'paid',paymentMode:'Cashfree sandbox',paymentRef:e.paymentId,paidAt:FieldValue.serverTimestamp(),paidOn:new Date().toISOString().slice(0,10)});
  tx.create(org.collection('auditLogs').doc(),{action:'invoice.paid',number:s.get('number'),by:actorUid,at:FieldValue.serverTimestamp()});
  return {duplicate:false};
 });
}
