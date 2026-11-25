import "server-only";
import { requirePlatformAdmin } from "@/lib/auth/guard";

export function isAdminWriteEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.ORBOTRIQ_FIREBASE_MODE === "emulator" &&
    process.env.NEXT_PUBLIC_FIREBASE_MODE === "emulator" &&
    process.env.FIREBASE_PROJECT_ID === "demo-orbotriq-v2" &&
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === "demo-orbotriq-v2" &&
    process.env.FIREBASE_AUTH_EMULATOR_HOST === "127.0.0.1:9099" &&
    process.env.FIRESTORE_EMULATOR_HOST === "127.0.0.1:8081"
  );
}

export async function requireAdminWrite() {
  if (!isAdminWriteEnabled()) {
    throw new Error("Administrative writes are disabled.");
  }

  return requirePlatformAdmin();
}
