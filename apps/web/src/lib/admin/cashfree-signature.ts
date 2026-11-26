import {createHmac,timingSafeEqual} from 'node:crypto';
export function validCashfreeSignature(raw:string,timestamp:string,signature:string,secret:string,now=Date.now()){
 if(!secret||!/^\d{13}$/.test(timestamp)||Math.abs(now-Number(timestamp))>300000||! /^[A-Za-z0-9+/]{43}=$/.test(signature))return false;
 const expected=createHmac('sha256',secret).update(timestamp+raw).digest();
 const actual=Buffer.from(signature,'base64');return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
