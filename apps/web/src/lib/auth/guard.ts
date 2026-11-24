import "server-only";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth/session";
import { isApprovedUser } from "@/lib/auth/authorization";

export async function requireUser() {
  const user = await verifySession();

  if (!user) {
    redirect("/login");
  }

  const approved = await isApprovedUser(user).catch(() => false);

  if (!approved) {
    redirect("/login");
  }

  return user;
}

export async function requirePlatformAdmin() {
  const user = await requireUser();

  if (user.platformAdmin !== true) {
    redirect("/dashboard");
  }

  return user;
}
