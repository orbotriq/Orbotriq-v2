// Promo posts: AI-written marketing posts for Orbotriq itself, reviewed in the super admin console and
// published through the same scheduler that clients use (Facebook Page and linked Instagram account).
// LinkedIn and X copy is generated too, but those are posted by hand (no publishing connection exists).
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');

const db = getFirestore();
const REGION = 'asia-south1';
const SETTINGS = 'platform/promo', POSTS = 'platform/promo/posts';
const SECRETS = ['ANTHROPIC_API_KEY'];

// Branded 1080x1080 cards in web/promo/cards. The model picks one per post (Instagram needs an image).
const CARDS = {
  brand: ['01-brand.jpg', 'general brand awareness'], allinone: ['02-one-dashboard.jpg', 'one dashboard for every brand'],
  geo: ['03-ai-search.jpg', 'AI search visibility (GEO)'], social: ['04-social.jpg', 'Facebook and Instagram performance'],
  ads: ['05-ads.jpg', 'Meta ads control'], seo: ['06-seo.jpg', 'SEO audits, Search Console and keywords'],
  agency: ['07-agency.jpg', 'agencies and multi-brand teams'], publish: ['08-publish.jpg', 'scheduling posts'], demo: ['09-demo.jpg', 'book a demo'],
};
const PILLARS = ['problem', 'feature', 'geo', 'tip', 'audience', 'demo'];

const DEFAULT_BRIEF = `Product: Orbotriq. Tagline: Growth, in orbit.
Pitch: One control tower for every brand you grow: social, ads, SEO, analytics and AI search visibility, with a separate workspace for each client.
Built for: Digital marketing agencies and freelancers, Franchises and multi-location businesses, Education groups and institutions, In-house marketing teams managing several brands.
What it does today:
- Social command center: Facebook and Instagram performance for every client page in one view.
- Ads control: Meta ad spend, results and campaign control by client.
- SEO workbench: Audits, Search Console data and a daily keyword tracker.
- Analytics: Google Analytics users, sessions and channels matched to each brand.
- GEO for AI search: Audit AI readiness, track AI mentions and generate AI-ready content.
- Publishing: Schedule Facebook and Instagram posts for any connected page.
Plans (prices exclude GST): Starter ₹2,999 / month (1 brand); Growth ₹7,999 / month (5 brands); Agency ₹19,999 / month (15 brands); Enterprise Custom (Custom).
How it works: we set up the client's workspace, plan and logins; the client connects Meta and Google from its own dashboard; data syncs every night; the team then acts on it.
Trust: every client gets a separate workspace; access tokens stay on the server; role-based access; clients can disconnect any time; aligned with India's DPDP Act.
Call to action: invite people to book a demo on the website. There is no self-serve free trial, so never promise one.
NOT available yet (never present as available): client report portal, AI growth copilot, competitor share of voice, LinkedIn/YouTube/Google Business Profile/WhatsApp channels, smart alerts, team seats.`;

const needAdmin = (req) => {
  if (!req.auth || req.auth.token.platformAdmin !== true) throw new HttpsError('permission-denied', 'Super admin only.');
};
const baseUrl = () => String(process.env.APP_URL || 'https://orbotriq.in').replace(/\/+$/, '');
const aiKey = () => { const k = process.env.ANTHROPIC_API_KEY; return k && k !== 'placeholder' ? k : null; };
const trim = (v, n) => String(v ?? '').trim().slice(0, n);

// ---------- scheduling slots (IST) ----------
const DAYS = { 3: [1, 3, 5], 5: [1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6] }; // Mon/Wed/Fri, weekdays, daily
function nextSlots(n, afterMs, perWeek = 3, hhmm = '19:00') {
  const days = DAYS[perWeek] || DAYS[3];
  const [H, M] = /^\d{2}:\d{2}$/.test(hhmm) ? hhmm.split(':').map(Number) : [19, 0];
  const ist = new Date(Date.now() + 5.5 * 3600e3), y = ist.getUTCFullYear(), mo = ist.getUTCMonth(), da = ist.getUTCDate();
  const out = [];
  for (let k = 0; out.length < n && k < 60; k++) {
    if (!days.includes(new Date(Date.UTC(y, mo, da + k)).getUTCDay())) continue;
    const ms = Date.UTC(y, mo, da + k, H, M) - 5.5 * 3600e3;
    if (ms > Math.max(afterMs, Date.now()) + 10 * 60e3 && ms < Date.now() + 29 * 864e5) out.push(ms);
  }
  return out;
}

// ---------- AI ----------
function parseJsonArray(text) {
  const s = String(text || ''), a = s.indexOf('['), b = s.lastIndexOf(']');
  if (a < 0 || b < a) throw new Error('The AI reply was not in the expected format. Please try again.');
  return JSON.parse(s.slice(a, b + 1));
}

async function generateDrafts(count, cfg) {
  const key = aiKey();
  if (!key) throw new HttpsError('failed-precondition', 'The AI key is not set. Run: firebase functions:secrets:set ANTHROPIC_API_KEY');
  const recent = (await db.collection(POSTS).orderBy('createdAt', 'desc').limit(20).get()).docs.map((d) => trim(d.data().caption, 90));
  const pillars = Array.from({ length: count }, (_, i) => PILLARS[(Math.floor(Math.random() * PILLARS.length) + i) % PILLARS.length]);
  const system = `You are the social media manager for Orbotriq, a software product. Write promotional posts that sound like a smart human, in clear Indian English.
Rules:
- Use ONLY the facts in the brief. Never invent customers, testimonials, statistics, awards, discounts or features. Never present "not available yet" items as available.
- No self-serve free trial exists. The call to action is to book a demo.
- Each post: a strong first line, one idea, plain words, no jargon pile-ups, at most 2 emojis.
- Do not repeat the openings of recent posts.
Return ONLY a JSON array, no other text.`;
  const prompt = `BRIEF\n${cfg.brief || DEFAULT_BRIEF}\n\nRECENT POST OPENINGS (do not repeat):\n${recent.join('\n') || '(none yet)'}\n\nWrite ${count} posts, one for each pillar in this order: ${pillars.join(', ')}.
Pillars: problem = a pain agencies or multi-brand teams feel; feature = spotlight one module and its benefit; geo = teach something useful about being found in AI answers (ChatGPT, Gemini, Perplexity); tip = a practical marketing tip tied to a module; audience = speak to one audience group; demo = invite people to book a demo.
Each item: {"pillar": string, "card": one of ${Object.keys(CARDS).join('|')} (${Object.entries(CARDS).map(([k, v]) => k + '=' + v[1]).join('; ')}),
"caption": Facebook/Instagram caption, 300 to 700 characters, include the exact text {LINK} once on its own line near the end, then 4 to 6 hashtags on the last line,
"linkedin": LinkedIn version, 500 to 1100 characters, more professional, include {LINK} once, no hashtags beyond 3,
"x": X post, at most 230 characters, include {LINK} once, at most 2 hashtags}`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.AI_MODEL || 'claude-haiku-5-5', max_tokens: 6000, system, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(110000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpsError('internal', d.error?.message || `AI request failed (${r.status})`);
  let items;
  try { items = parseJsonArray((d.content || []).map((c) => c.text || '').join('')); } catch (e) { throw new HttpsError('internal', e.message); }

  const out = [];
  for (const it of items.slice(0, count)) {
    const caption = trim(it.caption, 1500), linkedin = trim(it.linkedin, 2500), x = trim(it.x, 280);
    if (caption.length < 80 || !caption.includes('{LINK}')) continue; // skip malformed items
    const card = CARDS[it.card] ? it.card : 'brand';
    const ref = db.collection(POSTS).doc();
    const doc = { pillar: PILLARS.includes(it.pillar) ? it.pillar : 'feature', card, caption, linkedin, x, status: 'draft', source: 'ai', createdAt: FieldValue.serverTimestamp() };
    await ref.set(doc); out.push(ref.id);
  }
  if (!out.length) throw new HttpsError('internal', 'The AI did not return usable posts. Please try again.');
  return out;
}

// Final text with a tracked link (the {LINK} placeholder is replaced when the post is queued).
const withLink = (txt, id, medium) => String(txt).replaceAll('{LINK}', `${baseUrl()}/?utm_source=${medium}&utm_medium=social&utm_campaign=promo&utm_content=${id}`);

// Queue drafts on the chosen workspace's page, using the normal scheduler (publishDue).
async function scheduleDrafts(cfg, docs, times) {
  if (!cfg.orgId || !cfg.pageId) throw new HttpsError('failed-precondition', 'Choose the workspace and Facebook Page under Settings first.');
  const s = (await db.doc(`orgs/${cfg.orgId}/_secrets/meta`).get()).data();
  const page = s?.pages?.find((p) => p.id === String(cfg.pageId));
  if (!page) throw new HttpsError('not-found', 'That Page is not connected in the chosen workspace. Connect Meta there first.');
  const igOn = !!cfg.instagram && !!page.ig;
  let n = 0;
  for (let i = 0; i < docs.length && i < times.length; i++) {
    const d = docs[i], p = d.data();
    if (p.status !== 'draft') continue;
    const imageUrl = `${baseUrl()}/promo/cards/${CARDS[p.card]?.[0] || CARDS.brand[0]}`;
    const ref = await db.collection(`orgs/${cfg.orgId}/scheduledPosts`).add({
      pageId: page.id, pageName: page.name, message: withLink(p.caption, d.id, 'facebook'), imageUrl, toInstagram: igOn,
      scheduledFor: Timestamp.fromMillis(times[i]), status: 'scheduled', promoId: d.id, createdBy: 'promo', createdAt: FieldValue.serverTimestamp(),
    });
    await d.ref.update({ status: 'scheduled', scheduledFor: Timestamp.fromMillis(times[i]), postRef: ref.id, imageUrl });
    n++;
  }
  return n;
}

async function lastScheduledMs() {
  const q = await db.collection(POSTS).where('status', '==', 'scheduled').get();
  return q.docs.reduce((m, d) => Math.max(m, d.data().scheduledFor?.toMillis?.() || 0), 0);
}

// ---------- callables ----------
exports.promoPages = onCall({ region: REGION }, async (req) => {
  needAdmin(req);
  const orgId = trim(req.data?.orgId, 64);
  if (!orgId || orgId.includes('/')) throw new HttpsError('invalid-argument', 'Choose a workspace.');
  const s = (await db.doc(`orgs/${orgId}/_secrets/meta`).get()).data();
  return { pages: (s?.pages || []).map((p) => ({ id: p.id, name: p.name, ig: !!p.ig })) };
});
exports.promoGenerate = onCall({ region: REGION, timeoutSeconds: 150, secrets: SECRETS }, async (req) => {
  needAdmin(req);
  const count = Math.min(14, Math.max(1, Math.round(Number(req.data?.count) || 7)));
  const cfg = (await db.doc(SETTINGS).get()).data() || {};
  const ids = await generateDrafts(count, cfg);
  return { ok: true, created: ids.length };
});

exports.promoSchedule = onCall({ region: REGION }, async (req) => {
  needAdmin(req);
  const d = req.data || {};
  const cfg = (await db.doc(SETTINGS).get()).data() || {};
  let docs;
  if (Array.isArray(d.ids) && d.ids.length) {
    docs = (await Promise.all(d.ids.slice(0, 30).map((id) => db.collection(POSTS).doc(String(id)).get()))).filter((s) => s.exists);
  } else {
    docs = (await db.collection(POSTS).where('status', '==', 'draft').get()).docs.sort((a, b) => (a.data().createdAt?.toMillis?.() || 0) - (b.data().createdAt?.toMillis?.() || 0)).slice(0, 30);
  }
  if (!docs.length) throw new HttpsError('failed-precondition', 'There are no drafts to schedule.');
  let times;
  if (d.when) {
    const t = new Date(d.when).getTime();
    if (docs.length !== 1 || isNaN(t) || t < Date.now() + 5 * 60e3 || t > Date.now() + 29 * 864e5) throw new HttpsError('invalid-argument', 'Pick a time between 5 minutes and 29 days from now.');
    times = [t];
  } else {
    times = nextSlots(docs.length, await lastScheduledMs(), Number(cfg.perWeek) || 3, cfg.time || '19:00');
    if (!times.length) throw new HttpsError('failed-precondition', 'No free time slots in the next 29 days.');
  }
  const n = await scheduleDrafts(cfg, docs, times);
  return { ok: true, scheduled: n, firstAt: times[0], leftover: Math.max(0, docs.length - times.length) };
});

// Every morning (IST): keep the queue stocked. Drafts wait for approval unless auto-approve is on.
exports.promoAutopilot = onSchedule({ region: REGION, schedule: 'every day 09:00', timeZone: 'Asia/Kolkata', timeoutSeconds: 300, secrets: SECRETS }, async () => {
  const ref = db.doc(SETTINGS), cfg = (await ref.get()).data() || {};
  if (!cfg.enabled) return;
  try {
    const open = (await db.collection(POSTS).where('status', 'in', ['draft', 'scheduled']).get()).docs
      .filter((d) => d.data().status === 'draft' || (d.data().scheduledFor?.toMillis?.() || 0) > Date.now());
    if (open.length < 4) await generateDrafts(7, cfg);
    let scheduled = 0;
    if (cfg.autoApprove) {
      const drafts = (await db.collection(POSTS).where('status', '==', 'draft').get()).docs.slice(0, 14);
      const times = nextSlots(drafts.length, await lastScheduledMs(), Number(cfg.perWeek) || 3, cfg.time || '19:00');
      if (drafts.length && times.length) scheduled = await scheduleDrafts(cfg, drafts, times);
    }
    await ref.set({ lastRun: { at: FieldValue.serverTimestamp(), ok: true, scheduled } }, { merge: true });
  } catch (e) {
    console.error('promoAutopilot failed', e.message);
    await ref.set({ lastRun: { at: FieldValue.serverTimestamp(), ok: false, error: String(e.message).slice(0, 200) } }, { merge: true });
  }
});

