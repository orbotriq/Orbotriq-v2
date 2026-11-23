const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();
const REGION = 'asia-south1'; // Mumbai

// Starting limits for the free trial. Later, read these from plans/{planId}.
const TRIAL = { institutions: 2, days: 14 };

// ---------------------------------------------------------------
// createOrg: runs right after signup. Creates the tenant, the owner
// member and the login claims (orgId, role).
// ---------------------------------------------------------------
exports.createOrg = onCall({ region: REGION }, async (req) => {
  if (!req.auth) {
    throw new HttpsError('unauthenticated', 'Sign in first.');
  }
  const uid = req.auth.uid;
  const email = req.auth.token.email || '';
  const st = (await db.doc('site/settings').get()).data();
  if (st?.allowSignup !== true) throw new HttpsError('permission-denied', 'New sign-ups are by invitation. Please contact us to get your login.');
  const orgName = String(req.data?.orgName || '').trim();

  if (orgName.length < 2 || orgName.length > 80) {
    throw new HttpsError('invalid-argument', 'Organisation name must be 2-80 characters.');
  }

  const userRef = db.doc(`users/${uid}`);
  const orgRef = db.collection('orgs').doc();
  const trialEndsAt = Timestamp.fromMillis(Date.now() + TRIAL.days * 24 * 60 * 60 * 1000);

  await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (userSnap.exists && userSnap.data().orgId) {
      throw new HttpsError('already-exists', 'This user already belongs to an organisation.');
    }

    tx.set(orgRef, {
      name: orgName,
      ownerUid: uid,
      plan: 'trial',
      status: 'trialing',
      trialEndsAt,
      limits: { institutions: TRIAL.institutions, geoRuns: 5 },
      usage: {},
      institutionCount: 0,
      logoUrl: '',
      brandColor: '#1a73e8',
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.set(orgRef.collection('members').doc(uid), {
      email,
      role: 'owner',
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.set(userRef, {
      email,
      displayName: req.auth.token.name || '',
      orgId: orgRef.id,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    tx.set(orgRef.collection('auditLogs').doc(), {
      action: 'org.created',
      by: uid,
      at: FieldValue.serverTimestamp(),
    });
  });

  // Claims are read by the Firestore security rules.
  const me = await getAuth().getUser(uid);
  await getAuth().setCustomUserClaims(uid, { ...(me.customClaims || {}), orgId: orgRef.id, role: 'owner' });

  return { orgId: orgRef.id };
});

// ---------------------------------------------------------------
// addInstitution: adds a website / social-account group to the org
// and enforces the plan limit (rules alone cannot count documents).
// ---------------------------------------------------------------
exports.addInstitution = onCall({ region: REGION }, async (req) => {
  if (!req.auth) {
    throw new HttpsError('unauthenticated', 'Sign in first.');
  }
  const { orgId, role } = req.auth.token;
  if (!orgId || !['owner', 'admin'].includes(role)) {
    throw new HttpsError('permission-denied', 'Only owners and admins can add brands.');
  }

  const name = String(req.data?.name || '').trim();
  const websiteUrl = String(req.data?.websiteUrl || '').trim();
  if (name.length < 2 || name.length > 100) {
    throw new HttpsError('invalid-argument', 'Brand name must be 2-100 characters.');
  }
  if (websiteUrl && !/^https?:\/\/[^\s]+$/i.test(websiteUrl)) {
    throw new HttpsError('invalid-argument', 'Website must start with http:// or https://');
  }

  const orgRef = db.doc(`orgs/${orgId}`);
  const instRef = orgRef.collection('institutions').doc();

  await db.runTransaction(async (tx) => {
    const org = (await tx.get(orgRef)).data();
    if (!org) throw new HttpsError('not-found', 'Organisation not found.');
    if (!['trialing', 'active', 'demo'].includes(org.status)) {
      throw new HttpsError('failed-precondition', 'Your subscription is not active.');
    }
    if (org.institutionCount >= org.limits.institutions) {
      throw new HttpsError('resource-exhausted', 'Plan limit reached. Upgrade to add more brands.');
    }
    tx.set(instRef, {
      name,
      websiteUrl,
      createdBy: req.auth.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(orgRef, { institutionCount: FieldValue.increment(1) });
  });

  return { institutionId: instRef.id };
});

// Connections, sync, keyword ranks and SEO audit
Object.assign(exports, require("./growth"));
Object.assign(exports, require("./admin"));
Object.assign(exports, require("./billing"));
Object.assign(exports, require("./promo"));
Object.assign(exports, require("./insights"));
Object.assign(exports, require("./local"));
Object.assign(exports, require("./competitors"));
