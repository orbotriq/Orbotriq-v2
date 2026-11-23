const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret, defineString } = require('firebase-functions/params');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');

const db = getFirestore();
const REGION = 'asia-south1';

// Deploy-time settings (firebase deploy asks for these once)
const APP_URL = defineString('APP_URL'); // e.g. https://app.growlytic.in (no trailing slash)
const META_APP_ID = defineString('META_APP_ID');
const GOOGLE_CLIENT_ID = defineString('GOOGLE_CLIENT_ID');
const GRAPH_VERSION = defineString('GRAPH_VERSION', { default: 'v25.0' }); // check Meta's current version
const META_APP_SECRET = defineSecret('META_APP_SECRET');
const GOOGLE_CLIENT_SECRET = defineSecret('GOOGLE_CLIENT_SECRET');
const SECRETS = [META_APP_SECRET, GOOGLE_CLIENT_SECRET];
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY'); // powers GEO AI checks and content kits
const AI_MODEL = defineString('AI_MODEL', { default: 'claude-haiku-5-5' });

const callbackUrl = () => `${APP_URL.value()}/oauth/callback`;
const graph = () => `https://graph.facebook.com/${GRAPH_VERSION.value()}`;
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';

// ---------- helpers ----------
async function api(url, { token, form, json } = {}) {
  const headers = {};
  let body;
  if (token) headers.authorization = `Bearer ${token}`;
  if (form) body = new URLSearchParams(form);
  if (json) { body = JSON.stringify(json); headers['content-type'] = 'application/json'; }
  const r = await fetch(url, { method: body ? 'POST' : 'GET', headers, body, signal: AbortSignal.timeout(20000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data.error?.message || data.error_description || (typeof data.error === 'string' ? data.error : '') || `HTTP ${r.status}`;
    throw Object.assign(new Error(msg), { status: r.status });
  }
  return data;
}

async function need(req, roles) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const { orgId, role } = req.auth.token;
  if (!orgId || !roles.includes(role)) throw new HttpsError('permission-denied', 'You do not have permission to do this.');
  const org = (await db.doc(`orgs/${orgId}`).get()).data();
  if (!org || !['trialing', 'active', 'demo'].includes(org.status)) {
    throw new HttpsError('failed-precondition', 'This subscription is not active. Please contact support.');
  }
  return orgId;
}

// ---------- 0. Meta app credentials (one Meta app per organisation) ----------
// Each customer creates their own Meta app and saves its App ID + Secret in Settings.
// The secret lives only in orgs/{orgId}/_secrets/metaApp (Admin SDK access only).
// Orgs without their own app fall back to the global META_APP_ID / META_APP_SECRET, if set.
async function metaCreds(orgId, { needSecret = false } = {}) {
  const own = (await db.doc(`orgs/${orgId}/_secrets/metaApp`).get()).data();
  if (own?.appId && own?.appSecret) return { id: own.appId, secret: own.appSecret, own: true };
  const gid = META_APP_ID.value();
  if (/^\d{8,20}$/.test(gid)) return { id: gid, secret: needSecret ? META_APP_SECRET.value() : '', own: false };
  throw new HttpsError('failed-precondition', 'Save your Meta app details under Connections > Meta app details before connecting Meta.');
}

exports.saveMetaApp = onCall({ region: REGION }, async (req) => {
  const orgId = await need(req, ['owner', 'admin']);
  const appId = String(req.data?.appId || '').trim();
  const appSecret = String(req.data?.appSecret || '').trim();
  if (!/^\d{8,20}$/.test(appId)) throw new HttpsError('invalid-argument', 'App ID should be a number (8-20 digits).');
  if (!/^[a-f0-9]{32}$/i.test(appSecret)) throw new HttpsError('invalid-argument', 'App Secret should be 32 letters/numbers. Copy it from App settings > Basic.');

  // Verify with Meta before saving: an app access token is "appId|appSecret".
  let info;
  try {
    info = await api(`${graph()}/${appId}?` + new URLSearchParams({ fields: 'name', access_token: `${appId}|${appSecret}` }));
  } catch (e) {
    console.error('saveMetaApp verify failed', appId, e.message);
    const m = String(e.message || '');
    const why = /signature|access token|secret/i.test(m) ? 'The App Secret does not match this App ID.'
      : /validating application|application info|does not exist|Unsupported get request/i.test(m) ? 'Meta could not find an app with this App ID. Use the App ID from App settings > Basic.'
      : `Meta said: ${m.slice(0, 140)}`;
    throw new HttpsError('invalid-argument', `Meta did not accept this App ID and Secret. ${why}`);
  }

  await db.doc(`orgs/${orgId}/_secrets/metaApp`).set({ appId, appSecret, updatedAt: FieldValue.serverTimestamp() });
  await db.doc(`orgs/${orgId}/connections/metaApp`).set({
    appId, appName: info.name || '', secretLast4: appSecret.slice(-4), updatedAt: FieldValue.serverTimestamp(),
  });
  // A new app means old tokens are invalid, so the customer must connect again.
  await db.doc(`orgs/${orgId}/connections/meta`).delete().catch(() => {});
  await db.doc(`orgs/${orgId}/_secrets/meta`).delete().catch(() => {});
  await db.collection(`orgs/${orgId}/auditLogs`).add({ action: 'metaApp.saved', by: req.auth.uid, at: FieldValue.serverTimestamp() });
  return { ok: true, appName: info.name || '' };
});

// ---------- 1. Connect Meta / Google (OAuth) ----------
exports.startOAuth = onCall({ region: REGION }, async (req) => {
  const orgId = await need(req, ['owner', 'admin']);
  const provider = req.data?.provider;
  if ((await db.doc(`orgs/${orgId}`).get()).data()?.status === 'demo') {
    throw new HttpsError('failed-precondition', 'Demo accounts use sample data and cannot connect real accounts.');
  }
  if (!['meta', 'google', 'gbp'].includes(provider)) throw new HttpsError('invalid-argument', 'Unknown provider.');

  const metaApp = provider === 'meta' ? await metaCreds(orgId) : null;
  const state = crypto.randomBytes(24).toString('hex');
  await db.doc(`_oauthStates/${state}`).set({
    orgId, uid: req.auth.uid, provider,
    expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
  });

  let url;
  if (provider === 'meta') {
    url = new URL(`https://www.facebook.com/${GRAPH_VERSION.value()}/dialog/oauth`);
    url.search = new URLSearchParams({
      client_id: metaApp.id, redirect_uri: callbackUrl(), state,
      scope: 'pages_show_list,pages_read_engagement,read_insights,pages_manage_posts,instagram_basic,instagram_manage_insights,instagram_content_publish,ads_read,ads_management',
    });
  } else {
    url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID.value(), redirect_uri: callbackUrl(), state,
      response_type: 'code', access_type: 'offline', prompt: 'consent',
      scope: provider === 'gbp' ? 'https://www.googleapis.com/auth/business.manage' : 'https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly',
    });
  }
  return { url: url.href };
});

// Hosting rewrites /oauth/callback to this function (see firebase.json)
exports.oauthCallback = onRequest({ region: REGION, secrets: SECRETS }, async (req, res) => {
  const back = (r) => res.redirect(`${APP_URL.value()}/app/?connect=${r}`);
  const code = String(req.query.code || '');
  const state = String(req.query.state || '');
  if (req.query.error || !code || !/^[a-f0-9]{48}$/.test(state)) return back('denied');

  const ref = db.doc(`_oauthStates/${state}`);
  const s = (await ref.get()).data();
  await ref.delete().catch(() => {});
  if (!s || s.expiresAt.toMillis() < Date.now()) return back('expired');

  try {
    if (s.provider === 'meta') await finishMeta(s.orgId, code);
    else await finishGoogle(s.orgId, code, s.provider);
    return back(`${s.provider}_ok`);
  } catch (e) {
    console.error('oauth failed', s.provider, e.message);
    return back('failed');
  }
});

async function finishMeta(orgId, code) {
  const { id, secret } = await metaCreds(orgId, { needSecret: true });
  const short = await api(`${graph()}/oauth/access_token?` + new URLSearchParams({
    client_id: id, client_secret: secret, redirect_uri: callbackUrl(), code }));
  const long = await api(`${graph()}/oauth/access_token?` + new URLSearchParams({
    grant_type: 'fb_exchange_token', client_id: id, client_secret: secret, fb_exchange_token: short.access_token }));
  const pages = await api(`${graph()}/me/accounts?` + new URLSearchParams({
    fields: 'id,name,access_token,instagram_business_account{id}', limit: '100', access_token: long.access_token }));
  let adAccounts = [];
  try {
    adAccounts = (await api(`${graph()}/me/adaccounts?` + new URLSearchParams({
      fields: 'id,name,currency', limit: '50', access_token: long.access_token }))).data || [];
  } catch (e) { console.error('ad accounts not available', e.message); }

  // Tokens: server-only (Firestore rules block all client access to _secrets)
  await db.doc(`orgs/${orgId}/_secrets/meta`).set({
    userToken: long.access_token,
    adAccounts: adAccounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency || '' })),
    pages: pages.data.map((p) => ({ id: p.id, name: p.name, token: p.access_token, ig: p.instagram_business_account?.id || null })),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await db.doc(`orgs/${orgId}/connections/meta`).set({
    provider: 'meta', status: 'connected',
    pages: pages.data.map((p) => ({ id: p.id, name: p.name })),
    adAccounts: adAccounts.length,
    connectedAt: FieldValue.serverTimestamp(),
  });
}

async function finishGoogle(orgId, code, provider = 'google') {
  const tok = await api(GOOGLE_TOKEN, { form: {
    code, client_id: GOOGLE_CLIENT_ID.value(), client_secret: GOOGLE_CLIENT_SECRET.value(),
    redirect_uri: callbackUrl(), grant_type: 'authorization_code' } });
  if (!tok.refresh_token) throw new Error('No refresh token returned');
  await db.doc(`orgs/${orgId}/_secrets/${provider}`).set({
    refreshToken: tok.refresh_token, updatedAt: FieldValue.serverTimestamp() });
  await db.doc(`orgs/${orgId}/connections/${provider}`).set({
    provider, status: 'connected', connectedAt: FieldValue.serverTimestamp() });
  if (provider === 'gbp') await require('./local')._sync.discover(orgId).catch((e) => console.error('gbp discover failed', e.message));
}

// ---------- 2. Sync: Meta pages + Search Console + keyword ranks ----------
async function syncMeta(orgId) {
  const s = (await db.doc(`orgs/${orgId}/_secrets/meta`).get()).data();
  if (!s) return;
  for (const p of s.pages) {
    const base = await api(`${graph()}/${p.id}?` + new URLSearchParams({
      fields: 'name,fan_count,followers_count', access_token: p.token }));
    const posts = await api(`${graph()}/${p.id}/posts?` + new URLSearchParams({
      fields: 'message,created_time,permalink_url,reactions.summary(true).limit(0),comments.summary(true).limit(0)',
      limit: '10', access_token: p.token }));
    await db.doc(`orgs/${orgId}/metrics/meta_${p.id}`).set({
      name: base.name, fans: base.fan_count ?? null, followers: base.followers_count ?? null,
      posts: (posts.data || []).map((x) => ({
        text: (x.message || '').slice(0, 140), createdTime: x.created_time, url: x.permalink_url || '',
        reactions: x.reactions?.summary?.total_count ?? 0, comments: x.comments?.summary?.total_count ?? 0 })),
      syncedAt: FieldValue.serverTimestamp(),
    });
  }
}

async function syncGsc(orgId) {
  const s = (await db.doc(`orgs/${orgId}/_secrets/google`).get()).data();
  if (!s) return;
  const t = await api(GOOGLE_TOKEN, { form: {
    refresh_token: s.refreshToken, client_id: GOOGLE_CLIENT_ID.value(),
    client_secret: GOOGLE_CLIENT_SECRET.value(), grant_type: 'refresh_token' } });
  const at = t.access_token;
  const sites = (await api('https://www.googleapis.com/webmasters/v3/sites', { token: at })).siteEntry || [];
  const iso = (d) => d.toISOString().slice(0, 10);
  const end = new Date(Date.now() - 3 * 864e5), start = new Date(end.getTime() - 27 * 864e5);
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const query = (site, body) => api(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
    { token: at, json: { startDate: iso(start), endDate: iso(end), ...body } });

  const insts = await db.collection(`orgs/${orgId}/institutions`).get();
  for (const d of insts.docs) {
    const inst = d.data();
    if (!inst.websiteUrl) continue;
    const h = host(inst.websiteUrl);
    const site = sites.find((x) => x.siteUrl === `sc-domain:${h}`) || sites.find((x) => host(x.siteUrl) === h);
    const mref = db.doc(`orgs/${orgId}/metrics/gsc_${d.id}`);
    if (!site) { await mref.set({ status: 'no_access', syncedAt: FieldValue.serverTimestamp() }); continue; }

    const top = (await query(site.siteUrl, { dimensions: ['query'], rowLimit: 250 })).rows || [];
    const rows = top.map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions,
      position: Math.round(r.position * 10) / 10 }));
    const totalClicks = rows.reduce((a, r) => a + r.clicks, 0);
    let daily = [];
    try {
      daily = ((await query(site.siteUrl, { dimensions: ['date'], rowLimit: 40 })).rows || [])
        .map((r) => ({ d: r.keys[0], c: r.clicks, i: r.impressions })).sort((a, b) => (a.d < b.d ? -1 : 1)).slice(-28);
    } catch (e) { console.error('GSC daily series failed', e.message); }
    let topPages = [];
    try {
      topPages = ((await query(site.siteUrl, { dimensions: ['page'], rowLimit: 8 })).rows || [])
        .map((r) => ({ page: r.keys[0], clicks: r.clicks, impressions: r.impressions }));
    } catch (e) { console.error('GSC pages failed', e.message); }
    const buckets = { top3: top.filter((r) => r.position <= 3).length, top10: top.filter((r) => r.position <= 10).length, top20: top.filter((r) => r.position <= 20).length, top100: top.length };
    const old = (await mref.get()).data() || {}, today = new Date().toISOString().slice(0, 10);
    let weekly = old.weekly || [];
    const lastSnap = weekly[weekly.length - 1];
    if (!lastSnap || Date.parse(today) - Date.parse(lastSnap.d) >= 6 * 864e5) weekly = [...weekly, { d: today, clicks: totalClicks }].slice(-8);
    await mref.set({
      status: 'ok', siteUrl: site.siteUrl,
      clicks: totalClicks, impressions: rows.reduce((a, r) => a + r.impressions, 0),
      weekly, daily, topPages, buckets, prevBuckets: old.buckets ?? null, prevClicks: weekly.length >= 2 ? weekly[weekly.length - 2].clicks : null,
      topQueries: rows.slice(0, 25), syncedAt: FieldValue.serverTimestamp() });

    // Tracked keywords: exact lookup for each (max 50 per institution)
    const kws = await db.collection(`orgs/${orgId}/seoKeywords`).where('institutionId', '==', d.id).limit(50).get();
    for (const k of kws.docs) {
      const r = ((await query(site.siteUrl, { dimensions: ['query'], rowLimit: 1,
        dimensionFilterGroups: [{ filters: [{ dimension: 'query', operator: 'equals', expression: k.data().keyword }] }] })).rows || [])[0];
      const pp = k.data().position ?? null;
      const pos = r ? Math.round(r.position * 10) / 10 : null;
      const day0 = new Date().toISOString().slice(0, 10), hist = (k.data().history || []).filter((x) => x.d !== day0);
      const history = [...hist, { d: day0, p: pos }].slice(-12);
      await k.ref.update(r
        ? { prevPosition: pp, position: pos, history, clicks: r.clicks, impressions: r.impressions, updatedAt: FieldValue.serverTimestamp() }
        : { prevPosition: pp, position: null, history, clicks: 0, impressions: 0, updatedAt: FieldValue.serverTimestamp() });
    }
  }
}

// ---------- Extra syncs: page reach, Instagram, Meta ads, Google Analytics ----------
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const sumVals = (m) => (m?.values || []).reduce((a, v) => a + (v.value || 0), 0);

async function googleAccess(orgId) {
  const s = (await db.doc(`orgs/${orgId}/_secrets/google`).get()).data();
  if (!s) return null;
  const t = await api(GOOGLE_TOKEN, { form: {
    refresh_token: s.refreshToken, client_id: GOOGLE_CLIENT_ID.value(),
    client_secret: GOOGLE_CLIENT_SECRET.value(), grant_type: 'refresh_token' } });
  return t.access_token;
}

// Facebook reach uses Meta's current metrics (page_total_media_view_unique, page_media_view, page_follows);
// the old page_impressions_* metrics were removed in 2025-2026.
async function syncMetaInsights(orgId) {
  const s = (await db.doc(`orgs/${orgId}/_secrets/meta`).get()).data();
  if (!s) return;
  const until = Math.floor(Date.now() / 1000), since = until - 28 * 86400;
  for (const p of s.pages) {
    const out = { hasIg: !!p.ig };
    try {
      const ins = await api(`${graph()}/${p.id}/insights?` + new URLSearchParams({
        metric: 'page_total_media_view_unique,page_media_view,page_follows', period: 'day',
        since: String(since), until: String(until), access_token: p.token }));
      const by = Object.fromEntries((ins.data || []).map((m) => [m.name, m]));
      out.reach28 = sumVals(by.page_total_media_view_unique);
      out.views28 = sumVals(by.page_media_view);
      out.follows = (by.page_follows?.values || []).slice(-1)[0]?.value ?? null;
    } catch (e) { out.insightsError = String(e.message).slice(0, 150); }
    if (p.ig) {
      try {
        const info = await api(`${graph()}/${p.ig}?` + new URLSearchParams({
          fields: 'username,followers_count,media_count', access_token: p.token }));
        const ins = await api(`${graph()}/${p.ig}/insights?` + new URLSearchParams({
          metric: 'reach,views,accounts_engaged,total_interactions', metric_type: 'total_value', period: 'day',
          since: String(since), until: String(until), access_token: p.token }));
        const v = Object.fromEntries((ins.data || []).map((m) => [m.name, m.total_value?.value ?? 0]));
        out.ig = { username: info.username || '', followers: info.followers_count ?? 0,
          reach: v.reach ?? 0, views: v.views ?? 0, accounts_engaged: v.accounts_engaged ?? 0, total_interactions: v.total_interactions ?? 0 };
      } catch (e) { out.igError = String(e.message).slice(0, 150); }
    }
    await db.doc(`orgs/${orgId}/metrics/meta_${p.id}`).set(out, { merge: true });
  }
}

async function syncAds(orgId) {
  const s = (await db.doc(`orgs/${orgId}/_secrets/meta`).get()).data();
  if (!s?.userToken || !s.adAccounts?.length) return;
  for (const a of s.adAccounts) {
    try {
      const q = (extra) => api(`${graph()}/${a.id}/insights?` + new URLSearchParams({
        date_preset: 'last_30d', access_token: s.userToken, ...extra }));
      const tot = ((await q({ fields: 'spend,impressions,reach,clicks,ctr,cpc' })).data || [])[0] || {};
      const byCamp = Object.fromEntries(((await q({ level: 'campaign', limit: '100',
        fields: 'campaign_id,spend,impressions,clicks' })).data || []).map((c) => [c.campaign_id, c]));
      const list = (await api(`${graph()}/${a.id}/campaigns?` + new URLSearchParams({
        fields: 'id,name,effective_status', limit: '50', access_token: s.userToken }))).data || [];
      await db.doc(`orgs/${orgId}/metrics/ads_${a.id.replace('act_', '')}`).set({
        accountId: a.id, name: a.name || a.id, currency: a.currency || '',
        spend: Number(tot.spend || 0), impressions: Number(tot.impressions || 0), reach: Number(tot.reach || 0),
        clicks: Number(tot.clicks || 0), ctr: Number(tot.ctr || 0), cpc: Number(tot.cpc || 0),
        campaigns: list.map((c) => ({ id: c.id, name: c.name, status: c.effective_status,
          spend: Number(byCamp[c.id]?.spend || 0), impressions: Number(byCamp[c.id]?.impressions || 0), clicks: Number(byCamp[c.id]?.clicks || 0) })),
        syncedAt: FieldValue.serverTimestamp() });
    } catch (e) { console.error('ads sync failed', orgId, a.id, e.message); } // never mark Meta as expired for ad-permission errors
  }
}

async function syncGa(orgId) {
  const at = await googleAccess(orgId);
  if (!at) return;
  const insts = await db.collection(`orgs/${orgId}/institutions`).get();
  const hosts = new Map(insts.docs.filter((d) => d.data().websiteUrl).map((d) => [hostOf(d.data().websiteUrl), d.id]));
  let sums;
  try { sums = (await api('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200', { token: at })).accountSummaries || []; }
  catch (e) { console.error('GA admin API unavailable', orgId, e.message); return; }
  const props = sums.flatMap((a) => a.propertySummaries || []).map((p) => p.property).slice(0, 40);
  for (const prop of props) {
    let streams;
    try { streams = (await api(`https://analyticsadmin.googleapis.com/v1beta/${prop}/dataStreams`, { token: at })).dataStreams || []; }
    catch { continue; }
    const id = streams.map((x) => hosts.get(hostOf(x.webStreamData?.defaultUri || ''))).find(Boolean);
    if (!id) continue;
    try {
      const rep = (body) => api(`https://analyticsdata.googleapis.com/v1beta/${prop}:runReport`, {
        token: at, json: { dateRanges: [{ startDate: '28daysAgo', endDate: 'yesterday' }], ...body } });
      const tot = ((await rep({ metrics: ['activeUsers', 'sessions', 'screenPageViews', 'engagementRate'].map((name) => ({ name })) })).rows?.[0]?.metricValues || []).map((m) => Number(m.value));
      const ch = (await rep({ dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 8 })).rows || [];
      let daily = [];
      try {
        daily = ((await rep({ dimensions: [{ name: 'date' }], metrics: [{ name: 'sessions' }], orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 40 })).rows || [])
          .map((r) => ({ d: r.dimensionValues[0].value, v: Number(r.metricValues[0].value) }));
      } catch (e) { console.error('GA daily series failed', e.message); }
      let avgDuration = null, countries = [];
      try { avgDuration = Number((await rep({ metrics: [{ name: 'averageSessionDuration' }] })).rows?.[0]?.metricValues?.[0]?.value || 0); } catch (e) { console.error('GA duration failed', e.message); }
      try {
        countries = ((await rep({ dimensions: [{ name: 'country' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 6 })).rows || [])
          .map((r) => ({ country: r.dimensionValues[0].value, sessions: Number(r.metricValues[0].value) }));
      } catch (e) { console.error('GA countries failed', e.message); }
      await db.doc(`orgs/${orgId}/metrics/ga_${id}`).set({
        property: prop, daily, avgDuration, countries, users: tot[0] || 0, sessions: tot[1] || 0, pageviews: tot[2] || 0,
        engagementRate: Math.round((tot[3] || 0) * 1000) / 10,
        channels: ch.map((r) => ({ channel: r.dimensionValues[0].value, sessions: Number(r.metricValues[0].value) })),
        syncedAt: FieldValue.serverTimestamp() });
    } catch (e) { console.error('GA report failed', orgId, prop, e.message); }
  }
}

async function syncOrg(orgId) {
  for (const [provider, fn] of [['meta', syncMeta], ['meta', syncMetaInsights], ['meta', syncAds], ['google', syncGsc], ['google', syncGa], ['gbp', (id) => require('./local')._sync.syncGbp(id)]]) {
    try { await fn(orgId); } catch (e) {
      console.error('sync failed', orgId, provider, e.message);
      if ([400, 401].includes(e.status)) { // token revoked or expired: ask the customer to reconnect
        const ref = db.doc(`orgs/${orgId}/connections/${provider}`);
        if ((await ref.get()).exists) await ref.update({ status: 'expired', lastError: String(e.message).slice(0, 200) });
      }
    }
  }
}

exports.dailySync = onSchedule(
  { region: REGION, schedule: 'every day 03:00', timeZone: 'Asia/Kolkata', secrets: SECRETS, timeoutSeconds: 540 },
  async () => {
    const orgs = await db.collection('orgs').where('status', 'in', ['trialing', 'active']).get();
    for (const o of orgs.docs) await syncOrg(o.id);
  });

exports.syncNow = onCall({ region: REGION, secrets: SECRETS, timeoutSeconds: 300 }, async (req) => {
  const orgId = await need(req, ['owner', 'admin']);
  const ref = db.doc(`orgs/${orgId}`);
  const o = (await ref.get()).data();
  if (o.lastSyncAt && Date.now() - o.lastSyncAt.toMillis() < 5 * 60 * 1000) {
    throw new HttpsError('resource-exhausted', 'Synced recently. Try again in a few minutes.');
  }
  await ref.update({ lastSyncAt: FieldValue.serverTimestamp() });
  await syncOrg(orgId);
  return { ok: true };
});

// ---------- 3. SEO audit crawler ----------
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const l = ip.toLowerCase();
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l.startsWith('::ffff:');
}

// Customer-supplied URLs are fetched from our server, so block internal addresses (SSRF)
async function safeFetch(url, hops = 3, anyText = false) {
  for (let i = 0; i <= hops; i++) {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only http and https are allowed');
    const addrs = await dns.lookup(u.hostname, { all: true });
    if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error('This address is not allowed');
    const t0 = Date.now();
    let r;
    for (let attempt = 1; ; attempt++) {
      try {
        r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'OrbotriqBot/1.0', accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } });
        break;
      } catch (e) {
        const code = e.cause?.code || e.cause?.message || e.message;
        // Idle sockets on a warm Cloud Functions instance are often reset by the server; a fresh attempt normally succeeds
        if (attempt < 3 && /ECONNRESET|UND_ERR_SOCKET|EPIPE|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|other side closed/i.test(String(code))) { await new Promise((ok) => setTimeout(ok, 400 * attempt)); continue; }
        throw new Error(`${u.hostname}: ${code}`);
      }
    }
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) { url = new URL(loc, u).href; continue; }
    const isHtml = (r.headers.get('content-type') || '').includes('text/html');
    return { status: r.status, ms: Date.now() - t0, url: u.href, html: (isHtml || anyText) ? (await r.text()).slice(0, 500000) : '' };
  }
  throw new Error('Too many redirects');
}

function pageLinks(html, base) {
  const out = new Set(), host = new URL(base).hostname;
  for (const m of html.matchAll(/<a\b[^>]*\bhref=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1], base);
      if (/^https?:$/.test(u.protocol) && u.hostname === host && !/\.(pdf|jpe?g|png|gif|webp|zip|docx?|xlsx?)$/i.test(u.pathname)) out.add(u.href);
    } catch { /* ignore bad links */ }
  }
  out.delete(base);
  return [...out];
}

function checkPage(html) {
  const issues = [], add = (sev, msg) => issues.push({ sev, msg });
  const title = ((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
  if (!title) add('high', 'Missing page title');
  else if (title.length < 20 || title.length > 65) add('low', `Title is ${title.length} characters (aim for 20 to 65)`);
  const metaTag = html.match(/<meta[^>]+name=["']description["'][^>]*>/i);
  const desc = metaTag ? ((metaTag[0].match(/content=["']([^"']*)["']/i) || [])[1] || '') : '';
  if (!desc) add('high', 'Missing meta description');
  else if (desc.length < 70 || desc.length > 160) add('low', `Meta description is ${desc.length} characters (aim for 70 to 160)`);
  const h1 = (html.match(/<h1[\s>]/gi) || []).length;
  if (h1 === 0) add('high', 'No H1 heading'); else if (h1 > 1) add('low', `${h1} H1 headings (use one)`);
  const noAlt = (html.match(/<img\b[^>]*>/gi) || []).filter((i) => !/\balt=["'][^"']+["']/i.test(i)).length;
  if (noAlt) add('medium', `${noAlt} image(s) missing alt text`);
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) add('high', 'Missing viewport tag (not mobile-friendly)');
  if (!/<link[^>]+rel=["']canonical["']/i.test(html)) add('low', 'No canonical link');
  if (!/<html[^>]+lang=/i.test(html)) add('low', 'Missing language attribute on <html>');
  if (!/property=["']og:title["']/i.test(html)) add('low', 'No Open Graph tags for social sharing');
  return { title, issues };
}

exports.runSeoAudit = onCall({ region: REGION, timeoutSeconds: 120 }, async (req) => {
  const orgId = await need(req, ['owner', 'admin', 'staff']);
  const id = String(req.data?.institutionId || '');
  if (!id) throw new HttpsError('invalid-argument', 'Choose a brand.');
  const inst = (await db.doc(`orgs/${orgId}/institutions/${id}`).get()).data();
  if (!inst?.websiteUrl) throw new HttpsError('failed-precondition', 'Add a website URL to this brand first.');

  const ref = db.doc(`orgs/${orgId}/metrics/audit_${id}`);
  const prev = (await ref.get()).data();
  if (prev?.checkedAt && Date.now() - prev.checkedAt.toMillis() < 2 * 60 * 1000) {
    throw new HttpsError('resource-exhausted', 'An audit just ran. Try again in a couple of minutes.');
  }

  let home;
  try { home = await safeFetch(inst.websiteUrl); }
  catch (e) { throw new HttpsError('failed-precondition', `Could not reach the website: ${e.message}`); }

  const site = [], add = (sev, msg) => site.push({ sev, msg });
  if (!home.url.startsWith('https://')) add('high', 'Site is not served over HTTPS');
  if (home.status >= 400) add('high', `Homepage returned HTTP ${home.status}`);
  if (home.ms > 2500) add('medium', `Slow homepage response (${home.ms} ms)`);
  const origin = new URL(home.url).origin;
  for (const f of ['robots.txt', 'sitemap.xml']) {
    try { if ((await safeFetch(`${origin}/${f}`)).status >= 400) add('medium', `No ${f} found`); }
    catch { add('medium', `No ${f} found`); }
  }

  const pages = [{ url: home.url, ...checkPage(home.html) }];
  for (const l of pageLinks(home.html, home.url).slice(0, 5)) {
    try { const p = await safeFetch(l); if (p.status < 400) pages.push({ url: p.url, ...checkPage(p.html) }); } catch { /* skip */ }
  }

  const all = site.concat(...pages.map((p) => p.issues));
  const weight = { high: 10, medium: 5, low: 2 };
  const score = Math.max(0, 100 - all.reduce((a, i) => a + weight[i.sev], 0));
  await ref.set({
    institutionId: id, score, prevScore: prev?.score ?? null, history: [...(prev?.history || []), { d: new Date().toISOString().slice(0, 10), s: score }].slice(-12), highCount: all.filter((i) => i.sev === 'high').length,
    pagesChecked: pages.length, site,
    pages: pages.map((p) => ({ url: p.url, title: p.title || '', issues: p.issues })),
    checkedAt: FieldValue.serverTimestamp(),
  });
  return { score };
});

// ---------- 4. Post scheduling (Facebook + Instagram) ----------
exports.schedulePost = onCall({ region: REGION }, async (req) => {
  const orgId = await need(req, ['owner', 'admin', 'staff']);
  const { pageId, message, imageUrl, when, toInstagram } = req.data || {};
  const text = String(message || '').trim();
  if (!text || text.length > 2000) throw new HttpsError('invalid-argument', 'Post text must be 1 to 2000 characters.');
  const t = new Date(when);
  if (isNaN(t) || t.getTime() < Date.now() + 5 * 60 * 1000 || t.getTime() > Date.now() + 30 * 864e5) {
    throw new HttpsError('invalid-argument', 'Pick a time between 5 minutes and 30 days from now.');
  }
  const s = (await db.doc(`orgs/${orgId}/_secrets/meta`).get()).data();
  const page = s?.pages?.find((p) => p.id === String(pageId));
  if (!page) throw new HttpsError('not-found', 'Page not found. Connect Meta first.');
  let img = '';
  if (imageUrl) {
    try { const u = new URL(imageUrl); if (u.protocol !== 'https:') throw new Error(); img = u.href; }
    catch { throw new HttpsError('invalid-argument', 'The image must be a public https link.'); }
  }
  if (toInstagram && (!page.ig || !img)) throw new HttpsError('invalid-argument', 'Instagram posts need a linked Instagram account and an image.');
  const ref = await db.collection(`orgs/${orgId}/scheduledPosts`).add({
    pageId: page.id, pageName: page.name, message: text, imageUrl: img, toInstagram: !!toInstagram,
    scheduledFor: Timestamp.fromDate(t), status: 'scheduled', createdBy: req.auth.uid, createdAt: FieldValue.serverTimestamp() });
  return { id: ref.id };
});

exports.cancelPost = onCall({ region: REGION }, async (req) => {
  const orgId = await need(req, ['owner', 'admin', 'staff']);
  const ref = db.doc(`orgs/${orgId}/scheduledPosts/${String(req.data?.postId || 'x')}`);
  await db.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data();
    if (!d || d.status !== 'scheduled') throw new HttpsError('failed-precondition', 'This post can no longer be cancelled.');
    tx.update(ref, { status: 'cancelled' });
  });
  return { ok: true };
});

exports.publishDue = onSchedule({ region: REGION, schedule: 'every 5 minutes', timeoutSeconds: 300 }, async () => {
  const due = await db.collectionGroup('scheduledPosts')
    .where('status', '==', 'scheduled').where('scheduledFor', '<=', Timestamp.now()).limit(25).get();
  for (const d of due.docs) {
    const claimed = await db.runTransaction(async (tx) => { // claim first so a post is never published twice
      if ((await tx.get(d.ref)).data().status !== 'scheduled') return false;
      tx.update(d.ref, { status: 'publishing' });
      return true;
    });
    if (!claimed) continue;
    const post = d.data(), orgId = d.ref.parent.parent.id, result = {};
    try {
      const s = (await db.doc(`orgs/${orgId}/_secrets/meta`).get()).data();
      const page = s?.pages?.find((p) => p.id === post.pageId);
      if (!page) throw new Error('Page is no longer connected');
      const call = (path, params) => api(`${graph()}/${path}`, { form: { ...params, access_token: page.token } });
      const fb = post.imageUrl
        ? await call(`${page.id}/photos`, { url: post.imageUrl, caption: post.message })
        : await call(`${page.id}/feed`, { message: post.message });
      result.facebookId = fb.post_id || fb.id;
      if (post.toInstagram && page.ig) {
        const c = await call(`${page.ig}/media`, { image_url: post.imageUrl, caption: post.message });
        result.instagramId = (await call(`${page.ig}/media_publish`, { creation_id: c.id })).id;
      }
      await d.ref.update({ status: 'published', result, publishedAt: FieldValue.serverTimestamp() });
      if (post.promoId) await db.doc(`platform/promo/posts/${post.promoId}`).update({ status: 'published', publishedAt: FieldValue.serverTimestamp() }).catch(() => {});
    } catch (e) {
      await d.ref.update({ status: 'failed', result, error: String(e.message).slice(0, 200) });
      if (post.promoId) await db.doc(`platform/promo/posts/${post.promoId}`).update({ status: 'failed', error: String(e.message).slice(0, 200) }).catch(() => {});
    }
  }
});

// ---------- 5. Meta Ads control: pause / resume a campaign ----------
exports.setCampaignStatus = onCall({ region: REGION }, async (req) => {
  const orgId = await need(req, ['owner', 'admin']);
  const { accountId, campaignId, status } = req.data || {};
  const acct = String(accountId || '').replace('act_', '');
  if (!['ACTIVE', 'PAUSED'].includes(status) || !/^\d+$/.test(acct)) throw new HttpsError('invalid-argument', 'Invalid request.');
  const ref = db.doc(`orgs/${orgId}/metrics/ads_${acct}`);
  const m = (await ref.get()).data();
  if (!m?.campaigns?.some((c) => c.id === String(campaignId))) throw new HttpsError('not-found', 'Campaign not found. Press Sync now and try again.');
  const s = (await db.doc(`orgs/${orgId}/_secrets/meta`).get()).data();
  try { await api(`${graph()}/${campaignId}`, { form: { status, access_token: s.userToken } }); }
  catch (e) { throw new HttpsError('failed-precondition', `Meta rejected the change: ${e.message}`); }
  await ref.update({ campaigns: m.campaigns.map((c) => (c.id === String(campaignId) ? { ...c, status } : c)) });
  await db.collection(`orgs/${orgId}/auditLogs`).add({
    action: `campaign.${status.toLowerCase()}`, campaignId: String(campaignId), by: req.auth.uid, at: FieldValue.serverTimestamp() });
  return { ok: true };
});

// ---------- 6. GEO: Generative Engine Optimization ----------
const stripHtml = (html) => html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

function aiReady() {
  const k = ANTHROPIC_API_KEY.value();
  if (!k || k === 'placeholder') throw new HttpsError('failed-precondition', 'AI checks are not enabled yet. Please contact support.');
}

async function claude({ prompt, system, tools, max = 1500 }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY.value(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: AI_MODEL.value(), max_tokens: max, system, tools, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(100000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpsError('internal', d.error?.message || `AI request failed (${r.status})`);
  return d;
}

// Monthly usage limits per plan (orgs/{id}.limits), reset each calendar month
async function useQuota(orgId, key, amount = 1) {
  const ref = db.doc(`orgs/${orgId}`);
  const ym = new Date().toISOString().slice(0, 7);
  await db.runTransaction(async (tx) => {
    const o = (await tx.get(ref)).data() || {};
    const u = o.usage?.month === ym ? o.usage : { month: ym };
    const limit = o.limits?.[key] ?? 0, used = u[key] || 0;
    if (used + amount > limit) {
      throw new HttpsError('resource-exhausted', `Monthly AI check limit reached (${used}/${limit}). Ask your administrator to upgrade the plan.`);
    }
    tx.update(ref, { usage: { ...u, [key]: used + amount } });
  });
}

const AI_BOTS = [['GPTBot', 'OpenAI training'], ['OAI-SearchBot', 'ChatGPT search'], ['ChatGPT-User', 'ChatGPT browsing'],
  ['ClaudeBot', 'Anthropic Claude'], ['PerplexityBot', 'Perplexity'], ['Google-Extended', 'Gemini training'], ['CCBot', 'Common Crawl']];

function botAccess(robots, bot) {
  if (!robots) return 'unspecified';
  const groups = []; let cur = null;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim(); if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); }
    else if (cur && (k === 'disallow' || k === 'allow')) cur.rules.push([k, v]);
  }
  const g = groups.find((x) => x.agents.includes(bot.toLowerCase())) || groups.find((x) => x.agents.includes('*'));
  if (!g) return 'unspecified';
  const blocked = g.rules.some(([k, v]) => k === 'disallow' && v === '/') && !g.rules.some(([k, v]) => k === 'allow' && v === '/');
  return blocked ? 'blocked' : 'allowed';
}

function jsonLd(html) {
  const types = new Set(); let sameAs = 0, dated = false, author = false;
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (n) => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (!n || typeof n !== 'object') return;
        [].concat(n['@type'] || []).forEach((x) => types.add(String(x)));
        if (n.sameAs) sameAs += [].concat(n.sameAs).length;
        if (n.dateModified || n.datePublished) dated = true;
        if (n.author) author = true;
        Object.values(n).forEach(walk);
      };
      walk(JSON.parse(m[1]));
    } catch { /* ignore invalid JSON-LD */ }
  }
  return { types, sameAs, dated, author };
}

async function geoScan(url) {
  let home;
  try { home = await safeFetch(url); } catch (e) { throw new HttpsError('failed-precondition', `Could not reach the website: ${e.message}`); }
  const origin = new URL(home.url).origin, html = home.html;
  const get = (p) => safeFetch(origin + p, 3, true).catch(() => null);
  const [robotsR, llmsR, mapR] = await Promise.all([get('/robots.txt'), get('/llms.txt'), get('/sitemap.xml')]);
  const robots = robotsR && robotsR.status < 400 ? robotsR.html : '';
  const llms = llmsR && llmsR.status < 400 && llmsR.html.trim().length > 50 && !/<html/i.test(llmsR.html);
  const hasMap = !!(mapR && mapR.status < 400) || /sitemap:/i.test(robots);
  const text = stripHtml(html), words = text ? text.split(' ').length : 0;
  const ld = jsonLd(html);
  const bots = AI_BOTS.map(([bot, purpose]) => ({ bot, purpose, access: botAccess(robots, bot) }));
  const blockedKey = bots.filter((b) => ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'].includes(b.bot) && b.access === 'blocked').length;
  const hq = (html.match(/<h[23][^>]*>[^<]*\?\s*<\/h[23]>/gi) || []).length;
  const heads = (html.match(/<h[23][\s>]/gi) || []).length;
  const lists = (html.match(/<(ul|ol|table)[\s>]/gi) || []).length;
  const aboutLink = /href=["'][^"']*(about)/i.test(html), contactLink = /href=["'][^"']*(contact)/i.test(html);
  const authorSig = ld.author || /<meta[^>]+name=["']author["']/i.test(html) || /rel=["']author["']/i.test(html);
  const dated = ld.dated || /article:(modified|published)_time/i.test(html) || /<time[^>]+datetime=/i.test(html);
  const orgType = [...ld.types].some((t) => /Organization|LocalBusiness|Corporation|School|College|University|Store|Restaurant|Hotel|Clinic|Hospital|Dentist/i.test(t));
  const hasTitle = /<title[^>]*>[^<]+<\/title>/i.test(html), hasDesc = /<meta[^>]+name=["']description["'][^>]*content=["'][^"']+/i.test(html), hasH1 = /<h1[\s>]/i.test(html);
  const credits = [authorSig, ld.sameAs >= 2, aboutLink, contactLink].filter(Boolean).length;

  const C = [];
  const add = (cid, label, w, status, tip) => C.push({ id: cid, label, w, status, tip });
  add('bots', 'AI crawlers can read your site', 15, !robots ? 'warn' : blockedKey === 0 ? 'pass' : blockedKey < 3 ? 'warn' : 'fail',
    robots ? (blockedKey ? `${blockedKey} major AI crawler(s) are blocked in robots.txt. Allow them if you want to appear in AI answers.` : 'robots.txt does not block the major AI crawlers.') : 'No robots.txt found. Add one that allows AI crawlers.');
  add('llms', 'llms.txt guide for AI', 10, llms ? 'pass' : 'fail', llms ? 'Found /llms.txt.' : 'Add /llms.txt: a short, structured summary of your brand and key pages for AI assistants.');
  add('org', 'Organization schema (JSON-LD)', 10, orgType ? 'pass' : 'fail', orgType ? 'Organization or business schema found.' : 'Add Organization or LocalBusiness JSON-LD so AI can identify who you are.');
  add('faq', 'FAQ content AI can quote', 10, ld.types.has('FAQPage') ? 'pass' : hq >= 3 ? 'warn' : 'fail', ld.types.has('FAQPage') ? 'FAQPage schema found.' : hq >= 3 ? 'You have question headings, but no FAQPage schema.' : 'Add 5 to 8 real customer questions with short, direct answers (and FAQPage schema).');
  add('structure', 'Clear headings (answer-first structure)', 10, heads >= 4 ? 'pass' : heads >= 2 ? 'warn' : 'fail', `${heads} H2/H3 headings found. Use descriptive headings with the answer in the first sentence.`);
  add('lists', 'Lists and tables', 5, lists >= 2 ? 'pass' : lists === 1 ? 'warn' : 'fail', `${lists} list/table block(s). Structured lists are easy for AI to lift into answers.`);
  add('depth', 'Content depth', 10, words >= 600 ? 'pass' : words >= 250 ? 'warn' : 'fail', `About ${words} words on this page. Pages with specific, original detail get cited more.`);
  add('fresh', 'Freshness signals', 5, dated ? 'pass' : 'fail', dated ? 'Publish or update dates found.' : 'Add dateModified (schema or a visible updated date).');
  add('trust', 'Authorship and trust signals', 10, credits >= 3 ? 'pass' : credits === 2 ? 'warn' : 'fail', `${credits} of 4 signals found (author, sameAs profiles, About link, Contact link).`);
  add('entity', 'Title, description and H1', 5, hasTitle && hasDesc && hasH1 ? 'pass' : hasTitle || hasDesc ? 'warn' : 'fail', 'A clear title, meta description and one H1 state what the page is about.');
  add('tech', 'HTTPS and sitemap', 5, home.url.startsWith('https://') && hasMap ? 'pass' : home.url.startsWith('https://') || hasMap ? 'warn' : 'fail', 'Use HTTPS and publish /sitemap.xml.');
  add('speed', 'Fast response', 5, home.ms < 2500 ? 'pass' : home.ms < 5000 ? 'warn' : 'fail', `Homepage responded in ${home.ms} ms.`);
  const score = Math.round(C.reduce((a, c) => a + c.w * (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0), 0));
  return { score, checks: C.map(({ w, ...c }) => c), bots, wordCount: words, ms: home.ms };
}

exports.runGeoAudit = onCall({ region: REGION, timeoutSeconds: 120 }, async (req) => {
  const orgId = await need(req, ['owner', 'admin', 'staff']);
  const id = String(req.data?.institutionId || '');
  const inst = id ? (await db.doc(`orgs/${orgId}/institutions/${id}`).get()).data() : null;
  if (!inst?.websiteUrl) throw new HttpsError('failed-precondition', 'Add a website URL to this brand first.');
  const ref = db.doc(`orgs/${orgId}/metrics/geo_${id}`);
  const prev = (await ref.get()).data();
  if (prev?.checkedAt && Date.now() - prev.checkedAt.toMillis() < 2 * 60 * 1000) throw new HttpsError('resource-exhausted', 'A GEO audit just ran. Try again in a couple of minutes.');

  const r = await geoScan(inst.websiteUrl);
  await ref.set({ institutionId: id, score: r.score, prevScore: prev?.score ?? null, history: [...(prev?.history || []), { d: new Date().toISOString().slice(0, 10), s: r.score }].slice(-12), checks: r.checks, bots: r.bots, wordCount: r.wordCount, checkedAt: FieldValue.serverTimestamp() });
  return { score: r.score };
});

// Asks an AI search assistant (with live web search) the tracked questions and records whether the brand is mentioned or cited.
exports.geoMonitor = onCall({ region: REGION, timeoutSeconds: 300, secrets: [ANTHROPIC_API_KEY] }, async (req) => {
  const orgId = await need(req, ['owner', 'admin', 'staff']);
  const id = String(req.data?.institutionId || '');
  const inst = id ? (await db.doc(`orgs/${orgId}/institutions/${id}`).get()).data() : null;
  if (!inst) throw new HttpsError('not-found', 'Brand not found.');
  aiReady();
  const ps = await db.collection(`orgs/${orgId}/geoPrompts`).where('institutionId', '==', id).limit(5).get();
  if (ps.empty) throw new HttpsError('failed-precondition', 'Add at least one question to track first.');
  await useQuota(orgId, 'geoRuns', ps.size);
  const host = hostOf(inst.websiteUrl || ''), name = String(inst.name).toLowerCase(), runs = [];
  for (const p of ps.docs) {
    const q = p.data().prompt;
    try {
      const d = await claude({ prompt: q, max: 900,
        system: 'You are an AI search assistant. Answer concisely (under 150 words) and name specific brands or websites where relevant. After your answer, add one final line in exactly this format: BRANDS: name1 | name2 | name3 listing every brand, company or website you recommended or mentioned (at most 8), or BRANDS: none.',
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }] });
      let text = d.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      let brands = [];
      const bm = text.match(/\n?\s*BRANDS:\s*(.*)$/i);
      if (bm) { brands = bm[1].split('|').map((x) => x.trim()).filter((x) => x && !/^none$/i.test(x)).slice(0, 8); text = text.slice(0, bm.index).trim(); }
      const urls = d.content.filter((b) => b.type === 'web_search_tool_result').flatMap((b) => (Array.isArray(b.content) ? b.content.map((x) => x.url) : [])).filter(Boolean);
      const hosts = [...new Set(urls.map(hostOf).filter(Boolean))];
      const low = text.toLowerCase();
      runs.push({ prompt: q, mentioned: low.includes(name) || (!!host && low.includes(host)) || brands.some((x) => x.toLowerCase().includes(name)), cited: !!host && hosts.includes(host),
        brands, snippet: text.slice(0, 420), sources: hosts.slice(0, 8), at: Timestamp.now() });
    } catch (e) { runs.push({ prompt: q, error: String(e.message).slice(0, 120), at: Timestamp.now() }); }
  }
  const ref = db.doc(`orgs/${orgId}/metrics/geomon_${id}`);
  const prevDoc = (await ref.get()).data();
  const all = runs.concat(prevDoc?.runs || []).slice(0, 30);
  const ok = all.filter((r) => !r.error), pct = (f) => (ok.length ? Math.round((100 * ok.filter(f).length) / ok.length) : 0);
  // AI share of voice: how often each brand is named across the tracked answers, and which sites the AI cites
  const tally = new Map();
  for (const r of ok) for (const b of (r.brands || [])) { const key = b.toLowerCase(); const t = tally.get(key) || { name: b, mentions: 0 }; t.mentions++; tally.set(key, t); }
  const total = [...tally.values()].reduce((a, t) => a + t.mentions, 0);
  const comps = (inst.competitors || []).map((c) => String(c.name || '').toLowerCase()).filter(Boolean), stem = host ? host.split('.')[0] : '';
  const share = [...tally.values()].sort((a, b) => b.mentions - a.mentions).slice(0, 8).map((t) => { const low = t.name.toLowerCase(); return { name: t.name, mentions: t.mentions, pct: total ? Math.round((100 * t.mentions) / total) : 0, isYou: low.includes(name) || (!!stem && low.includes(stem)), isCompetitor: comps.some((c) => low.includes(c) || c.includes(low)) }; });
  const dom = new Map();
  for (const r of ok) for (const x of (r.sources || [])) dom.set(x, (dom.get(x) || 0) + 1);
  const sourceShare = [...dom.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([domain, count]) => ({ domain, count }));
  await ref.set({ institutionId: id, runs: all, visibility: pct((r) => r.mentioned), prevVisibility: prevDoc?.visibility ?? null, citedRate: pct((r) => r.cited), share, sourceShare, updatedAt: FieldValue.serverTimestamp() });
  return { runs: runs.length };
});

// Generates an AI-ready content kit: llms.txt, schema markup and answer-first snippets.
exports.geoAssets = onCall({ region: REGION, timeoutSeconds: 180, secrets: [ANTHROPIC_API_KEY] }, async (req) => {
  const orgId = await need(req, ['owner', 'admin', 'staff']);
  const id = String(req.data?.institutionId || '');
  const inst = id ? (await db.doc(`orgs/${orgId}/institutions/${id}`).get()).data() : null;
  if (!inst?.websiteUrl) throw new HttpsError('failed-precondition', 'Add a website URL to this brand first.');
  aiReady();
  let home;
  try { home = await safeFetch(inst.websiteUrl); } catch (e) { throw new HttpsError('failed-precondition', `Could not reach the website: ${e.message}`); }
  await useQuota(orgId, 'geoRuns', 2);
  const d = await claude({ max: 3500,
    system: 'You are a GEO (Generative Engine Optimization) specialist. Reply with one JSON object only. No markdown fences. Never invent facts.',
    prompt: `Brand: ${inst.name}\nWebsite: ${home.url}\nPage text:\n${stripHtml(home.html).slice(0, 7000)}\n\nReturn JSON with keys: llmsTxt (string: a valid /llms.txt in markdown with an H1 brand name, a one-line blockquote summary, then sections with links), orgJsonLd (object: schema.org Organization or LocalBusiness using only facts in the text), faqJsonLd (object: schema.org FAQPage with 5 questions customers really ask; answers 40 to 60 words from the text only), answerBlocks (array of 5 {question, answer} answer-first snippets of 40 to 60 words), tips (array of 5 short actions to become the source AI assistants cite). Do not invent addresses, prices or phone numbers.` });
  const raw = d.content.filter((b) => b.type === 'text').map((b) => b.text).join('').replace(/^```(?:json)?|```$/gm, '').trim();
  let out;
  try { out = JSON.parse(raw); } catch { throw new HttpsError('internal', 'The AI returned an unexpected format. Please try again.'); }
  await db.doc(`orgs/${orgId}/metrics/geoassets_${id}`).set({
    institutionId: id, llmsTxt: String(out.llmsTxt || ''), orgJsonLd: JSON.stringify(out.orgJsonLd || {}, null, 2),
    faqJsonLd: JSON.stringify(out.faqJsonLd || {}, null, 2), answerBlocks: (out.answerBlocks || []).slice(0, 5), tips: (out.tips || []).slice(0, 5),
    createdAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

// ---------- 7. Disconnect a provider (and optionally delete its synced data) ----------
exports.disconnectProvider = onCall({ region: REGION }, async (req) => {
  const orgId = await need(req, ['owner', 'admin']);
  const p = req.data?.provider;
  if (!['meta', 'google', 'gbp'].includes(p)) throw new HttpsError('invalid-argument', 'Unknown provider.');
  await db.doc(`orgs/${orgId}/_secrets/${p}`).delete();
  await db.doc(`orgs/${orgId}/connections/${p}`).delete();
  if (req.data?.deleteData) {
    const prefixes = p === 'meta' ? ['meta_', 'ads_'] : p === 'gbp' ? ['gbp_'] : ['gsc_', 'ga_'];
    const snap = await db.collection(`orgs/${orgId}/metrics`).get();
    const batch = db.batch();
    snap.docs.filter((d) => prefixes.some((x) => d.id.startsWith(x))).forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (p === 'gbp') await db.recursiveDelete(db.collection(`orgs/${orgId}/reviews`));
  }
  return { ok: true };
});

// Shared helpers for ./insights.js (non-enumerable, so it is not treated as a deployable function)
Object.defineProperty(exports, '_lib', { enumerable: false, value: { need, useQuota, claude, aiReady, hostOf, safeFetch, geoScan, stripHtml, checkPage, graph, ANTHROPIC_API_KEY, APP_URL, api, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_TOKEN, SECRETS } });
