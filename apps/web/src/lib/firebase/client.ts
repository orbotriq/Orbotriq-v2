import {
  initializeApp,
  getApps,
  type FirebaseApp,
} from "firebase/app";

import {
  getAuth,
  connectAuthEmulator,
  type Auth,
} from "firebase/auth";

import {
  getFirestore,
  connectFirestoreEmulator,
  type Firestore,
} from "firebase/firestore";

const emulatorMode =
  process.env.NEXT_PUBLIC_FIREBASE_MODE === "emulator";

const stagingMode = process.env.NEXT_PUBLIC_FIREBASE_MODE === "staging";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

type EmulatorRegistry = {
  auth: WeakSet<Auth>;
  firestore: WeakSet<Firestore>;
};

const registryGlobal = globalThis as typeof globalThis & {
  __orbotriqEmulators?: EmulatorRegistry;
};

const registry =
  registryGlobal.__orbotriqEmulators ??
  (registryGlobal.__orbotriqEmulators = {
    auth: new WeakSet<Auth>(),
    firestore: new WeakSet<Firestore>(),
  });

export function getFirebaseApp(): FirebaseApp {
  const validStaging = stagingMode && process.env.NODE_ENV === "production" &&
    config.projectId === "orbotriq-v2-staging" &&
    config.authDomain === "orbotriq-v2-staging.firebaseapp.com" &&
    config.appId === "1:587902200294:web:698daec9d83ec460934e27" &&
    config.messagingSenderId === "587902200294" &&
    typeof config.apiKey === "string" && /^AIza[A-Za-z0-9_-]{35}$/.test(config.apiKey) &&
    (!config.storageBucket || config.storageBucket === "orbotriq-v2-staging.firebasestorage.app" || config.storageBucket === "orbotriq-v2-staging.appspot.com");
  if (!validStaging && (
    !emulatorMode ||
    process.env.NODE_ENV !== "development" ||
    config.projectId !== "demo-orbotriq-v2" ||
    config.apiKey !== "demo-api-key" ||
    config.authDomain !== "demo-orbotriq-v2.firebaseapp.com" ||
    config.appId !== "1:123456789:web:orbotriq-demo" ||
    config.storageBucket !== "demo-orbotriq-v2.appspot.com" ||
    config.messagingSenderId !== "123456789"
  )) {
    throw new Error("Firebase access disabled: isolated emulator configuration required.");
  }
  const name = stagingMode ? "orbotriq-staging-readonly" : "orbotriq-emulator";
  const existing = getApps().find(app => app.name === name);
  if (existing) {
    if (existing.options.projectId !== config.projectId ||
        existing.options.apiKey !== config.apiKey ||
        existing.options.appId !== config.appId ||
        existing.options.authDomain !== config.authDomain ||
        existing.options.storageBucket !== config.storageBucket ||
        existing.options.messagingSenderId !== config.messagingSenderId) {
      throw new Error("Firebase app configuration mismatch.");
    }
    return existing;
  }
  return initializeApp(config, name);
}

export function firebaseAuth(): Auth {
  const auth = getAuth(getFirebaseApp());

  if (emulatorMode && !registry.auth.has(auth)) {
    connectAuthEmulator(
      auth,
      "http://127.0.0.1:9099"
    );

    registry.auth.add(auth);
  }

  return auth;
}

export function firestore(): Firestore {
  if (stagingMode) throw new Error("Firebase browser database access disabled in staging.");
  const db = getFirestore(getFirebaseApp());

  if (emulatorMode && !registry.firestore.has(db)) {
    connectFirestoreEmulator(
      db,
      "127.0.0.1",
      8081
    );

    registry.firestore.add(db);
  }

  return db;
}
