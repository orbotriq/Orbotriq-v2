// Pure validation for the local first-password-change flow.
export function recentPasswordToken(token:Record<string,unknown>,nowMs:number):boolean {
 const provider=token.firebase as {sign_in_provider?:unknown}|undefined;
 const time=token.auth_time;
 return provider?.sign_in_provider==="password"&&typeof time==="number"&&Number.isSafeInteger(time)&&time>0&&Number.isFinite(nowMs)&&time<=Math.floor(nowMs/1000)&&nowMs/1000-time<=300;
}
export function strongPassword(value:unknown):value is string {
 return typeof value==="string"&&value.length>=12&&value.length<=128&&!/[\x00-\x20\x7f]/.test(value)&&/[a-z]/.test(value)&&/[A-Z]/.test(value)&&/[0-9]/.test(value)&&/[^a-zA-Z0-9]/.test(value);
}
export type OnboardingInput={idToken:string;currentPassword:string;newPassword:string};
export function parseOnboarding(value:unknown):OnboardingInput|null {
 if(!value||typeof value!=="object"||Array.isArray(value))return null;
 const v=value as Record<string,unknown>;
 if(Object.keys(v).length!==3||typeof v.idToken!=="string"||!v.idToken||v.idToken.length>16384||typeof v.currentPassword!=="string"||!v.currentPassword||v.currentPassword.length>4096||!strongPassword(v.newPassword)||v.currentPassword===v.newPassword)return null;
 return {idToken:v.idToken,currentPassword:v.currentPassword,newPassword:v.newPassword};
}
// A second-resolution Auth timestamp cannot distinguish two logins in one second.
export const nextAuthTime=(nowMs:number)=>Math.floor(nowMs/1000)+1;
