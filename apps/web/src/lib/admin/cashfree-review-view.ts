// Only bounded classifications, never raw gateway responses or credentials.
export const REVIEW_CODES = ['ACTIVE_RETRY','PENDING','EXPIRED_REVIEW','MISSING_REVIEW','REVIEW'] as const;
export type ReviewCode = typeof REVIEW_CODES[number];
export function reviewCode(value: unknown): ReviewCode | null {
 return typeof value==='string' && (REVIEW_CODES as readonly string[]).includes(value) ? value as ReviewCode : null;
}
export const REVIEW_LABELS: Record<ReviewCode,string> = {
 ACTIVE_RETRY:'Active order — same-order retry only', PENDING:'Pending payment — no retry',
 EXPIRED_REVIEW:'Expired or terminated — reserved', MISSING_REVIEW:'Missing gateway order — reserved', REVIEW:'Uncertain payment — review required'
};
export function reviewLabel(value: unknown): string {
 const code=reviewCode(value);return code?REVIEW_LABELS[code]:'';
}
export function recoveryReviewFields(value: unknown) {
 if(!value||typeof value!=='object'||Array.isArray(value))return {code:null,at:''};
 const v=value as Record<string,unknown>;const code=reviewCode(v.code);
 if(!code)return {code:null,at:''};
 const t=v.observedAt as {toMillis?:()=>number}|undefined;
 let at='';try{const n=t?.toMillis?.();if(typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=253402214399999)at=new Date(n).toISOString();}catch{/* invalid stored timestamp */}
 return {code,at};
}
// A saved review is historical evidence, never permission to create another order.
export function reviewLinkValid(invoice: Record<string,unknown>, order: Record<string,unknown>, expected: {orgId:string;invoiceId:string;orderId:string;amount:number}) {
 return invoice.phase12Test===true&&invoice.kind==='tax'&&invoice.status==='issued'&&invoice.cashfreeOrderId===expected.orderId&&invoice.totalPaise===expected.amount&&order.orgId===expected.orgId&&order.invoiceId===expected.invoiceId&&order.amountPaise===expected.amount&&order.status==='reserved';
}
export function reviewChanged(previous:unknown, code:ReviewCode) {
 return !previous||typeof previous!=='object'||(previous as Record<string,unknown>).code!==code;
}
