export type BillingProfile = {legalName:string;address:string;stateCode:string;gstin:string};
export type BillingInvoice = {id:string;number:string;kind:string;status:string;issueDate:string;buyer:BillingProfile;seller:BillingProfile;lines:{desc:string;qty:number;amountPaise:number}[];subtotal:number;cgst:number;sgst:number;igst:number;total:number;paymentRef:string;paymentMode:string;cashfreeOrderId:string;renewalStatus:string;renewalDays:number};
export type BillingOrg = {id:string;name:string;profile:BillingProfile;invoices:BillingInvoice[]};
