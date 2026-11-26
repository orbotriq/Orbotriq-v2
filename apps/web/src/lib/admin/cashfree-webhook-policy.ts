// The signed notification is a trigger, not proof of settlement; the gateway is queried again.
export function webhookEvent(raw:string):{kind:'invalid'}|{kind:'ignore'}|{kind:'success';orderId:string}{
 try{
  const e=JSON.parse(raw);
  if(!e||typeof e!=='object'||Array.isArray(e)||typeof e.type!=='string')return {kind:'invalid'};
  if(e.type!=='PAYMENT_SUCCESS_WEBHOOK')return {kind:'ignore'};
  const id=e.data?.order?.order_id;
  if(typeof id!=='string'||!/^orb_[a-f0-9]{40}$/.test(id)||e.data?.payment?.payment_status!=='SUCCESS')return {kind:'invalid'};
  return {kind:'success',orderId:id};
 }catch{return {kind:'invalid'};}
}
// Read at most the configured bytes, not an unbounded req.text().
export async function boundedWebhookBody(body:ReadableStream<Uint8Array>|null, limit=65536):Promise<string|null>{
 if(!body)return '';
 const reader=body.getReader();const chunks:Uint8Array[]=[];let n=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;if(n>limit){await reader.cancel();return null;}chunks.push(value);}
 const bytes=new Uint8Array(n);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
 }finally{reader.releaseLock();}
}
