// Gateway amounts are rupees; invoice amounts are integer paise.
export function exactPaise(value:unknown, amount:number):boolean {
 if(typeof value!=='number'||!Number.isFinite(value)||!Number.isSafeInteger(amount)||amount<100||amount>1000000000)return false;
 const scaled=value*100;
 return Math.abs(scaled-amount)<0.000001;
}
export function settlementState(invoice:Record<string,unknown>, order:Record<string,unknown>, payment:Record<string,unknown>|null, e:{orgId:string;invoiceId:string;orderId:string;paymentId:string;amount:number}) {
 if(invoice.phase12Test!==true||invoice.kind!=='tax'||invoice.cashfreeOrderId!==e.orderId||invoice.totalPaise!==e.amount||order.orgId!==e.orgId||order.invoiceId!==e.invoiceId||order.amountPaise!==e.amount)return 'CONFLICT';
 if(payment)return payment.orderId===e.orderId&&payment.orgId===e.orgId&&payment.invoiceId===e.invoiceId&&payment.amountPaise===e.amount&&order.status==='paid'&&order.paymentId===e.paymentId&&invoice.status==='paid'&&invoice.paymentRef===e.paymentId?'DUPLICATE':'CONFLICT';
 return invoice.status==='issued'&&order.status==='reserved'?'SETTLE':'CONFLICT';
}
