import "server-only";
import {
  cert,
  getApps,
  initializeApp,
  applicationDefault,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function adminApp() {
  const mode = process.env.ORBOTRIQ_FIREBASE_MODE;
  const projectId = process.env.FIREBASE_PROJECT_ID;

  if (mode === "emulator") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Emulator mode is forbidden in production.");
    }

    if (
      projectId !== "demo-orbotriq-v2" ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== projectId ||
      process.env.NEXT_PUBLIC_FIREBASE_MODE !== "emulator" ||
      process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099" ||
      process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8081"
    ) {
      throw new Error("Unsafe Firebase emulator configuration.");
    }

    const existing = getApps().find(
      app => app.name === "orbotriq-emulator"
    );

    if (existing) return existing;

    return initializeApp(
      { projectId },
      "orbotriq-emulator"
    );
  }

  if (
    process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.NEXT_PUBLIC_FIREBASE_MODE === "emulator" ||
    projectId?.startsWith("demo-")
  ) {
    throw new Error("Unexpected emulator configuration.");
  }

  if (process.env.NODE_ENV === "development") {
    throw new Error(
      "Local development must use the isolated Firebase emulator."
    );
  }

  const existing = getApps().find(
    app => app.name === "[DEFAULT]"
  );

  if (existing) return existing;

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey =
    process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (projectId && clientEmail && privateKey) {
    return initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }

  return initializeApp({
    credential: applicationDefault(),
    projectId,
  });
}

export const adminAuth = () => getAuth(adminApp());
export const adminDb = () => getFirestore(adminApp());
