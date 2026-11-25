import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/session";
import { isApprovedUser } from "@/lib/auth/authorization";
import { isAdminWriteEnabled } from "@/lib/admin/write-guard";
import { updateSubscription } from "@/lib/admin/subscription";

export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ orgId: string }> }
) {
  if (!isAdminWriteEnabled()) {
    return NextResponse.json(
      { error: "Administrative writes are disabled." },
      { status: 403 }
    );
  }

  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json(
      { error: "Invalid origin." },
      { status: 403 }
    );
  }

  const session = await verifySession();

  if (!session) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 }
    );
  }

  const approved = await isApprovedUser(session)
    .catch(() => false);

  if (!approved) {
    return NextResponse.json(
      { error: "Access denied." },
      { status: 403 }
    );
  }

  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();

  if (contentType !== "application/json") {
    return NextResponse.json(
      { error: "JSON request required." },
      { status: 415 }
    );
  }

  let input: unknown;

  try {
    input = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request." },
      { status: 400 }
    );
  }

  try {
    const { orgId } = await context.params;
    const result = await updateSubscription(orgId, input);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "Subscription update failed." },
      { status: 500 }
    );
  }
}
