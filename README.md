# Orbotriq v2 — Next.js + Firebase

This repository is the v2 migration workspace for the existing Orbotriq v1.4.3 application.

## Decisions
- Next.js App Router + TypeScript
- Firebase project: `vaanio-app`
- Firestore/Auth/Storage/Cloud Functions retained as the backend foundation
- Hosting target: Firebase App Hosting (backend must be provisioned in Firebase Console)
- Payment providers planned: Razorpay + Stripe
- Existing customer and organisation data: preserve; no destructive migration is included

## Important status
This is the initial application foundation, not a completed production migration. Dashboard routes are scaffolds. Existing Cloud Functions and Firestore rules are preserved under `functions/` and `legacy-v1/` for audit and compatibility work. No live data is fabricated.

## Requirements
- Node.js 22+
- npm 10+
- Firebase CLI
- Access to Firebase project `vaanio-app`

## Local development
```bash
npm install
cp apps/web/.env.example apps/web/.env.local
# Fill Firebase web-app config and configure ADC for Firebase Admin.
npm run dev
```
Open http://localhost:3000.

## Build checks
```bash
npm run typecheck
npm run build
```

## Firebase App Hosting
1. In Firebase Console, provision an App Hosting backend and connect this repository/branch. Configure the monorepo app root as `apps/web`.
2. Set runtime/build environment variables in App Hosting.
3. Configure Firebase Auth authorized domains and OAuth redirect URIs.
4. Deploy to a staging backend first.
5. Verify Firestore rules, claims, indexes, Cloud Functions and all integrations before production cutover.

`firebase.json` retains the current Firestore rules/indexes and Cloud Functions source. Its Hosting section is a static Hosting fallback configuration; use App Hosting for this Next.js server-rendered app. Do not deploy the static Hosting target as a substitute for App Hosting.

## Data preservation policy
- Do not clear, rename or recreate production Firestore collections.
- Do not alter custom claims (`orgId`, `role`, `platformAdmin`) until compatibility has been tested.
- Use read-only staging verification and backups before any schema changes.
- Migrate by additive fields/collections and dual-read where necessary.
- Never run production migration scripts without a verified export and rollback plan.

## Payments
Razorpay and Stripe are planned integrations, not yet implemented. Use server-side order/session creation, signed webhook verification, idempotency keys and Firestore transaction-based subscription updates. Store provider secrets in Secret Manager / Firebase Functions secrets only.

## Next implementation milestones
1. Full source and Firestore schema inventory.
2. Authentication/session and tenant authorization.
3. Module-by-module frontend migration.
4. CRM/projects/team data model.
5. Razorpay + Stripe integration.
6. Admin console and audit controls.
7. Automated tests, staging and controlled production cutover.
