import 'server-only';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { requireAdminWrite, isAdminWriteEnabled } from '@/lib/admin/write-guard';
import { applyRenewal, eligibleRenewal } from './renewal';
import { price } from './billing-math';
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const profile = z.object({legalName:z.string().trim().min(2).max(120),address:z.string().trim().min(5).max(300),stateCode:z.string().regex(/^(0[1-9]|[12][0-9]|3[0-8])$/),gstin:z.string().regex(/^(|\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z])$/)}).strict();
const schema = z.discriminatedUnion('action',[
 z.object({action:z.literal('profile'),orgId:id,profile}).strict(),
 z.object({action:z.literal('issue'),orgId:id,kind:z.enum(['proforma','tax']),description:z.string().trim().min(2).max(160),amount:z.number().int().min(1).max(1000000000),renewalDays:z.number().int().min(0).max(90).optional()}).strict(),
 z.object({action:z.literal('paid'),orgId:id,invoiceId:id,reference:z.string().trim().min(3).max(80),mode:z.enum(['UPI','Bank transfer','Card','Cash','Other'])}).strict(),
 z.object({action:z.literal('convert'),orgId:id,invoiceId:id}).strict()
]);
export async function billing(input:unknown) {
 const actor=await requireAdminWrite();
 const d=schema.parse(input); if(!d.orgId.startsWith('test-')) throw new Error('Only seeded test organizations allowed'); const db=adminDb(); const org=db.collection('orgs').doc(d.orgId);
 return db.runTransaction(async tx=>{
  const o=await tx.get(org); if(!o.exists || o.get('isDemo')===true) throw new Error('Organization unavailable');
  const audit=(action:string,number:string='')=>tx.create(org.collection('auditLogs').doc(),{action,number,by:actor.uid,at:FieldValue.serverTimestamp()});
  const buyerRef=org.collection('billing').doc('profile');
  if(d.action==='profile') { if(d.profile.gstin && !d.profile.gstin.startsWith(d.profile.stateCode)) throw new Error('GSTIN state mismatch'); tx.set(buyerRef,{...d.profile,updatedAt:FieldValue.serverTimestamp(),updatedBy:actor.uid},{merge:true}); audit('billing.profile_saved'); return {ok:true}; }
  if(d.action==='paid') { const ref=org.collection('invoices').doc(d.invoiceId); const s=await tx.get(ref); if(s.get('cashfreeOrderId')) throw new Error('Cashfree order reserved; manual settlement blocked'); if(s.get('phase12Test')!==true || s.get('kind')!=='tax' || s.get('status')!=='issued') throw new Error('Invoice unavailable'); const renewal=applyRenewal(tx,org,o,s,actor.uid); tx.update(ref,{...renewal,status:'paid',paymentMode:d.mode,paymentRef:d.reference,paidAt:FieldValue.serverTimestamp(),paidOn:new Date().toISOString().slice(0,10)}); audit('invoice.paid',s.get('number')); return {ok:true}; }
  const counter=db.doc('platform/phase12TestCounters'); const c=await tx.get(counter);
  const now=new Date(Date.now()+19800000); const y=now.getUTCFullYear()-(now.getUTCMonth()<3?1:0); const fy=`${String(y).slice(-2)}-${String(y+1).slice(-2)}`;
  const kind=d.action==='convert'?'tax':d.kind; const key=`${kind==='tax'?'inv':'pro'}_${fy.replace('-','')}`; const previous=c.get(key)??0; if(!Number.isSafeInteger(previous)||previous<0||previous>=9999) throw new Error('Invalid counter'); const n=previous+1; const number=`${kind==='tax'?'TST':'TPR'}/${fy}/${String(n).padStart(4,'0')}`; const ref=org.collection('invoices').doc(number.replace(/\//g,'-'));
  let data:Record<string,unknown>;
  if(d.action==='convert') { const old=org.collection('invoices').doc(d.invoiceId); const s=await tx.get(old); if(s.get('phase12Test')!==true||s.get('kind')!=='proforma'||s.get('status')!=='issued') throw new Error('Proforma unavailable'); data={...s.data(),convertedFrom:d.invoiceId}; tx.update(old,{status:'converted',convertedTo:ref.id}); }
  else { if(d.renewalDays&&!eligibleRenewal(o,o.get('plan')))throw new Error('Subscription unavailable for renewal'); const v=(await tx.get(buyerRef)).data(); const b=profile.parse({legalName:v?.legalName,address:v?.address,stateCode:v?.stateCode,gstin:v?.gstin??''}); const seller={legalName:'Orbotriq TEST ONLY',address:'Fictional test address',stateCode:'33',gstRegistered:true,gstin:''}; const tax=price(d.amount,18,b.stateCode===seller.stateCode); data={seller,buyer:b,lines:[{desc:d.description,qty:1,ratePaise:d.amount,amountPaise:d.amount}],...tax,taxMode:b.stateCode==='33'?'intra':'inter',apply:d.renewalDays?{planId:o.get('plan'),days:d.renewalDays}:null,applied:false,renewalStatus:d.renewalDays?'pending':'none'}; }
  tx.set(counter,{[key]:n},{merge:true}); tx.create(ref,{...data,number,fy,kind,status:'issued',phase12Test:true,issueDate:now.toISOString().slice(0,10),dueDate:now.toISOString().slice(0,10),createdAt:FieldValue.serverTimestamp(),createdBy:actor.uid}); audit(d.action==='convert'?'proforma.converted':'invoice.issued',number); return {ok:true,number};
 });
}
export async function listBilling():Promise<import('./billing-view').BillingOrg[]> {
 await requireAdminWrite(); if(!isAdminWriteEnabled()) return [];
 const orgs=await adminDb().collection('orgs').limit(50).get();
 const readProfile=(v:unknown)=>{const p=v && typeof v==='object'?v as Record<string,unknown>:{};return {legalName:String(p.legalName??''),address:String(p.address??''),stateCode:String(p.stateCode??''),gstin:String(p.gstin??'')};};
 return Promise.all(orgs.docs.filter(o=>o.id.startsWith('test-')&&o.get('isDemo')!==true).map(async o=>{
 const [p, invoices]=await Promise.all([o.ref.collection('billing').doc('profile').get(),o.ref.collection('invoices').limit(50).get()]);
 return {id:o.id,name:String(o.get('name')??o.id),profile:readProfile(p.data()),invoices:invoices.docs.filter(i=>i.get('phase12Test')===true).map(i=>{const d=i.data();return {id:i.id,number:String(d.number??i.id),kind:String(d.kind??''),status:String(d.status??''),issueDate:String(d.issueDate??''),buyer:readProfile(d.buyer),seller:readProfile(d.seller),lines:Array.isArray(d.lines)?d.lines.map((l:Record<string,unknown>)=>({desc:String(l.desc??''),qty:Number(l.qty??0),amountPaise:Number(l.amountPaise??0)})):[],subtotal:Number(d.subtotalPaise??0),cgst:Number(d.cgstPaise??0),sgst:Number(d.sgstPaise??0),igst:Number(d.igstPaise??0),total:Number(d.totalPaise??0),paymentRef:String(d.paymentRef??''),paymentMode:String(d.paymentMode??''),cashfreeOrderId:String(d.cashfreeOrderId??''),renewalStatus:String(d.renewalStatus??'none'),renewalDays:Number(d.apply?.days??0)};})};
 }));
}
