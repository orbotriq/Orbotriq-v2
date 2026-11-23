# Orbotriq platform

Multi-brand growth platform: social, Meta ads, SEO, Google Analytics, GEO (AI search visibility), post scheduling,
a super admin console, demo logins and a public website. Firebase project: `vaanio-app` (functions in Mumbai, asia-south1).

## Live domain
The platform is live at **https://orbotriq.in** (client app `/app/`, super admin `/admin/`). Keep these in step with the domain:
- Firebase console > Authentication > Settings > **Authorized domains**: `orbotriq.in` (and `www.orbotriq.in` if used) must be listed.
- `APP_URL` = `https://orbotriq.in` (functions parameter; set in `functions/.env.vaanio-app`, then `firebase deploy --only functions`).
- Meta and Google OAuth redirect URL: `https://orbotriq.in/oauth/callback`.

## Advanced intelligence (v1.1.0)
New modules: **Growth Copilot**, **Smart alerts**, **Client reports** (share links, weekly reports, white-label), **Competitor benchmark and AI share of voice**.
- Deploy everything changed: `firebase deploy --only firestore:rules,functions,hosting`
- They use the same AI key and monthly AI-check allowance as GEO (`ANTHROPIC_API_KEY`).
- Alert and report **emails** need the Firebase extension **Trigger Email from Firestore** (collection `mail`, your SMTP details). Without it, alerts and report links still appear in the dashboard.
- Schedules (India time): alerts daily 08:30, weekly reports Monday 08:00. They run on the daily data sync that already exists.
- Public report links live at `https://orbotriq.in/report/?t=...` (private random token, can be revoked, `noindex`).

## Local and reviews (v1.2.0)
Google Business Profile: locations, reviews inbox with AI-drafted replies, review links, local performance and Google posts.
- Enable these APIs in Google Cloud: My Business Account Management, My Business Business Information, Google My Business, Business Profile Performance.
- Apply for **Business Profile API access** (quota is 0 until Google approves) and add the `business.manage` scope to the OAuth consent screen.
- Deploy: `firebase deploy --only firestore:rules,functions,hosting`

## What is in this folder
| Folder / file | Purpose |
|---|---|
| `web/` | Everything hosted: public site (`index.html`), client app (`app/`), super admin console (`admin/`), privacy / terms / manual pages, brand logos, downloads |
| `functions/` | Cloud Functions (Node 22): signup, brands, OAuth, daily sync, SEO and GEO audits, AI visibility, scheduler, super admin, GST invoicing, AI promo posts, billing sweep |
| `firestore.rules`, `firestore.indexes.json` | Database security rules and the one required index |
| `docs-src/` | Single source for the deck, booklet and manual (`content.json`, `admin-guide.md`, screenshots) |
| `tools/` | `build_docs.js` (regenerates every document), `make_brand.py` (regenerates the logos) |
| `docs-private/` | Internal Super Admin Guide (not deployed) |

## First-time deployment (about 20 minutes)
1. **Firebase console, project vaanio-app**
   - Upgrade to the **Blaze** plan and set a budget alert.
   - Authentication > Sign-in method: enable **Email/Password** (clients) and **Google** (your admin login).
   - Firestore Database: create it in **asia-south1 (Mumbai)**, production mode.
2. **Install and deploy** (Windows Command Prompt, Node 20 or newer, `npm i -g firebase-tools`, `firebase login`):
   ```
   cd functions
   npm install
   cd ..
   firebase deploy --only firestore,functions,hosting
   ```
   When asked for settings, use: `APP_URL` = `https://orbotriq.in`, `META_APP_ID` = `placeholder`,
   `GOOGLE_CLIENT_ID` = `placeholder`, press Enter for the rest. For the secrets `META_APP_SECRET`,
   `GOOGLE_CLIENT_SECRET` and `ANTHROPIC_API_KEY` type `placeholder` for now. If an API is still enabling, wait 3 minutes and run deploy again.
3. **Open the console:** `https://orbotriq.in/admin/`, enter `vaanioapp@gmail.com` and a new password, press **Create admin account**, click the verification link sent to that Gmail inbox, then press **I have verified my email**. (Later, just sign in with email and password. Google sign-in also works.)
   The first sign-in makes the account super admin. No other account is accepted.
4. In the console: **Plans** > Add default plans (then set your prices) > **Demo logins** > create a demo > **Website & legal**
   (check contact details, decide on self sign-up) > **Organisations** > New organisation for your first client.

## Switching on live data (Meta, Google, AI)
- **Meta:** developers.facebook.com > create a Business app > add Facebook Login > valid redirect URL
  `https://orbotriq.in/oauth/callback`. Request the permissions listed in the Super Admin Guide (app review needed for public use; testers can connect before approval).
- **Google:** console.cloud.google.com (project vaanio-app) > APIs: enable Search Console, Analytics Admin, Analytics Data >
  OAuth client (Web) with the same redirect URL > complete the consent screen and verification.
- **AI (GEO checks and content kits):** create an Anthropic API key.
- Then store the real values and redeploy functions:
  ```
  firebase functions:secrets:set META_APP_SECRET
  firebase functions:secrets:set GOOGLE_CLIENT_SECRET
  firebase functions:secrets:set ANTHROPIC_API_KEY
  firebase deploy --only functions
  ```
  Change `META_APP_ID` / `GOOGLE_CLIENT_ID` by editing `functions/.env.vaanio-app` (created on first deploy) or redeploying and answering the prompts.

## Keeping documents up to date
- **Instantly (no deploy):** Admin console > Website & legal. Edit the website text, FAQ, contact details, Privacy Policy, Terms and User Manual and press Publish.
- **Deck, booklet, manual, PDFs:** edit `docs-src/content.json` and the files in `web/content/`, add a line to `web/version.json`, then
  ```
  cd tools
  npm install
  node build_docs.js
  cd ..
  firebase deploy --only hosting
  ```
  (PDFs need LibreOffice installed; otherwise export from Word or PowerPoint.) You can also ask your assistant to update and regenerate everything.

## Custom domain
Hosting > Add custom domain, then update `APP_URL`, the Meta and Google redirect URLs, `web/sitemap.xml`, `web/robots.txt`, `web/llms.txt`,
the canonical details in `web/index.html`, and `docs-src/content.json` (web address). Rebuild the documents.

## Before charging customers
- Replace `[Registered business name]` in `web/content/privacy.md` and `terms.md` and have a lawyer review both. They are well-formed templates, not legal advice.
- Search Orbotriq in the IP India trademark database (Classes 9, 35, 42), and check domains and social handles.
- Get a written ownership agreement with PPG if any code originated there.
- Complete Meta app review and Google verification, then test the full flow with a real client account.
