import "server-only";
import { adminAuth } from "@/lib/firebase/admin";
import type { DecodedIdToken } from "firebase-admin/auth";

export async function isApprovedUser(
  token: DecodedIdToken
): Promise<boolean> {
  if (token.firebase.sign_in_provider === "anonymous") {
    return false;
  }

  if (
    token.platformAdmin !== true ||
    token.email_verified !== true
  ) {
    return false;
  }

  const account = await adminAuth().getUser(token.uid);

  return (
    !account.disabled &&
    account.emailVerified &&
    account.customClaims?.platformAdmin === true
  );
}
