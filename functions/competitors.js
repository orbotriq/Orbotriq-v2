// Competitor analysis: website SEO comparison and Instagram benchmark.
// Competitors live on the brand document: institutions/{id}.competitors = [{ name, url, ig, fb }]
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const L = require('./growth')._lib;

const db = getFirestore();
const REGION = 'asia-south1';
const STAFF = ['owner', 'admin', 'staff'];
const COOLDOWN_MS = 5 * 60 * 1000;
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const median = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

async function loadBrand(req) {
  const orgId = await L.need(req, STAFF);
  const id = String(req.data?.institutionId || '');
  const inst = id ? (await db.doc(`orgs/${orgId}/institutions/${id}`).get()).data() : null;
  if (!inst) throw new HttpsError('not-found', 'Brand not found.');
  return { orgId, id, inst };
}

async function cooldown(ref) {
  const prev = (await ref.get()).data();
  if (prev?.checkedAt && Date.now() - prev.checkedAt.toMillis() < COOLDOWN_MS) {
    throw new HttpsError('resource-exhausted', 'An analysis just ran. Try again in a few minutes.');
  }
}

// Keeps the last 26 snapshots per brand (about six months of weekly runs). A rerun within 6 hours replaces the last snapshot.
async function addHistory(orgId, id, kind, snap) {
  const ref = db.doc(`orgs/${orgId}/metrics/cmphist_${id}`);
  const arr = [...(((await ref.get()).data() || {})[kind] || [])];
  if (arr.length && snap.t - arr[arr.length - 1].t < 6 * 3600e3) arr[arr.length - 1] = snap; else arr.push(snap);
  await ref.set({ institutionId: id, [kind]: arr.slice(-26), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

// ---------- 1. Website SEO comparison (homepage of each site, same rules for everyone) ----------
async function profileSite(url) {
  const home = await L.safeFetch(url);
  const origin = new URL(home.url).origin, html = home.html || '';
  const chk = L.checkPage(html);
  const exists = async (f) => { try { return (await L.safeFetch(`${origin}/${f}`)).status < 400; } catch { return false; } };
  const robots = await exists('robots.txt'), sitemap = await exists('sitemap.xml'), llms = await exists('llms.txt');

  const metaTag = html.match(/<meta[^>]+name=["']description["'][^>]*>/i);
  const descLen = metaTag ? ((metaTag[0].match(/content=["']([^"']*)["']/i) || [])[1] || '').length : 0;
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  const noAlt = imgs.filter((i) => !/\balt=["'][^"']+["']/i.test(i)).length;
  const schema = [...new Set([...html.matchAll(/"@type"\s*:\s*"([A-Za-z]+)"/g)].map((m) => m[1]))].slice(0, 8);
  const text = L.stripHtml(html);

  const site = [];
  if (!home.url.startsWith('https://')) site.push('high');
  if (home.status >= 400) site.push('high');
  if (home.ms > 2500) site.push('medium');
  if (!robots) site.push('medium');
  if (!sitemap) site.push('medium');
  const weight = { high: 10, medium: 5, low: 2 };
  const score = Math.max(0, 100 - site.concat(chk.issues.map((i) => i.sev)).reduce((a, s) => a + weight[s], 0));

  return {
    url: home.url, score, ms: home.ms, https: home.url.startsWith('https://'), robots, sitemap, llms,
    titleLen: chk.title.length, descLen, h1: (html.match(/<h1[\s>]/gi) || []).length,
    canonical: /<link[^>]+rel=["']canonical["']/i.test(html), og: /property=["']og:title["']/i.test(html),
    images: imgs.length, noAlt, schema, words: text ? text.split(' ').length : 0, issues: chk.issues.length,
  };
}

function seoGaps(you, others) {
  const out = [], n = others.length, c = (fn) => others.filter(fn).length;
  if (!n) return out;
  const say = (k, msg) => { if (k > 0) out.push(msg(k)); };
  if (!you.schema.length) say(c((o) => o.schema.length), (k) => `${k} of ${n} competitors publish structured data (schema). Your homepage has none.`);
  if (!you.sitemap) say(c((o) => o.sitemap), (k) => `${k} of ${n} competitors have a sitemap.xml. Yours is missing.`);
  if (!you.llms) say(c((o) => o.llms), (k) => `${k} of ${n} competitors publish an llms.txt guide for AI assistants. You do not.`);
  if (!you.canonical) say(c((o) => o.canonical), (k) => `${k} of ${n} competitors set a canonical link. Yours is missing.`);
  if (!you.og) say(c((o) => o.og), (k) => `${k} of ${n} competitors have Open Graph tags for social sharing. You do not.`);
  if (you.descLen < 70 || you.descLen > 160) say(c((o) => o.descLen >= 70 && o.descLen <= 160), (k) => `${k} of ${n} competitors have a meta description of a good length. Yours ${you.descLen ? `is ${you.descLen} characters (aim for 70 to 160)` : 'is missing'}.`);
  if (you.h1 !== 1) say(c((o) => o.h1 === 1), (k) => `${k} of ${n} competitors use exactly one H1. Your homepage has ${you.h1}.`);
  const mw = median(others.map((o) => o.words));
  if (mw && you.words < mw * 0.7) out.push(`Competitor homepages carry about ${mw} words of content (median). Yours has ${you.words}.`);
  const fastest = Math.min(...others.map((o) => o.ms));
  if (you.ms > 800 && you.ms > fastest * 2) out.push(`Your homepage responded in ${you.ms} ms. The fastest competitor responded in ${fastest} ms.`);
  const better = others.filter((o) => o.score > you.score);
  if (better.length) out.unshift(`${better.length} of ${n} competitors score higher than you on this homepage check (${better.map((o) => `${o.name} ${o.score}`).join(', ')}).`);
  return out.slice(0, 10);
}

async function runSeo(orgId, id, inst, useCooldown) {
  if (!inst.websiteUrl) throw new HttpsError('failed-precondition', 'Add a website to this brand first (Brands > Edit).');
  const comps = (inst.competitors || []).filter((c) => c.url).slice(0, 5);
  if (!comps.length) throw new HttpsError('failed-precondition', 'Add at least one competitor with a website address first.');
  const ref = db.doc(`orgs/${orgId}/metrics/cmpseo_${id}`);
  if (useCooldown) await cooldown(ref);

  let you;
  try { you = { name: inst.name, you: true, ...(await profileSite(inst.websiteUrl)) }; }
  catch (e) { throw new HttpsError('failed-precondition', `Could not reach your website: ${e.message}`); }

  const items = [];
  for (const c of comps) {
    try { items.push({ name: c.name || L.hostOf(c.url), ...(await profileSite(c.url)) }); }
    catch (e) { items.push({ name: c.name || c.url, url: c.url, error: String(e.message).slice(0, 120) }); }
  }
  const ok = items.filter((i) => !i.error);
  await ref.set({ institutionId: id, you, items, gaps: seoGaps(you, ok), checkedAt: FieldValue.serverTimestamp() });
  await addHistory(orgId, id, 'seo', { t: Date.now(), you: you.score, c: Object.fromEntries(ok.map((i) => [i.name, i.score])) });
  return { checked: items.length, failed: items.length - ok.length };
}
exports.competitorSeo = onCall({ region: REGION, timeoutSeconds: 300 }, async (req) => {
  const { orgId, id, inst } = await loadBrand(req);
  return runSeo(orgId, id, inst, true);
});

// ---------- 2. Instagram benchmark (Instagram Business Discovery) ----------
const cleanHandle = (v) => String(v || '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
const MEDIA = 'media.limit(12){like_count,comments_count,timestamp,media_type}';

function igStats(u) {
  const media = u.media?.data || [];
  const likes = media.map((m) => m.like_count).filter((x) => x != null), comments = media.map((m) => m.comments_count).filter((x) => x != null);
  const times = media.map((m) => Date.parse(m.timestamp)).filter((t) => !isNaN(t)).sort((a, b) => b - a);
  const span = times.length > 1 ? (times[0] - times[times.length - 1]) / 864e5 : 0;
  const followers = u.followers_count ?? null, al = avg(likes), ac = avg(comments);
  return {
    handle: u.username, followers, mediaCount: u.media_count ?? null, sample: media.length,
    avgLikes: al == null ? null : Math.round(al), avgComments: ac == null ? null : Math.round(ac),
    engagementRate: followers && (al != null || ac != null) ? r1((((al || 0) + (ac || 0)) / followers) * 100) : null,
    postsPerWeek: span > 0 ? r1(((media.length - 1) / span) * 7) : null,
    posts30: times.filter((t) => Date.now() - t < 30 * 864e5).length,
    lastPost: times[0] ? new Date(times[0]).toISOString() : null,
  };
}

const igError = (e) => {
  const m = String(e.message || '');
  if (/does not exist|Invalid user id|not a (business|creator)|cannot be found|\(#110\)|\(#24\)/i.test(m)) return 'Not found. Check the handle. Only Business or Creator accounts can be analysed.';
  if (/permission|#10|#200|OAuth/i.test(m)) return 'Meta did not allow this lookup. Reconnect Meta in Connections and try again.';
  return m.slice(0, 120);
};

async function runSocial(orgId, id, inst, useCooldown) {
  const comps = (inst.competitors || []).filter((c) => c.ig || c.fb).slice(0, 5);
  if (!comps.length) throw new HttpsError('failed-precondition', 'Add at least one competitor with an Instagram handle first.');
  const s = (await db.doc(`orgs/${orgId}/_secrets/meta`).get()).data();
  const pages = (s?.pages || []).filter((p) => p.ig);
  if (!pages.length) throw new HttpsError('failed-precondition', 'Connect Meta in Connections, with a Facebook page that is linked to an Instagram Business account.');
  const page = pages.find((p) => String(p.name || '').toLowerCase().includes(String(inst.name || '').toLowerCase())) || pages[0];
  const ref = db.doc(`orgs/${orgId}/metrics/cmpsoc_${id}`);
  if (useCooldown) await cooldown(ref);

  const g = L.graph();
  let you;
  try {
    const u = await L.api(`${g}/${page.ig}?` + new URLSearchParams({ fields: `username,followers_count,media_count,${MEDIA}`, access_token: page.token }));
    you = { name: inst.name, you: true, ...igStats(u) };
  } catch (e) { throw new HttpsError('failed-precondition', `Could not read your own Instagram account: ${igError(e)}`); }

  const items = [];
  for (const c of comps) {
    const item = { name: c.name || c.ig || c.fb };
    const handle = cleanHandle(c.ig);
    if (handle) {
      if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) item.error = 'That does not look like a valid Instagram handle.';
      else {
        try {
          const r = await L.api(`${g}/${page.ig}?` + new URLSearchParams({ fields: `business_discovery.username(${handle}){username,followers_count,media_count,${MEDIA}}`, access_token: page.token }));
          Object.assign(item, igStats(r.business_discovery || {}));
        } catch (e) { item.handle = handle; item.error = igError(e); }
      }
    }
    if (c.fb) {
      // Public Facebook page numbers need Meta's "Page Public Content Access" approval. Tried as a best effort only.
      item.fbUrl = c.fb;
      const slug = String(c.fb).replace(/^https?:\/\/(www\.|m\.)?facebook\.com\//i, '').split(/[/?#]/)[0];
      try {
        const f = await L.api(`${g}/${encodeURIComponent(slug)}?` + new URLSearchParams({ fields: 'name,fan_count,followers_count', access_token: page.token }));
        item.fbFollowers = f.followers_count ?? f.fan_count ?? null;
      } catch { item.fbNote = 'Facebook page numbers need Meta’s Page Public Content Access approval.'; }
    }
    items.push(item);
  }
  await ref.set({ institutionId: id, you, items, checkedAt: FieldValue.serverTimestamp() });
  const pt = (x) => ({ f: x.followers ?? null, e: x.engagementRate ?? null, p: x.postsPerWeek ?? null });
  await addHistory(orgId, id, 'social', { t: Date.now(), you: pt(you), c: Object.fromEntries(items.filter((i) => !i.error && i.followers != null).map((i) => [i.name, pt(i)])) });
  return { checked: items.length };
}
exports.competitorSocial = onCall({ region: REGION, timeoutSeconds: 180 }, async (req) => {
  const { orgId, id, inst } = await loadBrand(req);
  return runSocial(orgId, id, inst, true);
});

// ---------- 3. Weekly automatic update ----------
// Runs daily, but only brands whose last automatic update is older than about a week are processed.
// Anything left over when the time budget is used up is picked up the next day.
exports.weeklyCompetitors = onSchedule({ region: REGION, schedule: 'every day 06:30', timeZone: 'Asia/Kolkata', timeoutSeconds: 540 }, async () => {
  const t0 = Date.now(), DUE = 6.5 * 864e5, due = [];
  const orgs = await db.collection('orgs').where('status', 'in', ['trialing', 'active']).get();
  for (const o of orgs.docs) {
    if (o.data().isDemo) continue;
    const insts = await o.ref.collection('institutions').get();
    for (const b of insts.docs) {
      const d = b.data(), last = d.competitorLastRun?.toMillis?.() || 0;
      if (d.competitorAuto === false || !(d.competitors || []).length || Date.now() - last < DUE) continue;
      due.push({ orgId: o.id, id: b.id, inst: d, last });
    }
  }
  due.sort((a, b) => a.last - b.last);
  for (const j of due) {
    if (Date.now() - t0 > 470000) break;
    const cs = j.inst.competitors || [];
    if (j.inst.websiteUrl && cs.some((c) => c.url)) await runSeo(j.orgId, j.id, j.inst, false).catch((e) => console.warn('weekly seo', j.id, e.message));
    if (cs.some((c) => c.ig)) await runSocial(j.orgId, j.id, j.inst, false).catch((e) => console.warn('weekly social', j.id, e.message));
    await db.doc(`orgs/${j.orgId}/institutions/${j.id}`).update({ competitorLastRun: FieldValue.serverTimestamp() }).catch(() => {});
  }
});
