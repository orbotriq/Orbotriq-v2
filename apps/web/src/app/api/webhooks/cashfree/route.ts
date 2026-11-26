import {NextRequest,NextResponse} from 'next/server';
import {isAdminWriteEnabled} from '@/lib/admin/write-guard';
import {validCashfreeSignature} from '@/lib/admin/cashfree-signature';
import {reconcileWebhook} from '@/lib/admin/cashfree';
import {boundedWebhookBody,webhookEvent} from '@/lib/admin/cashfree-webhook-policy';
export const runtime='nodejs';
export async function POST(req:NextRequest){
 if(!isAdminWriteEnabled()||process.env.CASHFREE_ENV!=='sandbox')return NextResponse.json({error:'Disabled'},{status:403});
 let raw:string|null;
 try{raw=await boundedWebhookBody(req.body);}catch{return NextResponse.json({error:'Invalid body'},{status:400});}
 if(raw===null)return NextResponse.json({error:'Too large'},{status:413});
 if(!validCashfreeSignature(raw,req.headers.get('x-webhook-timestamp')??'',req.headers.get('x-webhook-signature')??'',process.env.CASHFREE_SECRET_KEY??''))return NextResponse.json({error:'Invalid signature'},{status:401});
 const event=webhookEvent(raw);
 if(event.kind==='invalid')return NextResponse.json({error:'Invalid event'},{status:400});
 if(event.kind==='ignore')return NextResponse.json({ok:true,ignored:true});
 try{const result=await reconcileWebhook(event.orderId);return NextResponse.json(result,{status:('pending' in result&&result.pending)?503:200});}
 catch{return NextResponse.json({error:'Reconciliation failed'},{status:503});}
}
