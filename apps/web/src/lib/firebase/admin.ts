import "server-only";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// Cloud access is limited to a separately approved, read-only staging rollout.
// The marker is a configuration gate, not proof of workload identity or IAM.
function stagingApp() {
  const projectId = "orbotriq-v2-staging";
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.ORBOTRIQ_STAGING_RUNTIME !== "approved-readonly" ||
    !process.env.K_SERVICE ||
    process.env.NEXT_PUBLIC_FIREBASE_MODE !== "staging" ||
    process.env.FIREBASE_PROJECT_ID !== projectId ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== projectId ||
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID !== "1:587902200294:web:698daec9d83ec460934e27" ||
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN !== `${projectId}.firebaseapp.com` ||
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID !== "587902200294" ||
    (process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_CLOUD_PROJECT !== projectId) ||
    (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId) ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== undefined ||
    process.env.FIRESTORE_EMULATOR_HOST !== undefined ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS !== undefined ||
    process.env.FIREBASE_CLIENT_EMAIL !== undefined ||
    process.env.FIREBASE_PRIVATE_KEY !== undefined ||
    process.env.CASHFREE_ENV !== "disabled" ||
    process.env.CASHFREE_APP_ID !== undefined ||
    process.env.CASHFREE_SECRET_KEY !== undefined
  ) {
    throw new Error("Firebase access disabled: approved staging runtime required.");
  }
  const credential = applicationDefault();
  const name = "orbotriq-staging-readonly";
  const existing = getApps().find(app => app.name === name);
  if (existing) {
    if (existing.options.projectId !== projectId || existing.options.credential !== credential) {
      throw new Error("Firebase app project or credential mismatch.");
    }
    return existing;
  }
  return initializeApp({ projectId, credential }, name);
}

function adminApp() {
  if (process.env.ORBOTRIQ_FIREBASE_MODE === "staging") return stagingApp();
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.ORBOTRIQ_FIREBASE_MODE !== "emulator" ||
    process.env.NEXT_PUBLIC_FIREBASE_MODE !== "emulator" ||
    projectId !== "demo-orbotriq-v2" ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== projectId ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099" ||
    process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8081"
  ) {
    throw new Error("Firebase access disabled: isolated emulator configuration required.");
  }
  const existing = getApps().find(app => app.name === "orbotriq-emulator");
  if (existing) {
    if (existing.options.projectId !== projectId) {
      throw new Error("Firebase app project mismatch.");
    }
    return existing;
  }
  return initializeApp({ projectId }, "orbotriq-emulator");
}

export const adminAuth = () => getAuth(adminApp());
export const adminDb = () => getFirestore(adminApp());
