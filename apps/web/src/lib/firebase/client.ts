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
  if (emulatorMode) {
    if (
      process.env.NODE_ENV === "production" ||
      config.projectId !== "demo-orbotriq-v2"
    ) {
      throw new Error("Unsafe Firebase client emulator configuration.");
    }
  } else if (
    process.env.NODE_ENV === "development" ||
    config.projectId?.startsWith("demo-")
  ) {
    throw new Error("Local development requires Firebase emulator mode.");
  }

  if (!config.apiKey || !config.projectId || !config.appId) {
    throw new Error("Firebase client configuration is missing.");
  }

  const name = emulatorMode
    ? "orbotriq-emulator"
    : "[DEFAULT]";

  const existing = getApps().find(app => app.name === name);

  return existing ??
    (emulatorMode
      ? initializeApp(config, name)
      : initializeApp(config));
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
