import "server-only";
import { cookies } from "next/headers";
import { adminAuth } from "@/lib/firebase/admin";

const COOKIE_NAME = "__session";
const MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

export async function verifySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    return await adminAuth().verifySessionCookie(token, true);
  } catch {
    return null;
  }
}

export { COOKIE_NAME, MAX_AGE_MS };
