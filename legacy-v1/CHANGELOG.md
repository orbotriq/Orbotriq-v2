# Orbotriq changelog

Newest first. The short version history is also in web/version.json.

## 1.4.0: Client report redesign and menu fix (23 November 2026)
- Shared report page redesigned: branded banner with the report period, dark section bands, KPI cards with daily trend bars, keyword ranking tiles, sessions by country, top pages, health score rings and a cleaner print or PDF layout. Your logo, brand colour and white-label setting still apply.
- New reports also store daily series, countries, top pages and ranking counts. Reports made before this version keep their old content and simply show fewer panels. Create a new report to get the full layout.
- Desktop side menu now scrolls on short screens, so the lower items (Billing, Help) are always reachable.
- Changed: functions/insights.js, web/report/index.html, web/assets/shell.css, web/version.json
- Deploy: firebase deploy --only functions,hosting. Press Sync now, then create a new report.

---

## 1.3.0: Overview redesign (22 November 2026)
- New Overview layout: score cards, four channel cards (Web, Search, Social, Ads) with trend lines, a performance chart with metric (sessions, search clicks, impressions) and range (7, 14, 28 days) toggles, an insights readout written from your own numbers, keyword ranking tiles (top 3, 10, 20, 100), an AI share-of-voice ranking, and a website section with engagement, sessions by country and top pages.
- Sync now also stores: ranking buckets and top pages (Search Console), average visit duration and sessions by country (Analytics). Existing data is kept.
- Changed: functions/growth.js, web/app/index.html, web/version.json
- Deploy: firebase deploy --only functions,hosting, then press Sync now. New panels fill in after that sync.

---

## 1.2.2: Clearer traffic chart messages (22 November 2026)
- The Overview traffic chart now says why it is empty (Google not connected, no matching site, press Sync now, or no data recorded yet). Only web/app/index.html and web/version.json changed. Deploy with: firebase deploy --only hosting

---

## 1.2.1: Dashboard intelligence (22 November 2026)

What changed
- Overview: greeting, 28-day website traffic chart (Google Analytics sessions, or Search Console clicks if Analytics is not connected), trend arrows on the SEO and GEO averages, priority-ranked action list.
- SEO and GEO: click any issue or check to see why it matters, how to fix it and a copy-ready snippet. SEO shows all issues with one click. Score history graphs appear after the second audit.
- Keyword tracker: position change arrows and a position trend graph (history builds up from the next sync).
- Header: a "Synced ... ago" indicator next to Sync now.

Files changed
- functions/growth.js (stores score history, daily traffic series and keyword position history; existing data is kept)
- web/app/index.html, web/version.json

Deploy
    firebase deploy --only functions,hosting

Notes
- Traffic charts and trends fill in after the next sync (press Sync now). Score history needs at least two audits.
- No new secrets, APIs or permissions are needed.

---

## 1.2.0: Local and reviews, Google Business Profile (17 November 2026)

Copy these files over your project (same folder paths), then deploy:

    cd functions
    npm install
    cd ..
    firebase deploy --only firestore:rules,functions,hosting

New: functions/local.js, web/assets/local.js
Changed: functions (growth.js, insights.js, admin.js, index.js), firestore.rules, web (app, report page, index.html, manual.md, privacy.md, version.json), documents.

Before clients can use it, Google must approve Business Profile API access (see README, Local and reviews).
