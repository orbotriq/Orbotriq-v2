import { recentPasswordToken } from "@/lib/auth/onboarding-policy";
import { resolveWorkspaceIdentity } from "@/lib/auth/workspace-identity";
import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase/admin";
import { COOKIE_NAME, MAX_AGE_MS } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }

  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return NextResponse.json({ error: "JSON request required" }, { status: 415 });
  }

  try {
    const { idToken } = await request.json();

    if (typeof idToken !== "string" || !idToken) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }

    const auth = adminAuth();
    const decoded = await auth.verifyIdToken(idToken, true);

    if (!(await resolveWorkspaceIdentity(decoded))) {
      if (recentPasswordToken(decoded,Date.now()) && await resolveWorkspaceIdentity(decoded,"onboarding")) {
        const response=NextResponse.json({error:"Password setup required",code:"PASSWORD_SETUP_REQUIRED"},{status:403});
        response.cookies.set(COOKIE_NAME,"",{httpOnly:true,sameSite:"lax",path:"/",maxAge:0});
        return response;
      }
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (!Number.isFinite(decoded.auth_time) || decoded.auth_time > Date.now()/1000 + 30 || Date.now() / 1000 - decoded.auth_time > 300) {
      return NextResponse.json({ error: "Please sign in again" }, { status: 401 });
    }

    const sessionCookie = await auth.createSessionCookie(idToken, {
      expiresIn: MAX_AGE_MS,
    });

    const response = NextResponse.json({ success: true });

    response.cookies.set(COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE_MS / 1000,
    });

    return response;
  } catch {
    return NextResponse.json(
      { error: "Unable to establish session" },
      { status: 401 }
    );
  }
}


