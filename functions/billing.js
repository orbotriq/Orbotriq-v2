// Invoicing: GST invoices raised by the super admin, shown to each organisation's owner.
// Money is stored in paise. Invoices are written only here (never by the browser) and are never
// deleted: a wrong invoice is voided so the number sequence stays unbroken.
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const M = require('./invoiceMath');

const db = getFirestore();
const REGION = 'asia-south1';
const PAY_MODES = ['UPI', 'Bank transfer', 'Card', 'Cash', 'Other'];

const needAdmin = (req) => {
  if (!req.auth || req.auth.token.platformAdmin !== true) throw new HttpsError('permission-denied', 'Super admin only.');
};
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const bad = (m) => new HttpsError('invalid-argument', m);

async function planLimits(planId) {
  const p = (await db.doc(`plans/${planId}`).get()).data();
  if (!p) throw new HttpsError('not-found', 'Plan not found. Create it under Plans first.');
  return { institutions: Number(p.limits?.brands || 1), geoRuns: Number(p.limits?.geoRuns || 0) };
}

// Move an organisation onto a plan for N days (used when an invoice is paid).
function applyPlan(org, apply, limits) {
  const up = {};
  if (org.plan !== apply.planId) { up.plan = apply.planId; up.limits = limits; }
  const base = Math.max(Date.now(), org.paidUntil?.toMillis?.() || 0);
  up.paidUntil = Timestamp.fromMillis(base + apply.days * 864e5);
  if (['expired', 'trialing'].includes(org.status)) up.status = 'active'; // a suspended organisation stays suspended
  return up;
}

// The owner (or the super admin for any organisation) saves the legal billing details printed on invoices.
exports.saveBillingProfile = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const isAdmin = req.auth.token.platformAdmin === true;
  const d = req.data || {};
  let orgId;
  if (isAdmin) orgId = clean(d.orgId, 64);
  else {
    if (req.auth.token.role !== 'owner') throw new HttpsError('permission-denied', 'Only the workspace owner can change billing details.');
    orgId = req.auth.token.orgId;
  }
  if (!orgId || orgId.includes('/')) throw bad('Missing organisation.');
  const orgRef = db.doc(`orgs/${orgId}`);
  if (!(await orgRef.get()).exists) throw new HttpsError('not-found', 'Organisation not found.');

  const legalName = clean(d.legalName, 120);
  const gstin = clean(d.gstin, 15).toUpperCase();
  const stateCode = clean(d.stateCode, 3);
  const address = clean(d.address, 300);
  const email = clean(d.email, 120).toLowerCase();
  if (legalName.length < 2) throw bad('Enter the legal or business name for invoices.');
  if (gstin && !M.GSTIN_RE.test(gstin)) throw bad('That GSTIN does not look right. It has 15 characters, for example 33ABCDE1234F1Z5.');
  if (!M.STATES[stateCode]) throw bad('Choose the state.');
  if (gstin && stateCode !== 'OUT' && gstin.slice(0, 2) !== stateCode) throw bad(`The state must match the GSTIN (it starts with ${gstin.slice(0, 2)}).`);
  if (address.length < 5) throw bad('Enter the billing address.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Enter a valid billing email.');

  await orgRef.collection('billing').doc('profile').set({
    legalName, gstin, stateCode, address, email, phone: clean(d.phone, 20),
    updatedAt: FieldValue.serverTimestamp(), updatedBy: req.auth.uid,
  });
  await orgRef.collection('auditLogs').add({ action: 'billing.profile_saved', by: req.auth.uid, at: FieldValue.serverTimestamp() });
  return { ok: true };
});

// Super admin raises an invoice. Seller details come from platform/billing, buyer details from the org.
exports.adminCreateInvoice = onCall({ region: REGION }, async (req) => {
  needAdmin(req);
  const d = req.data || {};
  const orgId = clean(d.orgId, 64);
  if (!orgId || orgId.includes('/')) throw bad('Choose an organisation.');
  const orgRef = db.doc(`orgs/${orgId}`);
  const [orgSnap, sellerSnap, buyerSnap] = await Promise.all([orgRef.get(), db.doc('platform/billing').get(), orgRef.collection('billing').doc('profile').get()]);
  if (!orgSnap.exists) throw new HttpsError('not-found', 'Organisation not found.');

  const seller = sellerSnap.data() || {};
  if (!seller.legalName || !seller.address || !M.STATES[seller.stateCode] || seller.stateCode === 'OUT') {
    throw new HttpsError('failed-precondition', 'Fill in your business details (name, address, state) under Billing first.');
  }
  if (seller.gstRegistered && !M.GSTIN_RE.test(seller.gstin || '')) throw new HttpsError('failed-precondition', 'Your GSTIN is missing or incorrect. Fix it under Billing.');
  const buyer = buyerSnap.data();
  if (!buyer?.legalName) throw new HttpsError('failed-precondition', 'Add this organisation’s billing details first.');

  let lines, tax;
  try {
    lines = M.priceLines(d.lines);
    const subtotalPaise = lines.reduce((a, l) => a + l.amountPaise, 0);
    if (subtotalPaise <= 0) throw new Error('The invoice total must be above zero.');
    const wanted = d.gstRate === undefined || d.gstRate === '' ? Number(seller.gstRate ?? 18) : Number(d.gstRate);
    tax = { subtotalPaise, ...M.computeTax(subtotalPaise, { registered: !!seller.gstRegistered, sellerState: seller.stateCode, buyerState: buyer.stateCode, rate: wanted }) };
  } catch (e) { throw bad(e.message); }
  const totalPaise = tax.subtotalPaise + tax.cgstPaise + tax.sgstPaise + tax.igstPaise;

  // Optional: when this invoice is marked paid, move the organisation onto this plan for N days.
  let apply = null;
  if (d.apply && d.apply.planId) {
    const planId = clean(d.apply.planId, 40), days = Math.round(Number(d.apply.days));
    if (planId === 'trial' || !(days >= 1 && days <= 800)) throw bad('Choose a paid plan and a period of 1 to 800 days.');
    await planLimits(planId);
    apply = { planId, days };
  }

  const issue = M.istNow(), fy = M.financialYear(issue);
  const prefix = clean(seller.invoicePrefix || 'ORB', 5).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'ORB';
  const dueDays = Math.min(90, Math.max(0, Math.round(Number(d.dueDays ?? 7)) || 0));
  const kind = d.kind === 'proforma' ? 'proforma' : 'tax';
  const counterRef = db.doc('platform/counters');

  const out = await db.runTransaction(async (tx) => {
    const { key, n, number, id } = M.nextNumber((await tx.get(counterRef)).data(), kind, prefix, fy);
    tx.set(counterRef, { [key]: n }, { merge: true });
    tx.set(orgRef.collection('invoices').doc(id), {
      number, fy, kind, status: 'issued', issueDate: M.ymd(issue), dueDate: M.ymd(M.addDays(issue, dueDays)),
      orgName: orgSnap.data().name || '',
      seller: {
        legalName: seller.legalName, gstRegistered: !!seller.gstRegistered, gstin: seller.gstin || '', pan: seller.pan || '', address: seller.address,
        stateCode: seller.stateCode, email: seller.email || '', phone: seller.phone || '', sac: seller.sac || '',
        bankName: seller.bankName || '', bankAccountName: seller.bankAccountName || '', bankAccountNo: seller.bankAccountNo || '', bankIfsc: seller.bankIfsc || '', upi: seller.upi || '', terms: seller.terms || '',
      },
      buyer: { legalName: buyer.legalName, gstin: buyer.gstin || '', address: buyer.address, stateCode: buyer.stateCode, email: buyer.email || '', phone: buyer.phone || '' },
      lines, ...tax, totalPaise,
      notes: clean(d.notes, 500), periodLabel: clean(d.periodLabel, 80), apply, applied: false,
      createdAt: FieldValue.serverTimestamp(), createdBy: req.auth.uid,
    });
    tx.set(orgRef.collection('auditLogs').doc(), { action: 'invoice.issued', number, by: req.auth.uid, at: FieldValue.serverTimestamp() });
    return { id, number };
  });
  return { ok: true, ...out, kind, totalPaise };
});

// Mark an invoice paid (optionally activating the plan period) or void it.
exports.adminSetInvoiceStatus = onCall({ region: REGION }, async (req) => {
  needAdmin(req);
  const d = req.data || {};
  const orgId = clean(d.orgId, 64), invoiceId = clean(d.invoiceId, 64), action = d.action;
  if (!orgId || !invoiceId || orgId.includes('/') || invoiceId.includes('/')) throw bad('Missing invoice.');
  if (!['paid', 'void'].includes(action)) throw bad('Unknown action.');
  const orgRef = db.doc(`orgs/${orgId}`), invRef = orgRef.collection('invoices').doc(invoiceId);

  const pre = (await invRef.get()).data();
  if (!pre) throw new HttpsError('not-found', 'Invoice not found.');
  if (pre.kind === 'proforma' && action === 'paid') throw new HttpsError('failed-precondition', 'A proforma is not a tax invoice. Use “Mark paid” on it in the console, which issues the tax invoice.');
  const limits = action === 'paid' && pre.apply?.planId ? await planLimits(pre.apply.planId) : null;

  let activated = false, stillSuspended = false;
  await db.runTransaction(async (tx) => {
    activated = false; stillSuspended = false;
    const [iSnap, oSnap] = await Promise.all([tx.get(invRef), tx.get(orgRef)]);
    const inv = iSnap.data(), org = oSnap.data();
    if (!inv || !org) throw new HttpsError('not-found', 'Invoice or organisation not found.');
    if (inv.status !== 'issued') throw new HttpsError('failed-precondition', `This invoice is already ${inv.status}.`);

    const log = { by: req.auth.uid, number: inv.number, at: FieldValue.serverTimestamp() };
    if (action === 'void') {
      tx.update(invRef, { status: 'void', voidReason: clean(d.reason, 200), voidedAt: FieldValue.serverTimestamp() });
      tx.set(orgRef.collection('auditLogs').doc(), { ...log, action: 'invoice.voided' });
      return;
    }
    const mode = PAY_MODES.includes(d.paymentMode) ? d.paymentMode : 'Other';
    const paidOn = /^\d{4}-\d{2}-\d{2}$/.test(String(d.paidOn || '')) ? d.paidOn : M.ymd(M.istNow());
    const upd = { status: 'paid', paidOn, paymentMode: mode, paymentRef: clean(d.paymentRef, 80), paidAt: FieldValue.serverTimestamp() };

    if (inv.apply?.planId && !inv.applied) {
      stillSuspended = org.status === 'suspended';
      tx.update(orgRef, applyPlan(org, inv.apply, limits));
      upd.applied = true; activated = true;
    }
    tx.update(invRef, upd);
    tx.set(orgRef.collection('auditLogs').doc(), { ...log, action: 'invoice.paid', activated });
  });
  return { ok: true, activated, stillSuspended };
});

// Turn a proforma into a real tax invoice (new number from the tax series).
// paid = true: payment has arrived, so the tax invoice is created already paid and the plan period is applied.
// paid = false: the tax invoice is issued as unpaid, e.g. for a client on credit terms.
exports.adminConvertProforma = onCall({ region: REGION }, async (req) => {
  needAdmin(req);
  const d = req.data || {};
  const orgId = clean(d.orgId, 64), invoiceId = clean(d.invoiceId, 64), paid = d.paid === true;
  if (!orgId || !invoiceId || orgId.includes('/') || invoiceId.includes('/')) throw bad('Missing proforma.');
  const orgRef = db.doc(`orgs/${orgId}`), proRef = orgRef.collection('invoices').doc(invoiceId), counterRef = db.doc('platform/counters');

  const pre = (await proRef.get()).data();
  if (!pre || pre.kind !== 'proforma') throw new HttpsError('not-found', 'Proforma not found.');
  const limits = paid && pre.apply?.planId ? await planLimits(pre.apply.planId) : null;
  const seller = (await db.doc('platform/billing').get()).data() || {};
  const prefix = clean(seller.invoicePrefix || 'ORB', 5).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'ORB';
  const issue = M.istNow(), fy = M.financialYear(issue);
  const dueDays = Math.min(90, Math.max(0, Math.round(Number(d.dueDays ?? 7)) || 0));
  const mode = PAY_MODES.includes(d.paymentMode) ? d.paymentMode : 'Other';
  const paidOn = /^\d{4}-\d{2}-\d{2}$/.test(String(d.paidOn || '')) ? d.paidOn : M.ymd(issue);

  let out, stillSuspended = false;
  await db.runTransaction(async (tx) => {
    stillSuspended = false;
    const [pSnap, oSnap, cSnap] = await Promise.all([tx.get(proRef), tx.get(orgRef), tx.get(counterRef)]);
    const pro = pSnap.data(), org = oSnap.data();
    if (!pro || !org) throw new HttpsError('not-found', 'Proforma or organisation not found.');
    if (pro.status !== 'issued') throw new HttpsError('failed-precondition', `This proforma is already ${pro.status}.`);

    const { key, n, number, id } = M.nextNumber(cSnap.data(), 'tax', prefix, fy);
    const inv = {
      ...pro, kind: 'tax', number, fy, status: 'issued', fromProforma: pro.number, applied: false,
      issueDate: M.ymd(issue), dueDate: M.ymd(M.addDays(issue, dueDays)), createdAt: FieldValue.serverTimestamp(), createdBy: req.auth.uid,
    };
    if (paid) {
      Object.assign(inv, { status: 'paid', paidOn, paymentMode: mode, paymentRef: clean(d.paymentRef, 80), paidAt: FieldValue.serverTimestamp() });
      if (pro.apply?.planId) { stillSuspended = org.status === 'suspended'; tx.update(orgRef, applyPlan(org, pro.apply, limits)); inv.applied = true; }
    }
    tx.set(counterRef, { [key]: n }, { merge: true });
    tx.set(orgRef.collection('invoices').doc(id), inv);
    tx.update(proRef, { status: 'converted', convertedTo: number, convertedAt: FieldValue.serverTimestamp() });
    tx.set(orgRef.collection('auditLogs').doc(), { action: 'proforma.converted', proforma: pro.number, number, paid, by: req.auth.uid, at: FieldValue.serverTimestamp() });
    out = { number, id };
  });
  return { ok: true, ...out, paid, stillSuspended };
});
