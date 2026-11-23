// Google Business Profile: locations, reviews (sync, AI draft, reply), local performance and local posts.
// Needs Google's "Basic API Access" approval for the Business Profile APIs (quota is 0 until approved).
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const L = require('./growth')._lib;

const db = getFirestore();
const REGION = 'asia-south1';
const ACCOUNTS = 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts';
const INFO = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const V4 = 'https://mybusiness.googleapis.com/v4';
const PERF = 'https://businessprofileperformance.googleapis.com/v1';
const STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const STAFF = ['owner', 'admin', 'staff'];
const ID = /^[A-Za-z0-9_-]{3,160}$/;
const METRICS = ['BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH', 'CALL_CLICKS', 'WEBSITE_CLICKS', 'BUSINESS_DIRECTION_REQUESTS', 'BUSINESS_CONVERSATIONS'];
const GROUP = { CALL_CLICKS: 'calls', WEBSITE_CLICKS: 'website', BUSINESS_DIRECTION_REQUESTS: 'directions', BUSINESS_CONVERSATIONS: 'messages' };

async function gapi(method, url, at, body) {
  const r = await fetch(url, { method, headers: { authorization: `Bearer ${at}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error?.message || `HTTP ${r.status}`), { status: r.status });
  return d;
}
function friendly(e) {
  const m = String(e.message || '');
  if (e.status === 429 || /quota/i.test(m)) return 'Google has not enabled Business Profile API access for this project yet (quota is 0). Apply for Basic API Access and wait for approval.';
  if (e.status === 403) return 'Google refused access. Check that the Business Profile APIs are enabled and that this Google account owns or manages the location.';
  if (e.status === 401) return 'Google access expired. Reconnect Google Business Profile.';
  if (e.status === 404) return 'Google could not find that location or review.';
  return m || 'Google returned an error.';
}
async function token(orgId) {
  const s = (await db.doc(`orgs/${orgId}/_secrets/gbp`).get()).data();
  if (!s) throw new HttpsError('failed-precondition', 'Connect Google Business Profile first.');
  const t = await L.api(L.GOOGLE_TOKEN, { form: { refresh_token: s.refreshToken, client_id: L.GOOGLE_CLIENT_ID.value(), client_secret: L.GOOGLE_CLIENT_SECRET.value(), grant_type: 'refresh_token' } });
  return t.access_token;
}

// Find every account and location the connected Google user can manage.
async function discover(orgId) {
  const ref = db.doc(`orgs/${orgId}/connections/gbp`), at = await token(orgId);
  try {
    const accts = (await gapi('GET', `${ACCOUNTS}?pageSize=20`, at)).accounts || [], locations = [];
    for (const a of accts.slice(0, 10)) {
      let page = '';
      do {
        const r = await gapi('GET', `${INFO}/${a.name}/locations?readMask=name,title,storefrontAddress,websiteUri,metadata&pageSize=100${page ? '&pageToken=' + encodeURIComponent(page) : ''}`, at);
        for (const l of r.locations || []) {
          const addr = l.storefrontAddress || {};
          locations.push({ id: String(l.name).split('/').pop(), account: a.name, title: l.title || String(l.name), website: l.websiteUri || '', reviewUrl: l.metadata?.newReviewUri || '', mapsUrl: l.metadata?.mapsUri || '',
            address: [(addr.addressLines || []).join(', '), addr.locality, addr.administrativeArea].filter(Boolean).join(', ') });
        }
        page = r.nextPageToken || '';
      } while (page && locations.length < 200);
    }
    await ref.set({ provider: 'gbp', status: 'connected', locations: locations.slice(0, 200), accounts: accts.length, lastError: FieldValue.delete(),
      note: locations.length ? '' : 'Connected, but this Google account has no Business Profile locations.', discoveredAt: FieldValue.serverTimestamp() }, { merge: true });
    return locations.length;
  } catch (e) {
    await ref.set({ provider: 'gbp', status: 'connected', note: friendly(e), lastError: String(e.message).slice(0, 200) }, { merge: true });
    throw e;
  }
}

async function syncLocation(orgId, loc, at) {
  const base = `${V4}/${loc.account}/locations/${loc.id}`, reviews = [];
  let avg = null, total = null, page = '';
  for (let i = 0; i < 2; i++) { // latest 100 reviews per location
    const r = await gapi('GET', `${base}/reviews?pageSize=50&orderBy=${encodeURIComponent('updateTime desc')}${page ? '&pageToken=' + encodeURIComponent(page) : ''}`, at);
    if (avg == null && r.averageRating != null) { avg = Number(r.averageRating); total = Number(r.totalReviewCount || 0); }
    reviews.push(...(r.reviews || []));
    page = r.nextPageToken || ''; if (!page) break;
  }
  const batch = db.batch();
  for (const v of reviews) {
    const created = Date.parse(v.createTime) || 0;
    batch.set(db.doc(`orgs/${orgId}/reviews/${loc.id}_${v.reviewId}`), {
      locationId: loc.id, locationTitle: loc.title, account: loc.account, reviewId: v.reviewId, name: v.name,
      reviewer: v.reviewer?.isAnonymous ? 'A Google user' : (v.reviewer?.displayName || 'A Google user'), rating: STARS[v.starRating] || 0,
      comment: String(v.comment || '').slice(0, 4000), createTime: v.createTime || '', createMs: created, updateMs: Date.parse(v.updateTime) || created,
      reply: v.reviewReply ? { comment: String(v.reviewReply.comment || ''), updateTime: v.reviewReply.updateTime || '' } : null, syncedAt: FieldValue.serverTimestamp() });
  }
  await batch.commit();

  let cur = null, prev = null;
  try { // performance data lags about 2 to 3 days, so read 56 days ending 3 days ago and split in two 28-day halves
    const day = (ms) => { const d = new Date(ms); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; };
    const e = new Date(Date.now() - 3 * 864e5), endMs = Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate()), mid = endMs - 27 * 864e5, E = day(endMs), S = day(endMs - 55 * 864e5);
    const qs = new URLSearchParams(); METRICS.forEach((m) => qs.append('dailyMetrics', m));
    qs.set('dailyRange.startDate.year', S.y); qs.set('dailyRange.startDate.month', S.m); qs.set('dailyRange.startDate.day', S.d);
    qs.set('dailyRange.endDate.year', E.y); qs.set('dailyRange.endDate.month', E.m); qs.set('dailyRange.endDate.day', E.d);
    const r = await gapi('GET', `${PERF}/locations/${loc.id}:fetchMultiDailyMetricsTimeSeries?${qs}`, at), tot = { cur: {}, prev: {} };
    for (const g of r.multiDailyMetricTimeSeries || []) for (const ts of g.dailyMetricTimeSeries || []) {
      const k = GROUP[ts.dailyMetric] || (/^BUSINESS_IMPRESSIONS/.test(ts.dailyMetric) ? 'impressions' : null); if (!k) continue;
      for (const dv of ts.timeSeries?.datedValues || []) { const t = Date.UTC(dv.date.year, dv.date.month - 1, dv.date.day), b = t >= mid ? tot.cur : tot.prev; b[k] = (b[k] || 0) + Number(dv.value || 0); }
    }
    cur = tot.cur; prev = tot.prev;
  } catch (e) { console.warn('gbp performance', loc.id, e.message); }

  const mref = db.doc(`orgs/${orgId}/metrics/gbp_${loc.id}`), old = (await mref.get()).data() || {}, today = new Date().toISOString().slice(0, 10);
  let weekly = old.ratingWeekly || []; const last = weekly[weekly.length - 1];
  if (avg != null && (!last || Date.parse(today) - Date.parse(last.d) >= 6 * 864e5)) weekly = [...weekly, { d: today, avg }].slice(-8);
  await mref.set({ locationId: loc.id, title: loc.title, address: loc.address, website: loc.website, reviewUrl: loc.reviewUrl, mapsUrl: loc.mapsUrl,
    avgRating: avg ?? old.avgRating ?? null, prevAvgRating: weekly.length >= 2 ? weekly[weekly.length - 2].avg : null, ratingWeekly: weekly,
    totalReviews: total ?? old.totalReviews ?? 0, last28: cur || old.last28 || null, prev28: prev || old.prev28 || null, syncedAt: FieldValue.serverTimestamp() });
}

async function syncGbp(orgId) {
  const cref = db.doc(`orgs/${orgId}/connections/gbp`);
  let conn = (await cref.get()).data();
  if (!conn || conn.status !== 'connected') return;
  if (!conn.locations?.length) { try { await discover(orgId); } catch { return; } conn = (await cref.get()).data(); }
  const at = await token(orgId);
  for (const loc of (conn.locations || []).slice(0, 60)) {
    try { await syncLocation(orgId, loc, at); }
    catch (e) { console.error('gbp location failed', orgId, loc.id, e.message); if (e.status === 401) throw e; if (e.status === 429) { await cref.set({ note: friendly(e) }, { merge: true }); return; } }
  }
  await cref.set({ note: '', lastSyncAt: FieldValue.serverTimestamp() }, { merge: true });
}
Object.defineProperty(exports, '_sync', { enumerable: false, value: { discover, syncGbp } });

// ---------- Callables ----------
exports.gbpRefreshLocations = onCall({ region: REGION, secrets: L.SECRETS, timeoutSeconds: 120 }, async (req) => {
  const orgId = await L.need(req, ['owner', 'admin']);
  try { return { count: await discover(orgId) }; } catch (e) { throw new HttpsError('failed-precondition', friendly(e)); }
});

async function reviewOf(orgId, id) {
  if (!ID.test(String(id || ''))) throw new HttpsError('invalid-argument', 'Choose a review first.');
  const ref = db.doc(`orgs/${orgId}/reviews/${id}`), r = (await ref.get()).data();
  if (!r) throw new HttpsError('not-found', 'Review not found. Press Sync now and try again.');
  return { ref, r };
}

const DRAFT_SYSTEM = `You write public replies to Google reviews on behalf of a business owner.
Rules: 40 to 90 words, plain text, no emojis, no hashtags. Greet the reviewer by first name only if the name looks like a real name.
Thank them. For 4 or 5 stars, mention one specific detail from the review and invite them back.
For 3 stars or fewer, apologise sincerely without excuses or admitting legal fault, say you want to put it right, and invite them to contact the business directly. Do not invent phone numbers, emails, offers or facts. Never promise refunds or compensation.
End with the business name as the sign-off. Return only the reply text.`;

exports.gbpDraftReply = onCall({ region: REGION, timeoutSeconds: 60, secrets: [L.ANTHROPIC_API_KEY] }, async (req) => {
  const orgId = await L.need(req, STAFF), { r } = await reviewOf(orgId, req.data?.reviewDocId);
  L.aiReady(); await L.useQuota(orgId, 'geoRuns', 1);
  const tone = { formal: 'formal and professional', short: 'short and friendly (40 words)' }[req.data?.tone] || 'warm and friendly';
  const d = await L.claude({ max: 350, system: DRAFT_SYSTEM, prompt: `Business: ${r.locationTitle}\nStar rating: ${r.rating} out of 5\nReviewer name: ${r.reviewer}\nReview text: ${r.comment || '(rating only, no text)'}\nTone: ${tone}` });
  const draft = d.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!draft) throw new HttpsError('internal', 'The AI did not return a draft. Please try again.');
  return { draft };
});

exports.gbpReply = onCall({ region: REGION, secrets: L.SECRETS }, async (req) => {
  const orgId = await L.need(req, STAFF), { ref, r } = await reviewOf(orgId, req.data?.reviewDocId);
  const comment = String(req.data?.comment || '').trim();
  if (comment.length < 2 || comment.length > 4000) throw new HttpsError('invalid-argument', 'Write a reply between 2 and 4000 characters.');
  try { await gapi('PUT', `${V4}/${r.name}/reply`, await token(orgId), { comment }); } catch (e) { throw new HttpsError('failed-precondition', friendly(e)); }
  await ref.update({ reply: { comment, updateTime: new Date().toISOString() } });
  await db.collection(`orgs/${orgId}/auditLogs`).add({ action: 'review.replied', reviewId: r.reviewId, by: req.auth.uid, at: FieldValue.serverTimestamp() });
  return { ok: true };
});

exports.gbpDeleteReply = onCall({ region: REGION, secrets: L.SECRETS }, async (req) => {
  const orgId = await L.need(req, STAFF), { ref, r } = await reviewOf(orgId, req.data?.reviewDocId);
  try { await gapi('DELETE', `${V4}/${r.name}/reply`, await token(orgId)); } catch (e) { throw new HttpsError('failed-precondition', friendly(e)); }
  await ref.update({ reply: null });
  return { ok: true };
});

exports.gbpPost = onCall({ region: REGION, secrets: L.SECRETS, timeoutSeconds: 120 }, async (req) => {
  const orgId = await L.need(req, STAFF);
  const summary = String(req.data?.summary || '').trim(), ids = [...new Set((req.data?.locationIds || []).map(String))].slice(0, 20);
  if (summary.length < 5 || summary.length > 1500) throw new HttpsError('invalid-argument', 'The post must be 5 to 1500 characters.');
  const https = (u, label) => { if (!u) return ''; try { const x = new URL(u); if (x.protocol !== 'https:') throw new Error(); return x.href; } catch { throw new HttpsError('invalid-argument', `${label} must be a public https link.`); } };
  const link = https(String(req.data?.url || '').trim(), 'The button link'), image = https(String(req.data?.imageUrl || '').trim(), 'The image link');
  const conn = (await db.doc(`orgs/${orgId}/connections/gbp`).get()).data(), locs = (conn?.locations || []).filter((l) => ids.includes(l.id));
  if (!locs.length) throw new HttpsError('failed-precondition', 'Choose at least one connected location.');
  const at = await token(orgId), results = [];
  for (const l of locs) {
    try {
      await gapi('POST', `${V4}/${l.account}/locations/${l.id}/localPosts`, at, { languageCode: 'en', summary, topicType: 'STANDARD',
        ...(link ? { callToAction: { actionType: 'LEARN_MORE', url: link } } : {}), ...(image ? { media: [{ mediaFormat: 'PHOTO', sourceUrl: image }] } : {}) });
      results.push({ id: l.id, title: l.title, ok: true });
    } catch (e) { results.push({ id: l.id, title: l.title, ok: false, error: friendly(e).slice(0, 160) }); }
  }
  await db.collection(`orgs/${orgId}/gbpPosts`).add({ summary: summary.slice(0, 200), results, by: req.auth.uid, createdAt: FieldValue.serverTimestamp() });
  return { posted: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length, errors: results.filter((x) => !x.ok).map((x) => `${x.title}: ${x.error}`) };
});
