import 'server-only';
import { FieldValue, Timestamp, type Transaction, type DocumentSnapshot, type DocumentReference } from 'firebase-admin/firestore';
import { renewalExpiry } from './renewal-math';
export function eligibleRenewal(o:DocumentSnapshot,plan:unknown){return o.exists&&o.get('isDemo')!==true&&typeof plan==='string'&&/^[a-z0-9][a-z0-9-]{1,39}$/.test(plan)&&!['trial','demo','create'].includes(plan)&&o.get('plan')===plan&&['active','expired'].includes(o.get('status'))&&o.get('paidUntil') instanceof Timestamp;}
// Payment is recorded even when renewal requires review. No automatic plan changes or reactivation.
export function applyRenewal(tx:Transaction,org:DocumentReference,o:DocumentSnapshot,s:DocumentSnapshot,actor:string){
 const a=s.get('apply'); if(a==null)return {};
 if(s.get('applied')===true)return {renewalStatus:'applied'};
 if(!eligibleRenewal(o,a.planId)||!Number.isInteger(a.days)||a.days<1||a.days>90||s.get('kind')!=='tax')return {renewalStatus:'review'};
 const old=o.get('paidUntil') as Timestamp;
 let next:Timestamp;try{next=Timestamp.fromMillis(renewalExpiry(Date.now(),old.toMillis(),a.days));}catch{return {renewalStatus:'review'};}
 tx.update(org,{paidUntil:next});
 tx.create(org.collection('auditLogs').doc(),{action:'subscription.renewed',number:s.get('number'),by:actor,at:FieldValue.serverTimestamp(),previousExpiry:old,nextExpiry:next,days:a.days});
 return {applied:true,renewalStatus:'applied'};
}
