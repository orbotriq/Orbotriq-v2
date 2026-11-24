import { isApprovedUser } from "@/lib/auth/authorization";
import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase/admin";
import { COOKIE_NAME, MAX_AGE_MS } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }

  try {
    const { idToken } = await request.json();

    if (typeof idToken !== "string" || !idToken) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }

    const auth = adminAuth();
    const decoded = await auth.verifyIdToken(idToken, true);

    if (!(await isApprovedUser(decoded))) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (Date.now() / 1000 - decoded.auth_time > 300) {
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
  } catch (error) {
    console.error("Firebase session error:", error);
    return NextResponse.json(
      { error: "Unable to establish session" },
      { status: 401 }
    );
  }
}


