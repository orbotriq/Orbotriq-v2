// Super admin (developer) controls: organisations, plans, demo logins, billing sweeps.
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineString } = require('firebase-functions/params');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const crypto = require('crypto');

const db = getFirestore();
const REGION = 'asia-south1';
const SUPER_ADMIN_EMAIL = defineString('SUPER_ADMIN_EMAIL', { default: 'vaanioapp@gmail.com' });
const STATUSES = ['trialing', 'active', 'suspended', 'expired', 'demo'];

function needAdmin(req) {
  if (!req.auth || req.auth.token.platformAdmin !== true) throw new HttpsError('permission-denied', 'Super admin only.');
}
const genPassword = () => `Ob${crypto.randomBytes(9).toString('base64url')}#7`;
const rnd = (a, b) => Math.round(a + Math.random() * (b - a));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20);

async function planLimits(planId) {
  if (!planId || planId === 'trial') return { institutions: 2, geoRuns: 5 };
  if (planId === 'demo') return { institutions: 5, geoRuns: 50 };
  const p = (await db.doc(`plans/${planId}`).get()).data();
  if (!p) throw new HttpsError('not-found', 'Plan not found. Create it under Plans first.');
  return { institutions: Number(p.limits?.brands || 1), geoRuns: Number(p.limits?.geoRuns || 0) };
}

async function ensureUser(email, name) {
  try { return { user: await getAuth().getUserByEmail(email), password: null }; }
  catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    const password = genPassword();
    return { user: await getAuth().createUser({ email, password, displayName: name, emailVerified: false }), password };
  }
}

async function makeOrg({ name, ownerEmail, planId, status, trialDays, notes, demo, by }) {
  const { user, password } = await ensureUser(ownerEmail, name);
  const claims = user.customClaims || {};
  if (claims.orgId) throw new HttpsError('already-exists', 'This email already belongs to another organisation.');
  const orgRef = db.collection('orgs').doc();
  const now = Date.now();
  const batch = db.batch();
  batch.set(orgRef, {
    name, ownerUid: user.uid, ownerEmail, plan: planId, status, isDemo: !!demo,
    trialEndsAt: Timestamp.fromMillis(now + trialDays * 864e5),
    paidUntil: status === 'active' ? Timestamp.fromMillis(now + 30 * 864e5) : null,
    limits: await planLimits(planId), usage: {}, institutionCount: 0, notes: notes || '',
    logoUrl: '', brandColor: '#22d3ee', createdBy: by, createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(orgRef.collection('members').doc(user.uid), { email: ownerEmail, role: 'owner', mustChangePassword: !!password && !demo, createdAt: FieldValue.serverTimestamp() });
  batch.set(db.doc(`users/${user.uid}`), { email: ownerEmail, displayName: name, orgId: orgRef.id, createdAt: FieldValue.serverTimestamp() }, { merge: true });
  batch.set(orgRef.collection('auditLogs').doc(), { action: demo ? 'org.demo_created' : 'org.created_by_admin', by, at: FieldValue.serverTimestamp() });
  await batch.commit();
  await getAuth().setCustomUserClaims(user.uid, { ...claims, orgId: orgRef.id, role: 'owner' });
  return { orgId: orgRef.id, email: ownerEmail, password };
}

// One-time: the registered email (verified, via Google or email + password) becomes the platform super admin.
exports.claimSuperAdmin = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const t = req.auth.token;
  if (String(t.email || '').toLowerCase() !== SUPER_ADMIN_EMAIL.value().toLowerCase() || t.email_verified !== true) {
    throw new HttpsError('permission-denied', 'This account is not the registered super admin, or its email is not verified yet.');
  }
  const u = await getAuth().getUser(req.auth.uid);
  await getAuth().setCustomUserClaims(req.auth.uid, { ...(u.customClaims || {}), platformAdmin: true });
  return { ok: true };
});

exports.adminCreateOrg = onCall({ region: REGION }, async (req) => {
  needAdmin(req);
  const { name, ownerEmail, planId = 'trial', trialDays = 14, notes = '' } = req.data || {};
  const n = String(name || '').trim(), email = String(ownerEmail || '').trim().toLowerCase();
  if (n.length < 2 || n.length > 80) throw new HttpsError('invalid-argument', 'Organisation name must be 2 to 80 characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpsError('invalid-argument', 'Enter a valid owner email.');
  return makeOrg({ name: n, ownerEmail: email, planId, status: planId === 'trial' ? 'trialing' : 'active',
    trialDays: Math.min(90, Math.max(1, Number(trialDays) || 14)), notes: String(notes).slice(0, 500), by: req.auth.uid });
});

exports.adminUpdateOrg = onCall({ region: REGION }, async (req) => {
  needAdmin(req);
  const { orgId, plan, status, extendDays, limits, notes, name, whiteLabel } = req.data || {};
  const ref = db.doc(`orgs/${String(orgId || 'x')}`);
  const cur = (await ref.get()).data();
  if (!cur) throw new HttpsError('not-found', 'Organisation not found.');
  const up = {};
  if (name) up.name = String(name).slice(0, 80);
  if (notes != null) up.notes = String(notes).slice(0, 500);
  if (typeof whiteLabel === 'boolean') up.whiteLabel = whiteLabel;
  if (plan && plan !== cur.plan) { up.plan = plan; up.limits = await planLimits(plan); }
  if (limits) up.limits = { institutions: Math.max(0, Number(limits.institutions) || 0), geoRuns: Math.max(0, Number(limits.geoRuns) || 0) };
  if (status) { if (!STATUSES.includes(status)) throw new HttpsError('invalid-argument', 'Unknown status.'); up.status = status; }
  if (extendDays) {
    const base = Math.max(Date.now(), (cur.plan === 'trial' ? cur.trialEndsAt : cur.paidUntil)?.toMillis() || 0);
    const t = Timestamp.fromMillis(base + Number(extendDays) * 864e5);
    if ((up.plan || cur.plan) === 'trial') up.trialEndsAt = t; else up.paidUntil = t;
    if (!status && ['expired', 'suspended'].includes(cur.status)) up.status = (up.plan || cur.plan) === 'trial' ? 'trialing' : 'active';
  }
  if (up.plan && up.plan !== 'trial' && !up.paidUntil && !cur.paidUntil) up.paidUntil = Timestamp.fromMillis(Date.now() + 30 * 864e5);
  await ref.update(up);
  await ref.collection('auditLogs').add({ action: 'org.updated_by_admin', fields: Object.keys(up), by: req.auth.uid, at: FieldValue.serverTimestamp() });
  return { ok: true };
});

exports.adminResetPassword = onCall({ region: REGION }, async (req) => {
  needAdmin(req);
  const email = String(req.data?.email || '').trim().toLowerCase();
  const user = await getAuth().getUserByEmail(email).catch(() => null);
  if (!user) throw new HttpsError('not-found', 'No login with this email.');
  if ((user.customClaims || {}).platformAdmin) throw new HttpsError('failed-precondition', 'Super admin accounts use Google sign-in.');
  const password = genPassword();
  await getAuth().updateUser(user.uid, { password });
  // The client must choose their own password at next login (demo workspaces share a fixed login, so they are skipped)
  const oid = (user.customClaims || {}).orgId;
  if (oid) {
    const o = (await db.doc(`orgs/${oid}`).get()).data();
    if (o && !o.isDemo) await db.doc(`orgs/${oid}/members/${user.uid}`).set({ mustChangePassword: true }, { merge: true });
  }
  return { email, password };
});

// Called by the client dashboard after the user has set their own password
exports.passwordChanged = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const orgId = req.auth.token.orgId;
  if (!orgId) return { ok: true };
  await db.doc(`orgs/${orgId}/members/${req.auth.uid}`).set({ mustChangePassword: false, passwordChangedAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.collection(`orgs/${orgId}/auditLogs`).add({ action: 'password.changed', by: req.auth.uid, at: FieldValue.serverTimestamp() });
  return { ok: true };
});

exports.adminDeleteOrg = onCall({ region: REGION, timeoutSeconds: 300 }, async (req) => {
  needAdmin(req);
  const orgId = String(req.data?.orgId || '');
  const ref = db.doc(`orgs/${orgId}`);
  if (!(await ref.get()).exists) throw new HttpsError('not-found', 'Organisation not found.');
  const members = await ref.collection('members').get();
  for (const m of members.docs) {
    const u = await getAuth().getUser(m.id).catch(() => null);
    if (!u) continue;
    if ((u.customClaims || {}).platformAdmin) { const { orgId: _o, role: _r, ...rest } = u.customClaims; await getAuth().setCustomUserClaims(u.uid, rest); }
    else await getAuth().deleteUser(u.uid).catch(() => {});
    await db.doc(`users/${m.id}`).delete().catch(() => {});
  }
  const shares = await db.collection('reportShares').where('orgId', '==', orgId).get();
  for (const sh of shares.docs) await sh.ref.delete();
  await db.recursiveDelete(ref);
  return { ok: true };
});

// ---------- Demo logins with realistic sample data ----------
const BRANDS = [
  { name: 'Sunrise Cafés', site: 'sunrisecafes.example', city: 'Coimbatore', cat: 'cafe' },
  { name: 'Nova Dental Clinics', site: 'novadental.example', city: 'Chennai', cat: 'dental clinic' },
  { name: 'Peak Fitness Studio', site: 'peakfit.example', city: 'Bengaluru', cat: 'fitness studio' },
];

async function seedDemo(orgId) {
  const base = db.doc(`orgs/${orgId}`);
  const now = Timestamp.now();
  const ids = [];
  for (const b of BRANDS) {
    const ref = base.collection('institutions').doc();
    ids.push(ref.id);
    await ref.set({ name: b.name, websiteUrl: `https://${b.site}`, createdBy: 'demo', createdAt: now });
  }
  await base.update({ institutionCount: BRANDS.length });
  const M = (id) => base.collection('metrics').doc(id);
  for (let i = 0; i < BRANDS.length; i++) {
    const b = BRANDS[i], id = ids[i], pid = `demo${i + 1}`;
    const score = [86, 72, 64][i], gscore = [58, 41, 73][i];
    await M(`gsc_${id}`).set({ status: 'ok', siteUrl: `sc-domain:${b.site}`, clicks: rnd(1800, 5200), impressions: rnd(40000, 120000), syncedAt: now,
      topQueries: [`best ${b.cat} in ${b.city.toLowerCase()}`, `${b.cat} near me`, `${b.name.toLowerCase()}`, `${b.cat} prices`, `top ${b.cat} ${b.city.toLowerCase()}`, `${b.cat} reviews`]
        .map((q, k) => ({ query: q, clicks: rnd(40, 600) - k * 40, impressions: rnd(1500, 9000), position: Math.round((2 + k * 2.1 + Math.random()) * 10) / 10 })) });
    await M(`ga_${id}`).set({ property: `properties/demo${i}`, users: rnd(6000, 21000), sessions: rnd(9000, 30000), pageviews: rnd(24000, 80000), engagementRate: rnd(48, 71),
      channels: [['Organic Search', 46], ['Direct', 24], ['Paid Social', 17], ['Referral', 8], ['Organic Social', 5]].map(([channel, p]) => ({ channel, sessions: rnd(p * 90, p * 140) })), syncedAt: now });
    await M(`audit_${id}`).set({ institutionId: id, score, highCount: [0, 2, 3][i], pagesChecked: 6,
      site: [{ sev: 'medium', msg: 'No sitemap.xml found' }].slice(0, i),
      pages: [{ url: `https://${b.site}/`, title: `${b.name} | ${b.city}`, issues: [{ sev: 'medium', msg: '3 image(s) missing alt text' }, { sev: 'low', msg: 'No canonical link' }, ...(i ? [{ sev: 'high', msg: 'Missing meta description' }] : [])] }],
      checkedAt: now });
    const st = (s) => (s >= 70 ? 'pass' : s >= 45 ? 'warn' : 'fail');
    await M(`geo_${id}`).set({ institutionId: id, score: gscore, wordCount: rnd(350, 1400), checkedAt: now,
      bots: [['GPTBot', 'OpenAI training'], ['OAI-SearchBot', 'ChatGPT search'], ['ClaudeBot', 'Anthropic Claude'], ['PerplexityBot', 'Perplexity'], ['Google-Extended', 'Gemini training']]
        .map(([bot, purpose], k) => ({ bot, purpose, access: i === 1 && k < 3 ? 'blocked' : 'allowed' })),
      checks: [['llms', 'llms.txt guide for AI', i === 2 ? 'pass' : 'fail', 'Add /llms.txt with a short summary of your brand and key pages.'],
        ['org', 'Organization schema (JSON-LD)', st(gscore + 10), 'Add Organization or LocalBusiness JSON-LD.'],
        ['faq', 'FAQ content AI can quote', st(gscore - 15), 'Add 5 to 8 real customer questions with short answers.'],
        ['structure', 'Clear headings (answer-first structure)', 'pass', 'Descriptive headings found.'],
        ['depth', 'Content depth', st(gscore), 'Pages with specific, original detail get cited more.'],
        ['trust', 'Authorship and trust signals', 'warn', 'Add author names, About and Contact links and sameAs profiles.'],
        ['tech', 'HTTPS and sitemap', 'pass', 'HTTPS in place.']].map(([cid, label, status, tip]) => ({ id: cid, label, status, tip })) });
    const qs = [`Which is the best ${b.cat} in ${b.city}?`, `Top ${b.cat} options near ${b.city}`];
    const runs = qs.map((q, k) => ({ prompt: q, mentioned: [i === 0, i === 2][k] || (i === 2 && k === 0), cited: i === 0 && k === 0,
      snippet: `Several well-reviewed options exist in ${b.city}. ${i === 0 ? b.name + ' is often mentioned for its location and reviews.' : 'Local directories and review sites list the leading choices.'}`,
      sources: ['justdial.com', 'google.com', 'zomato.com', b.site].slice(0, 3 + (i === 0 ? 1 : 0)), at: now }));
    await M(`geomon_${id}`).set({ institutionId: id, runs, visibility: runs.filter((r) => r.mentioned).length * 50, citedRate: runs.filter((r) => r.cited).length * 50, updatedAt: now });
    for (const q of qs) await base.collection('geoPrompts').add({ institutionId: id, prompt: q, createdAt: now });
    const kws = [`${b.cat} in ${b.city.toLowerCase()}`, `best ${b.cat}`, `${b.cat} offers`];
    for (const k of kws) await base.collection('seoKeywords').add({ keyword: k, institutionId: id, position: Math.round((3 + Math.random() * 14) * 10) / 10, clicks: rnd(20, 380), impressions: rnd(800, 7000), createdAt: now });
    await M(`meta_${pid}`).set({ name: b.name, fans: rnd(3000, 22000), followers: rnd(3200, 24000), reach28: rnd(14000, 90000), views28: rnd(40000, 260000), hasIg: true,
      ig: { username: b.site.split('.')[0], followers: rnd(2500, 18000), reach: rnd(9000, 60000), views: rnd(30000, 150000), accounts_engaged: rnd(600, 4000), total_interactions: rnd(1200, 9000) },
      posts: ['New menu is live', 'Weekend offer', 'Meet the team', 'Customer story', 'Behind the scenes'].map((text, k) => ({ text: `${text} at ${b.name}`, createdTime: new Date(Date.now() - k * 3 * 864e5).toISOString(), url: '#', reactions: rnd(20, 420), comments: rnd(2, 60) })),
      syncedAt: now });
  }
  await M('ads_1000').set({ accountId: 'act_1000', name: 'Demo Ad Account', currency: 'INR', spend: rnd(42000, 98000), impressions: rnd(400000, 900000), reach: rnd(180000, 420000), clicks: rnd(9000, 24000), ctr: 2.4, cpc: 6.8,
    campaigns: [['Festive Offer', 'ACTIVE'], ['Lead Form: Free Trial', 'ACTIVE'], ['Retargeting Visitors', 'PAUSED'], ['Brand Awareness', 'ACTIVE']].map(([n, s], k) => ({ id: `demo-c${k}`, name: n, status: s, spend: rnd(4000, 30000), impressions: rnd(40000, 300000), clicks: rnd(900, 9000) })), syncedAt: now });
  await base.collection('scheduledPosts').add({ pageId: 'demo1', pageName: BRANDS[0].name, message: 'Weekend special: buy one, get one free on all cold brews!', imageUrl: '', toInstagram: false,
    scheduledFor: Timestamp.fromMillis(Date.now() + 20 * 864e5), status: 'scheduled', createdBy: 'demo', createdAt: now });
  await seedInsights(orgId, ids);
}


// Extra demo data for the advanced modules: history for alerts, competitors, share of voice, copilot, a shared report.
async function seedInsights(orgId, ids) {
  const I = require('./insights')._test, base = db.doc(`orgs/${orgId}`), now = Timestamp.now();
  const M = (id) => base.collection('metrics').doc(id);
  const rivals = [['Brew & Co', 'Urban Roast', 'Bean Street'], ['SmileCare', 'DentalHub', 'BrightTeeth'], ['IronWorks Gym', 'FitZone', 'CoreClub']];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i], b = BRANDS[i], gsc = (await M('gsc_' + id).get()).data();
    await M('gsc_' + id).set({ prevClicks: Math.round(gsc.clicks * [0.84, 1.45, 1.05][i]) }, { merge: true });
    await M('audit_' + id).set({ prevScore: [80, 79, 61][i] }, { merge: true });
    await M('geo_' + id).set({ prevScore: [49, 55, 70][i] }, { merge: true });
    const r = rivals[i], you = [i === 2 ? 3 : 2, 1, i === 2 ? 4 : 2][i];
    await M('geomon_' + id).set({ prevVisibility: [30, 80, 50][i], share: [{ name: r[0], mentions: 5, pct: 31, isYou: false, isCompetitor: true }, { name: b.name, mentions: you + 1, pct: 25, isYou: true, isCompetitor: false }, { name: r[1], mentions: 3, pct: 19, isYou: false, isCompetitor: true }, { name: r[2], mentions: 2, pct: 13, isYou: false, isCompetitor: true }, { name: 'Local directory', mentions: 2, pct: 12, isYou: false, isCompetitor: false }],
      sourceShare: [{ domain: 'justdial.com', count: 5 }, { domain: 'google.com', count: 4 }, { domain: 'zomato.com', count: 3 }, { domain: b.site, count: i === 0 ? 2 : 0 }].filter((x) => x.count) }, { merge: true });
    await M('geocomp_' + id).set({ institutionId: id, checkedAt: now, items: [{ name: r[0], url: `https://${slug(r[0])}.example`, score: rnd(52, 78) }, { name: r[1], url: `https://${slug(r[1])}.example`, score: rnd(38, 70) }] });
    await base.collection('institutions').doc(id).update({ competitors: [{ name: r[0], url: `https://${slug(r[0])}.example` }, { name: r[1], url: `https://${slug(r[1])}.example` }] });
  }
  let n = 0;
  for (const k of (await base.collection('seoKeywords').get()).docs) { const p = k.data().position; await k.ref.update({ prevPosition: Math.max(1, Math.round((p + [-6, 4, 0.5][n % 3]) * 10) / 10) }); n++; }
  // Google Business Profile: locations, reviews and local performance
  const locDefs = [[0, 'RS Puram'], [0, 'Gandhipuram'], [1, 'Anna Nagar'], [2, 'Indiranagar']];
  const locations = locDefs.map(([bi, area], k) => ({ id: `demoloc${k + 1}`, account: 'accounts/demo', title: `${BRANDS[bi].name} - ${area}`, address: `${area}, ${BRANDS[bi].city}`, website: `https://${BRANDS[bi].site}`, reviewUrl: `https://search.google.com/local/writereview?placeid=demo${k + 1}`, mapsUrl: '' }));
  await base.collection('connections').doc('gbp').set({ provider: 'gbp', status: 'connected', locations, accounts: 1, note: '', connectedAt: now });
  for (let bi = 0; bi < ids.length; bi++) await base.collection('institutions').doc(ids[bi]).update({ gbpLocations: locations.filter((_, k) => locDefs[k][0] === bi).map((l) => l.id) });
  const RV = [[5, 'Aarav K.', 'Lovely place, friendly staff and very quick service. Will visit again!', 'Thank you Aarav! We are delighted you enjoyed it and look forward to seeing you again.'], [5, 'Meera S.', 'Best experience in the city. Highly recommend to everyone.', 'Thank you Meera, your kind words mean a lot to our team.'], [4, 'Karthik R.', 'Good quality overall, a bit crowded on weekends.', null], [3, 'Divya P.', 'Average experience. The waiting time was quite long.', null], [2, 'Suresh M.', 'Staff were rude and my order was wrong.', null], [1, 'A Google user', 'Terrible service. Never coming back.', null]];
  for (let k = 0; k < locations.length; k++) {
    const l = locations[k], total = rnd(60, 320), avg = Math.round((4.1 + Math.random() * 0.6) * 10) / 10;
    await base.collection('metrics').doc('gbp_' + l.id).set({ locationId: l.id, title: l.title, address: l.address, website: l.website, reviewUrl: l.reviewUrl, mapsUrl: '', avgRating: k === 2 ? 4.1 : avg, prevAvgRating: k === 2 ? 4.5 : Math.max(3.8, avg - 0.1), totalReviews: total,
      last28: { impressions: rnd(6000, 22000), calls: rnd(60, 260), website: rnd(120, 520), directions: rnd(150, 640), messages: rnd(8, 60) }, prev28: { impressions: rnd(5000, 20000), calls: rnd(50, 240), website: rnd(100, 480), directions: rnd(140, 600), messages: rnd(5, 50) }, syncedAt: now });
    const take = k === 0 ? 6 : k === 2 ? 5 : 4;
    for (let n = 0; n < take; n++) {
      const r = RV[k === 0 ? n : (n + k) % RV.length], ageDays = [2, 5, 9, 16, 24, 33][n], ms = Date.now() - ageDays * 864e5;
      await base.collection('reviews').doc(`${l.id}_r${n}`).set({ locationId: l.id, locationTitle: l.title, account: l.account, reviewId: `r${n}`, name: `accounts/demo/locations/${l.id}/reviews/r${n}`, reviewer: r[1], rating: r[0], comment: r[2], createTime: new Date(ms).toISOString(), createMs: ms, updateMs: ms,
        reply: r[3] ? { comment: r[3], updateTime: new Date(ms + 864e5).toISOString() } : null, syncedAt: now });
    }
  }
  await I.runAlerts(orgId);
  await base.collection('copilot').add({ institutionId: '', by: 'demo', createdAt: now, question: 'What should we fix first this week?',
    answer: `Fix the highest-impact problems on **Nova Dental Clinics** first: its search clicks are down about 31% week on week, and its GEO score is only 41.\n\n## Priorities\n1. **Recover Nova Dental search traffic.** Clicks fell from the previous week. Open SEO & Analytics and fix the missing meta description flagged on the home page.\n2. **Unblock AI crawlers on Nova Dental.** Several AI crawlers cannot read the site, so AI assistants may not cite it. Update robots.txt.\n3. **Add FAQ schema and llms.txt for Sunrise Cafés.** Its GEO score is 58 and AI visibility is only 50%. Generate the content kit under GEO.\n\n## Quick wins this week\n- Add 5 customer questions to the AI visibility tracker for each brand.\n- Pause the campaign that spent money with zero clicks (see Alerts).` });
  const s = await I.load(orgId), rep = await I.makeReport(s, s.insts[0], 'demo', false);
  const ref = await base.collection('reports').add(rep), token = crypto.randomBytes(24).toString('hex');
  await db.doc(`reportShares/${token}`).set({ orgId, reportId: ref.id, revoked: false, createdAt: now });
  await ref.update({ shareToken: token });
  await base.update({ demoShareTokens: [token] });
}

exports.adminCreateDemo = onCall({ region: REGION, timeoutSeconds: 300 }, async (req) => {
  needAdmin(req);
  const label = String(req.data?.label || 'Client').trim().slice(0, 40) || 'Client';
  const email = `demo-${slug(label) || 'client'}-${crypto.randomBytes(2).toString('hex')}@orbotriq.test`;
  const out = await makeOrg({ name: `Demo: ${label}`, ownerEmail: email, planId: 'demo', status: 'demo', trialDays: 14, demo: true, by: req.auth.uid });
  await seedDemo(out.orgId);
  return out;
});

exports.adminResetDemo = onCall({ region: REGION, timeoutSeconds: 300 }, async (req) => {
  needAdmin(req);
  const orgId = String(req.data?.orgId || '');
  const ref = db.doc(`orgs/${orgId}`);
  if (!(await ref.get()).data()?.isDemo) throw new HttpsError('failed-precondition', 'Only demo organisations can be reset.');
  for (const t of (await ref.get()).data()?.demoShareTokens || []) await db.doc(`reportShares/${t}`).delete().catch(() => {});
  for (const c of ['institutions', 'metrics', 'seoKeywords', 'geoPrompts', 'scheduledPosts', 'alerts', 'copilot', 'reports', 'reviews', 'gbpPosts']) await db.recursiveDelete(ref.collection(c));
  await ref.update({ usage: {}, status: 'demo' });
  await seedDemo(orgId);
  return { ok: true };
});

// Daily sweep: expire trials and paid periods that have ended (demo and suspended orgs are left alone).
exports.dailyBilling = onSchedule({ region: REGION, schedule: 'every day 02:00', timeZone: 'Asia/Kolkata' }, async () => {
  const snap = await db.collection('orgs').where('status', 'in', ['trialing', 'active']).get();
  const now = Date.now();
  for (const d of snap.docs) {
    const o = d.data(), end = (o.plan === 'trial' ? o.trialEndsAt : o.paidUntil)?.toMillis();
    if (end && end < now) await d.ref.update({ status: 'expired' });
  }
});
