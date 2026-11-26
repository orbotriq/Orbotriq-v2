// Sandbox order recovery policy. Never issue a replacement order automatically.
type Attempt = { order_id: string; payment_status: string };
export function recoveryDecision(orderId: string, status: string, attempts: readonly Attempt[], sessionAvailable: boolean, locallyPaid: boolean) {
 if (attempts.some(p => p.order_id !== orderId)) return 'REVIEW';
 const successes = attempts.filter(p => p.payment_status === 'SUCCESS').length;
 if (status === 'PAID') return successes === 1 ? 'SETTLE' : 'REVIEW';
 if (locallyPaid || successes > 0) return 'REVIEW';
 if (attempts.some(p => p.payment_status === 'PENDING')) return 'PENDING';
 // Only explicitly failed attempts are eligible for another checkout on the same order.
 if (attempts.some(p => p.payment_status !== 'FAILED')) return 'REVIEW';
 if (status === 'ACTIVE') return sessionAvailable ? 'CHECKOUT' : 'REVIEW';
 if (status === 'EXPIRED' || status === 'TERMINATED') return 'EXPIRED_REVIEW';
 return 'REVIEW';
}
export function mayCreateMissingOrder(action: 'create' | 'verify' | 'review', newlyReserved: boolean) {
 return action === 'create' && newlyReserved;
}
export function safePaymentId(value: string | number) {
 if (typeof value === 'number' && !Number.isSafeInteger(value)) return null;
 const id = String(value);
 return /^\d{1,40}$/.test(id) ? id : null;
}
