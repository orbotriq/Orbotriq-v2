import {NextRequest,NextResponse} from 'next/server';
import {isAdminWriteEnabled} from '@/lib/admin/write-guard';
import {validCashfreeSignature} from '@/lib/admin/cashfree-signature';
import {reconcileWebhook} from '@/lib/admin/cashfree';
export const runtime='nodejs';
export async function POST(req:NextRequest){
 if(!isAdminWriteEnabled()||process.env.CASHFREE_ENV!=='sandbox')return NextResponse.json({error:'Disabled'},{status:403});
 const raw=await req.text();
 if(raw.length>65536)return NextResponse.json({error:'Too large'},{status:413});
 if(!validCashfreeSignature(raw,req.headers.get('x-webhook-timestamp')??'',req.headers.get('x-webhook-signature')??'',process.env.CASHFREE_SECRET_KEY??''))return NextResponse.json({error:'Invalid signature'},{status:401});
 try{const event=JSON.parse(raw);if(event.type!=='PAYMENT_SUCCESS_WEBHOOK')return NextResponse.json({ok:true,ignored:true});
 const id=event.data?.order?.order_id;if(typeof id!=='string')return NextResponse.json({error:'Invalid order'},{status:400});
 const result=await reconcileWebhook(id);return NextResponse.json(result,{status:('pending' in result&&result.pending)?503:200});
 }catch{return NextResponse.json({error:'Reconciliation failed'},{status:503});}
}
