export function renewalExpiry(now:number, previous:number, days:number):number {
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(previous)||previous<0||!Number.isInteger(days)||days<1||days>90) throw new Error('Invalid renewal');
 const next=Math.max(now,previous)+days*86400000;
 if(!Number.isSafeInteger(next)||next>253402300799999) throw new Error('Invalid expiry');
 return next;
}
