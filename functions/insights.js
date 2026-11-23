// Advanced features: AI growth copilot, smart alerts, client reports with share links, competitor GEO benchmark.
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const CA = require('./competitorAlerts');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const crypto = require('crypto');
const L = require('./growth')._lib;

const db = getFirestore();
const REGION = 'asia-south1';
const AI = [L.ANTHROPIC_API_KEY];
const STAFF = ['owner', 'admin', 'staff'];
const sevRank = { high: 0, medium: 1, low: 2 };
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pctChange = (now, before) => (before ? Math.round(((now - before) / before) * 1000) / 10 : null);
const dayKey = () => new Date().toISOString().slice(0, 10);
const weekKey = () => { const d = new Date(), y = d.getUTCFullYear(), n = Math.ceil(((d - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7); return `${y}-W${n}`; };
const monthKey = () => new Date().toISOString().slice(0, 7);
const textOf = (d) => d.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();

// ---------- Data snapshot of one organisation ----------
async function load(orgId) {
  const base = db.doc(`orgs/${orgId}`);
  const [org, insts, mets, kws, conns, revs] = await Promise.all([base.get(), base.collection('institutions').get(), base.collection('metrics').get(), base.collection('seoKeywords').get(), base.collection('connections').get(), base.collection('reviews').limit(400).get()]);
  const M = {}; mets.forEach((d) => { M[d.id] = d.data(); });
  return { id: orgId, org: org.data() || {}, insts: insts.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    M, kws: kws.docs.map((d) => ({ id: d.id, ...d.data() })), reviews: revs.docs.map((d) => ({ id: d.id, ...d.data() })), conns: Object.fromEntries(conns.docs.map((d) => [d.id, d.data()])) };
}
function issuesOf(a) {
  return a ? [...(a.site || []).map((i) => ({ ...i, where: 'Site' })), ...(a.pages || []).flatMap((p) => p.issues.map((i) => ({ ...i, where: p.url })))].sort((x, y) => sevRank[x.sev] - sevRank[y.sev]) : [];
}
// Google Business Profile summary for one brand (its mapped locations)
function localFacts(s, b) {
  const ids = b.gbpLocations || [], locs = ids.map((id) => s.M['gbp_' + id]).filter(Boolean);
  if (!locs.length) return null;
  const revs = (s.reviews || []).filter((r) => ids.includes(r.locationId)), total = locs.reduce((a, l) => a + (l.totalReviews || 0), 0);
  const avg = total ? locs.reduce((a, l) => a + (l.avgRating || 0) * (l.totalReviews || 0), 0) / total : null;
  const sum = (k) => locs.reduce((a, l) => a + (l.last28?.[k] || 0), 0), prevSum = (k) => locs.reduce((a, l) => a + (l.prev28?.[k] || 0), 0);
  return { locations: locs.length, avgRating: avg ? Math.round(avg * 10) / 10 : null, totalReviews: total, unreplied: revs.filter((r) => !r.reply).length, lowUnreplied: revs.filter((r) => !r.reply && r.rating <= 3).length,
    impressions28: sum('impressions'), calls28: sum('calls'), websiteClicks28: sum('website'), directions28: sum('directions'), callsPrev: prevSum('calls'), directionsPrev: prevSum('directions') };
}
function brandFacts(s, b) {
  const a = s.M['audit_' + b.id], g = s.M['gsc_' + b.id], ga = s.M['ga_' + b.id], geo = s.M['geo_' + b.id], mon = s.M['geomon_' + b.id], comp = s.M['geocomp_' + b.id];
  return {
    brand: b.name, website: b.websiteUrl || null,
    seo: a ? { score: a.score, previousScore: a.prevScore ?? null, topIssues: issuesOf(a).slice(0, 8).map((i) => `${i.sev}: ${i.msg}`) } : null,
    search: g?.status === 'ok' ? { clicks28d: g.clicks, previousWeekClicks: g.prevClicks ?? null, impressions28d: g.impressions, topQueries: (g.topQueries || []).slice(0, 8).map((q) => ({ query: q.query, clicks: q.clicks, position: q.position })) } : null,
    traffic: ga ? { users: ga.users, sessions: ga.sessions, engagementPct: ga.engagementRate, channels: (ga.channels || []).slice(0, 5) } : null,
    keywords: s.kws.filter((k) => k.institutionId === b.id).slice(0, 15).map((k) => ({ keyword: k.keyword, position: k.position, previous: k.prevPosition ?? null })),
    geo: geo ? { score: geo.score, previousScore: geo.prevScore ?? null, failing: geo.checks.filter((c) => c.status !== 'pass').map((c) => `${c.label}: ${c.tip}`).slice(0, 6), blockedAiCrawlers: (geo.bots || []).filter((x) => x.access === 'blocked').map((x) => x.bot) } : null,
    aiVisibility: mon ? { mentionedPct: mon.visibility, citedPct: mon.citedRate, shareOfVoice: (mon.share || []).slice(0, 6).map((x) => `${x.name} ${x.pct}%${x.isYou ? ' (this brand)' : ''}`) } : null,
    competitorGeoScores: comp ? (comp.items || []).map((c) => ({ name: c.name, score: c.score ?? null })) : null,
    googleBusinessProfile: localFacts(s, b),
  };
}
function orgFacts(s) {
  const pages = Object.entries(s.M).filter(([k]) => k.startsWith('meta_')).map(([, p]) => ({ page: p.name, followers: p.followers ?? p.fans, reach28d: p.reach28, views28d: p.views28, instagram: p.ig ? { followers: p.ig.followers, reach: p.ig.reach } : null }));
  const ads = Object.entries(s.M).filter(([k]) => k.startsWith('ads_')).map(([, a]) => ({ account: a.name, currency: a.currency, spend30d: a.spend, clicks: a.clicks, ctrPct: a.ctr, campaigns: (a.campaigns || []).map((c) => ({ name: c.name, status: c.status, spend: c.spend, clicks: c.clicks })) }));
  return { socialPages: pages, adAccounts: ads };
}

// ---------- 1. AI growth copilot ----------
const COPILOT_SYSTEM = `You are Orbotriq Growth Copilot, a senior digital marketing strategist for agencies and Indian businesses.
Answer ONLY from the DATA provided. Never invent numbers. If something needed is missing, say what to connect or run in Orbotriq.
Format in markdown: a short direct answer first, then "## Priorities" (a numbered list; each item gives the reason with numbers from DATA and where to act in Orbotriq), then "## Quick wins this week" (bullets).
Keep it under 350 words, in plain language, without hype.`;

exports.copilotAsk = onCall({ region: REGION, timeoutSeconds: 120, secrets: AI }, async (req) => {
  const orgId = await L.need(req, STAFF);
  const q = String(req.data?.question || '').trim();
  if (q.length < 5 || q.length > 600) throw new HttpsError('invalid-argument', 'Ask a question between 5 and 600 characters.');
  L.aiReady();
  const s = await load(orgId);
  const instId = String(req.data?.institutionId || '');
  const brands = instId ? s.insts.filter((b) => b.id === instId) : s.insts.slice(0, 8);
  if (instId && !brands.length) throw new HttpsError('not-found', 'Brand not found.');
  await L.useQuota(orgId, 'geoRuns', 1);
  const facts = { today: dayKey(), organisation: s.org.name, brands: brands.map((b) => brandFacts(s, b)), ...orgFacts(s) };
  const d = await L.claude({ max: 1100, system: COPILOT_SYSTEM, prompt: `DATA (JSON from the latest sync):\n${JSON.stringify(facts).slice(0, 14000)}\n\nQUESTION: ${q}` });
  const answer = textOf(d);
  if (!answer) throw new HttpsError('internal', 'The copilot did not return an answer. Please try again.');
  const ref = await db.collection(`orgs/${orgId}/copilot`).add({ question: q, answer, institutionId: instId, by: req.auth.uid, createdAt: FieldValue.serverTimestamp() });
  return { id: ref.id };
});

// ---------- 2. Smart alerts ----------
const ALERT_DEFAULTS = { rankDrop: 3, clicksDrop: 25, visibilityDrop: 20, scoreDrop: 10, wasteSpend: 1000, adSpendLimit: 0, email: false, emails: [] };

function computeAlerts(s, cfg) {
  const out = [], wk = weekKey(), dk = dayKey(), name = (id) => s.insts.find((b) => b.id === id)?.name || 'Brand';
  const push = (a) => out.push({ severity: 'warning', institutionId: '', ...a });
  for (const k of s.kws) {
    if (k.position == null || k.prevPosition == null) continue;
    if (k.position - k.prevPosition >= cfg.rankDrop) push({ type: 'rank_drop', key: `kw:${k.id}:${Math.floor(k.position)}`, severity: k.prevPosition <= 10 ? 'critical' : 'warning', institutionId: k.institutionId, title: `Ranking dropped for “${k.keyword}”`, detail: `${name(k.institutionId)}: from #${k.prevPosition} to #${k.position}.` });
    else if (k.position <= 10 && k.prevPosition > 10) push({ type: 'rank_win', key: `win:${k.id}:${Math.floor(k.position)}`, severity: 'good', institutionId: k.institutionId, title: `“${k.keyword}” reached page one`, detail: `${name(k.institutionId)}: now #${k.position} (was #${k.prevPosition}).` });
  }
  for (const b of s.insts) {
    const g = s.M['gsc_' + b.id], a = s.M['audit_' + b.id], geo = s.M['geo_' + b.id], mon = s.M['geomon_' + b.id];
    if (g?.status === 'ok' && g.prevClicks >= 100 && g.clicks <= g.prevClicks * (1 - cfg.clicksDrop / 100)) push({ type: 'clicks_drop', key: `clicks:${b.id}:${wk}`, severity: 'critical', institutionId: b.id, title: `Search clicks fell ${Math.abs(pctChange(g.clicks, g.prevClicks))}%`, detail: `${b.name}: ${g.clicks} clicks in the last 28 days vs ${g.prevClicks} a week earlier.` });
    if (a?.prevScore != null && a.score <= a.prevScore - cfg.scoreDrop) push({ type: 'seo_drop', key: `seo:${b.id}:${a.score}`, institutionId: b.id, title: 'SEO score dropped', detail: `${b.name}: ${a.prevScore} to ${a.score}. Open SEO & Analytics to see what changed.` });
    if (geo?.prevScore != null && geo.score <= geo.prevScore - cfg.scoreDrop) push({ type: 'geo_drop', key: `geo:${b.id}:${geo.score}`, institutionId: b.id, title: 'GEO score dropped', detail: `${b.name}: ${geo.prevScore} to ${geo.score}. Check the GEO checklist.` });
    if (mon?.prevVisibility != null && mon.visibility <= mon.prevVisibility - cfg.visibilityDrop) push({ type: 'visibility_drop', key: `vis:${b.id}:${mon.visibility}`, severity: 'critical', institutionId: b.id, title: 'AI visibility fell', detail: `${b.name}: mentioned in ${mon.visibility}% of tracked AI answers (was ${mon.prevVisibility}%).` });
    const blocked = (geo?.bots || []).filter((x) => x.access === 'blocked').length;
    if (blocked >= 2) push({ type: 'ai_blocked', key: `bots:${b.id}:${blocked}`, institutionId: b.id, title: 'AI crawlers are blocked', detail: `${b.name}: ${blocked} AI crawlers cannot read the site, so AI assistants may not cite it.` });
    for (const a of CA.fromHistory(b, s.M['cmphist_' + b.id])) push(a);
  }
  const brandOf = (locId) => s.insts.find((b) => (b.gbpLocations || []).includes(locId));
  for (const r of s.reviews || []) {
    if (!r.reply && r.rating >= 1 && r.rating <= 2 && Date.now() - r.createMs < 14 * 864e5) push({ type: 'review_low', key: `rev:${r.id}`, severity: 'critical', institutionId: brandOf(r.locationId)?.id || '', title: `${r.rating}-star Google review needs a reply`, detail: `${r.locationTitle}: “${String(r.comment || '(no text)').slice(0, 110)}”` });
  }
  const backlog = (s.reviews || []).filter((r) => !r.reply && Date.now() - r.createMs > 3 * 864e5);
  if (backlog.length >= 5) push({ type: 'review_backlog', key: `revlog:${wk}`, title: `${backlog.length} Google reviews are waiting for a reply`, detail: 'Replying promptly builds trust and supports your local ranking. Open Local & Reviews.' });
  for (const [k, l] of Object.entries(s.M)) if (k.startsWith('gbp_') && l.prevAvgRating != null && l.avgRating != null && l.avgRating <= l.prevAvgRating - 0.2) push({ type: 'rating_drop', key: `rating:${k}:${l.avgRating}`, institutionId: brandOf(l.locationId)?.id || '', title: 'Google rating dropped', detail: `${l.title}: ${l.prevAvgRating.toFixed(1)} to ${l.avgRating.toFixed(1)} stars.` });
  let spendTotal = 0;
  for (const [k, a] of Object.entries(s.M)) {
    if (!k.startsWith('ads_')) continue;
    spendTotal += Number(a.spend) || 0;
    for (const c of a.campaigns || []) if (c.status === 'ACTIVE' && c.spend >= cfg.wasteSpend && c.clicks === 0) push({ type: 'ad_waste', key: `waste:${c.id}:${monthKey()}`, severity: 'critical', title: 'Campaign spending with no clicks', detail: `“${c.name}” has spent ${a.currency} ${Math.round(c.spend)} with zero clicks. Pause or fix it.` });
    if (a.impressions >= 20000 && a.ctr < 0.8) push({ type: 'low_ctr', key: `ctr:${k}:${monthKey()}`, title: 'Low ad click-through rate', detail: `${a.name}: CTR ${Number(a.ctr).toFixed(2)}% over ${Number(a.impressions).toLocaleString('en-IN')} impressions. Refresh creatives or targeting.` });
  }
  if (cfg.adSpendLimit > 0 && spendTotal >= cfg.adSpendLimit) push({ type: 'ad_budget', key: `budget:${monthKey()}`, severity: 'critical', title: 'Ad spend limit reached', detail: `Spend over the last 30 days is ${Math.round(spendTotal)}, above your limit of ${cfg.adSpendLimit}.` });
  for (const [p, c] of Object.entries(s.conns)) if (c.status === 'expired') push({ type: 'connection', key: `conn:${p}:${wk}`, severity: 'critical', title: `${p === 'meta' ? 'Meta' : 'Google'} connection needs attention`, detail: 'Access expired or was removed. Open Connections and press Reconnect so data keeps syncing.' });
  const end = (s.org.plan === 'trial' ? s.org.trialEndsAt : s.org.paidUntil)?.toMillis?.();
  if (end && ['trialing', 'active'].includes(s.org.status) && end - Date.now() < 7 * 864e5) push({ type: 'subscription', key: `sub:${dk.slice(0, 7)}:${Math.floor(end / 864e5)}`, title: 'Subscription ends soon', detail: `Your plan ends on ${new Date(end).toLocaleDateString('en-IN')}. Contact Orbotriq to renew.` });
  return out;
}

async function sendMail(to, subject, html, text) {
  if (to && to.length) await db.collection('mail').add({ to, message: { subject, html, text } }); // delivered by the Firebase "Trigger Email" extension when installed
}

async function runAlerts(orgId) {
  const s = await load(orgId);
  const cfg = { ...ALERT_DEFAULTS, ...((await db.doc(`orgs/${orgId}/settings/alerts`).get()).data() || {}) };
  const list = computeAlerts(s, cfg), fresh = [];
  for (const a of list) {
    const id = crypto.createHash('sha1').update(a.key).digest('hex').slice(0, 24);
    try { await db.doc(`orgs/${orgId}/alerts/${id}`).create({ type: a.type, severity: a.severity, title: a.title, detail: a.detail, institutionId: a.institutionId, read: false, createdAt: FieldValue.serverTimestamp() }); fresh.push(a); }
    catch (e) { if (!(e.code === 6 || /ALREADY_EXISTS/.test(String(e.message)))) console.error('alert', e.message); }
  }
  const important = fresh.filter((a) => a.severity !== 'good');
  if (cfg.email && important.length) {
    const rows = important.map((a) => `<li><b>${esc(a.title)}</b><br>${esc(a.detail)}</li>`).join('');
    await sendMail(cfg.emails, `Orbotriq: ${important.length} new alert(s) for ${s.org.name}`, `<p>New alerts for <b>${esc(s.org.name)}</b>:</p><ul>${rows}</ul><p><a href="${L.APP_URL.value()}/app/">Open your dashboard</a></p>`, important.map((a) => `${a.title}: ${a.detail}`).join('\n'));
  }
  return fresh.length;
}

exports.dailyAlerts = onSchedule({ region: REGION, schedule: 'every day 08:30', timeZone: 'Asia/Kolkata', timeoutSeconds: 540 }, async () => {
  const snap = await db.collection('orgs').where('status', 'in', ['trialing', 'active']).get();
  for (const o of snap.docs) { try { await runAlerts(o.id); } catch (e) { console.error('alerts failed', o.id, e.message); } }
});
exports.checkAlertsNow = onCall({ region: REGION, timeoutSeconds: 120 }, async (req) => {
  const orgId = await L.need(req, ['owner', 'admin']);
  return { created: await runAlerts(orgId) };
});

// ---------- 3. Client reports ----------
function reportFacts(s, b) {
  const a = s.M['audit_' + b.id], g = s.M['gsc_' + b.id], ga = s.M['ga_' + b.id], geo = s.M['geo_' + b.id], mon = s.M['geomon_' + b.id], comp = s.M['geocomp_' + b.id];
  const kws = s.kws.filter((k) => k.institutionId === b.id && k.position != null).sort((x, y) => x.position - y.position).slice(0, 10).map((k) => ({ keyword: k.keyword, position: k.position, previous: k.prevPosition ?? null, clicks: k.clicks || 0 }));
  const issues = issuesOf(a).slice(0, 6), failing = (geo?.checks || []).filter((c) => c.status !== 'pass').slice(0, 6), local = localFacts(s, b);
  const kpis = { clicks: g?.status === 'ok' ? g.clicks : null, clicksChangePct: g?.status === 'ok' && g.prevClicks ? pctChange(g.clicks, g.prevClicks) : null, impressions: g?.status === 'ok' ? g.impressions : null,
    users: ga?.users ?? null, sessions: ga?.sessions ?? null, engagementRate: ga?.engagementRate ?? null, seoScore: a?.score ?? null, seoPrev: a?.prevScore ?? null, geoScore: geo?.score ?? null, geoPrev: geo?.prevScore ?? null, aiVisibility: mon?.visibility ?? null, aiPrev: mon?.prevVisibility ?? null };
  const wins = [], actions = [];
  const upKw = kws.filter((k) => k.previous != null && k.position < k.previous - 1).length, top3 = kws.filter((k) => k.position <= 3).length;
  if (top3) wins.push(`${top3} tracked keyword(s) rank in the top 3.`);
  if (upKw) wins.push(`${upKw} keyword(s) improved their ranking.`);
  if (kpis.clicksChangePct != null && kpis.clicksChangePct >= 10) wins.push(`Search clicks grew ${kpis.clicksChangePct}% compared with last week.`);
  if (kpis.seoPrev != null && kpis.seoScore > kpis.seoPrev) wins.push(`SEO score improved from ${kpis.seoPrev} to ${kpis.seoScore}.`);
  if (kpis.geoPrev != null && kpis.geoScore > kpis.geoPrev) wins.push(`GEO score improved from ${kpis.geoPrev} to ${kpis.geoScore}.`);
  if (kpis.aiVisibility != null && kpis.aiPrev != null && kpis.aiVisibility > kpis.aiPrev) wins.push(`AI visibility rose to ${kpis.aiVisibility}%.`);
  issues.filter((i) => i.sev === 'high').slice(0, 3).forEach((i) => actions.push(`Fix: ${i.msg} (${i.where.replace(/^https?:\/\/[^/]+/, '') || 'site'}).`));
  failing.slice(0, 3).forEach((c) => actions.push(`AI readiness: ${c.tip}`));
  if (kpis.aiVisibility != null && kpis.aiVisibility < 50) actions.push('Publish answer-first FAQ content so AI assistants can cite the brand.');
  kws.filter((k) => k.previous != null && k.position - k.previous >= 3).slice(0, 2).forEach((k) => actions.push(`Recover the ranking for “${k.keyword}” (now #${k.position}).`));
  if (local?.avgRating >= 4.5 && local.totalReviews >= 10) wins.push(`Strong Google rating of ${local.avgRating} from ${local.totalReviews} reviews.`);
  if (local && local.callsPrev && local.calls28 > local.callsPrev) wins.push(`Calls from Google Business Profile grew from ${local.callsPrev} to ${local.calls28}.`);
  if (local?.lowUnreplied) actions.push(`Reply to ${local.lowUnreplied} Google review(s) rated 3 stars or below.`);
  else if (local?.unreplied >= 3) actions.push(`Reply to ${local.unreplied} unanswered Google reviews.`);
  const ca = CA.factsForReport(s.M, b.id);
  if (ca.seo) {
    const best = Math.max(...ca.seo.items.map((i) => i.score)), top = ca.seo.items.find((i) => i.score === best);
    if (ca.seo.you > best) wins.push(`The homepage scores higher on the SEO check than all ${ca.seo.items.length} tracked competitor(s).`);
    else if (best >= ca.seo.you + 10) actions.push(`${top.name} scores ${best} on the homepage SEO check against ${ca.seo.you} for this site. Work through the gaps in the competitor comparison.`);
  }
  if (!wins.length) wins.push('Tracking is in place. Wins will appear as scores and rankings improve.');
  const gaD = (ga?.daily || []).map((p) => ({ d: String(p.d).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'), v: p.v })), gsD = g?.daily || [];
  const series = { sessions: gaD, clicks: gsD.map((p) => ({ d: p.d, v: p.c })), impressions: gsD.map((p) => ({ d: p.d, v: p.i || 0 })) };
  const web = { avgDuration: ga?.avgDuration ?? null, countries: (ga?.countries || []).slice(0, 6), topPages: (g?.topPages || []).slice(0, 6), buckets: g?.buckets ?? null, prevBuckets: g?.prevBuckets ?? null };
  return { series, web, kpis, keywords: kws, queries: (g?.topQueries || []).slice(0, 8), issues: issues.map((i) => ({ sev: i.sev, msg: i.msg })), geoFailing: failing.map((c) => ({ label: c.label, tip: c.tip })),
    channels: (ga?.channels || []).slice(0, 5), share: (mon?.share || []).slice(0, 6), sources: (mon?.sourceShare || []).slice(0, 6),
    competitors: comp?.items ? comp.items.map((c) => ({ name: c.name, score: c.score ?? null })) : [], local, wins, actions: actions.slice(0, 6), competitorAnalysis: ca };
}
async function makeReport(s, b, by, useAi) {
  const f = reportFacts(s, b);
  const social = Object.entries(s.M).filter(([k]) => k.startsWith('meta_')).map(([, p]) => ({ name: p.name, followers: p.followers ?? p.fans ?? null, reach28: p.reach28 ?? null, views28: p.views28 ?? null, ig: p.ig ? { username: p.ig.username, followers: p.ig.followers, reach: p.ig.reach } : null }));
  const ads = Object.entries(s.M).filter(([k]) => k.startsWith('ads_')).map(([, a]) => ({ name: a.name, currency: a.currency, spend: a.spend, clicks: a.clicks, impressions: a.impressions, ctr: a.ctr }));
  let summary = '';
  if (useAi) {
    try {
      L.aiReady(); await L.useQuota(s.id, 'geoRuns', 1);
      const d = await L.claude({ max: 350, system: 'You write the opening summary of a monthly marketing report for a business owner. Plain English, positive but honest, no jargon, 80 to 110 words, one paragraph. Use only the numbers provided.',
        prompt: `Brand: ${b.name}\nPeriod: last 28 days\nData: ${JSON.stringify({ kpis: f.kpis, wins: f.wins, actions: f.actions })}` });
      summary = textOf(d);
    } catch (e) { console.warn('report summary skipped:', e.message); }
  }
  if (!summary) {
    const k = f.kpis, bits = [];
    if (k.clicks != null) bits.push(`${k.clicks.toLocaleString('en-IN')} clicks from Google search${k.clicksChangePct != null ? ` (${k.clicksChangePct >= 0 ? '+' : ''}${k.clicksChangePct}% vs last week)` : ''}`);
    if (k.users != null) bits.push(`${k.users.toLocaleString('en-IN')} website visitors`);
    if (k.seoScore != null) bits.push(`an SEO score of ${k.seoScore}/100`);
    if (k.geoScore != null) bits.push(`an AI-readiness (GEO) score of ${k.geoScore}/100`);
    summary = bits.length ? `Over the last 28 days ${b.name} recorded ${bits.join(', ')}. ${f.wins[0]}` : `${b.name} has been added to Orbotriq. Data will appear after the first sync.`;
  }
  return { institutionId: b.id, brandName: b.name, website: b.websiteUrl || '', period: 'Last 28 days', generatedAt: new Date().toISOString(), ...f, summary, social, ads, by, createdAt: FieldValue.serverTimestamp() };
}

exports.createReport = onCall({ region: REGION, timeoutSeconds: 120, secrets: AI }, async (req) => {
  const orgId = await L.need(req, STAFF);
  const s = await load(orgId), b = s.insts.find((x) => x.id === String(req.data?.institutionId || ''));
  if (!b) throw new HttpsError('not-found', 'Choose a brand first.');
  const ref = await db.collection(`orgs/${orgId}/reports`).add(await makeReport(s, b, req.auth.uid, true));
  return { id: ref.id };
});
exports.shareReport = onCall({ region: REGION }, async (req) => {
  const orgId = await L.need(req, STAFF);
  const ref = db.doc(`orgs/${orgId}/reports/${String(req.data?.reportId || 'x')}`), r = (await ref.get()).data();
  if (!r) throw new HttpsError('not-found', 'Report not found.');
  if (req.data?.enable) {
    if (r.shareToken) return { token: r.shareToken };
    const token = crypto.randomBytes(24).toString('hex');
    await db.doc(`reportShares/${token}`).set({ orgId, reportId: ref.id, revoked: false, createdAt: FieldValue.serverTimestamp() });
    await ref.update({ shareToken: token });
    return { token };
  }
  if (r.shareToken) { await db.doc(`reportShares/${r.shareToken}`).update({ revoked: true }).catch(() => {}); await ref.update({ shareToken: FieldValue.delete() }); }
  return { token: null };
});
// Public: anyone with the secret link can read one report (no login needed).
exports.getSharedReport = onCall({ region: REGION, cors: true }, async (req) => {
  const token = String(req.data?.token || '');
  if (!/^[a-f0-9]{48}$/.test(token)) throw new HttpsError('invalid-argument', 'Invalid report link.');
  const share = (await db.doc(`reportShares/${token}`).get()).data();
  if (!share || share.revoked) throw new HttpsError('not-found', 'This report link is no longer available.');
  const [rep, org] = await Promise.all([db.doc(`orgs/${share.orgId}/reports/${share.reportId}`).get(), db.doc(`orgs/${share.orgId}`).get()]);
  if (!rep.exists) throw new HttpsError('not-found', 'This report is no longer available.');
  const { by, createdAt, shareToken, ...report } = rep.data(), o = org.data() || {};
  return { org: { name: o.name || '', logoUrl: o.logoUrl || '', brandColor: o.brandColor || '#22d3ee', whiteLabel: o.whiteLabel === true }, report };
});

exports.weeklyReports = onSchedule({ region: REGION, schedule: 'every monday 08:00', timeZone: 'Asia/Kolkata', timeoutSeconds: 540, secrets: AI }, async () => {
  const snap = await db.collection('orgs').where('status', 'in', ['trialing', 'active']).get();
  for (const o of snap.docs) {
    try {
      const cfg = (await db.doc(`orgs/${o.id}/settings/reports`).get()).data() || {};
      if (!cfg.weekly) continue;
      const s = await load(o.id), links = [];
      for (const b of s.insts.slice(0, 15)) {
        const ref = await db.collection(`orgs/${o.id}/reports`).add(await makeReport(s, b, 'auto', true));
        const token = crypto.randomBytes(24).toString('hex');
        await db.doc(`reportShares/${token}`).set({ orgId: o.id, reportId: ref.id, revoked: false, createdAt: FieldValue.serverTimestamp() });
        await ref.update({ shareToken: token });
        links.push({ name: b.name, url: `${L.APP_URL.value()}/report/?t=${token}` });
      }
      if (!links.length) continue;
      await db.collection(`orgs/${o.id}/alerts`).add({ type: 'report', severity: 'good', title: 'Weekly reports are ready', detail: `${links.length} client report(s) were created. Open Reports to share them.`, institutionId: '', read: false, createdAt: FieldValue.serverTimestamp() });
      if (cfg.emails?.length) await sendMail(cfg.emails, `Orbotriq weekly reports for ${s.org.name}`, `<p>Your weekly reports are ready:</p><ul>${links.map((l) => `<li><a href="${esc(l.url)}">${esc(l.name)}</a></li>`).join('')}</ul>`, links.map((l) => `${l.name}: ${l.url}`).join('\n'));
    } catch (e) { console.error('weekly report failed', o.id, e.message); }
  }
});

// ---------- 4. Competitor GEO benchmark ----------
exports.geoCompare = onCall({ region: REGION, timeoutSeconds: 300 }, async (req) => {
  const orgId = await L.need(req, STAFF);
  const id = String(req.data?.institutionId || '');
  const inst = id ? (await db.doc(`orgs/${orgId}/institutions/${id}`).get()).data() : null;
  if (!inst) throw new HttpsError('not-found', 'Brand not found.');
  const comps = (inst.competitors || []).filter((c) => c.url).slice(0, 5);
  if (!comps.length) throw new HttpsError('failed-precondition', 'Add at least one competitor with a website address first.');
  const ref = db.doc(`orgs/${orgId}/metrics/geocomp_${id}`), prev = (await ref.get()).data();
  if (prev?.checkedAt && Date.now() - prev.checkedAt.toMillis() < 5 * 60 * 1000) throw new HttpsError('resource-exhausted', 'A benchmark just ran. Try again in a few minutes.');
  const items = [];
  for (const c of comps) {
    try { const r = await L.geoScan(c.url); items.push({ name: c.name || L.hostOf(c.url), url: c.url, score: r.score }); }
    catch (e) { items.push({ name: c.name || c.url, url: c.url, score: null, error: String(e.message).slice(0, 100) }); }
  }
  await ref.set({ institutionId: id, items, checkedAt: FieldValue.serverTimestamp() });
  return { checked: items.length };
});

// Test hook (non-enumerable)
Object.defineProperty(exports, '_test', { enumerable: false, value: { computeAlerts, reportFacts, brandFacts, localFacts, ALERT_DEFAULTS, load, runAlerts, makeReport } });
