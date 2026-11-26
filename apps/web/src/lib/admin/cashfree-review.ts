import 'server-only';
import { FieldValue, type Firestore, type DocumentReference, type Timestamp } from 'firebase-admin/firestore';
import { reviewCode,reviewLinkValid,reviewChanged,type ReviewCode } from './cashfree-review-view';
export async function recordCashfreeReview(db:Firestore, org:DocumentReference, ref:DocumentReference, orderRef:DocumentReference, expected:{orgId:string;invoiceId:string;orderId:string;amount:number;invoiceVersion:Timestamp;orderVersion:Timestamp}, code:ReviewCode, actorUid:string) {
 if(!reviewCode(code))throw new Error('Invalid review classification');
 return db.runTransaction(async tx=>{
  const [o,s,r]=await Promise.all([tx.get(org),tx.get(ref),tx.get(orderRef)]);
  if(!o.exists||o.get('isDemo')===true||!s.exists||!r.exists||!s.updateTime?.isEqual(expected.invoiceVersion)||!r.updateTime?.isEqual(expected.orderVersion)||!reviewLinkValid(s.data()??{},r.data()??{},expected))throw new Error('Payment changed during review; verify again');
  const changed=reviewChanged(s.get('cashfreeReview'),code);
  // Always refresh the observation timestamp; audit only classification transitions.
  tx.update(ref,{cashfreeReview:{code,observedAt:FieldValue.serverTimestamp(),by:actorUid}});
  if(changed)tx.create(org.collection('auditLogs').doc(),{action:'invoice.cashfree_reviewed',number:s.get('number'),reviewCode:code,by:actorUid,at:FieldValue.serverTimestamp()});
  return {reviewRecorded:true,reviewChanged:changed};
 });
}
