import "server-only";
import { FieldPath } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { requirePlatformAdmin } from "@/lib/auth/guard";

const PAGE_SIZE = 25;

const eventLabels: Record<string, string> = {
  "org.created": "Organization created",
  "org.created_by_admin": "Organization created by admin",
  "org.demo_created": "Demo organization created",
  "org.updated_by_admin": "Organization updated by admin",
  "password.changed": "Password changed",
  "billing.profile_saved": "Billing profile updated",
  "invoice.issued": "Invoice issued",
  "invoice.paid": "Invoice paid",
  "invoice.voided": "Invoice voided",
  "proforma.converted": "Proforma converted",
  "metaApp.saved": "Meta app configuration saved",
  "campaign.active": "Campaign activated",
  "campaign.paused": "Campaign paused",
  "review.replied": "Business review replied",
};

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "-";
}

function timestamp(value: unknown): number | null {
  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof value.toMillis === "function"
  ) {
    const result = value.toMillis();

    if (typeof result === "number" && Number.isFinite(result)) {
      return result;
    }
  }

  return null;
}

function validId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 1500 &&
    !value.includes("/") &&
    value !== "." &&
    value !== ".."
  );
}

export async function getOrganizationActivity(
  orgId: string,
  cursor?: string
) {
  await requirePlatformAdmin();

  if (!validId(orgId)) return null;

  const ref = adminDb().collection("orgs").doc(orgId);
  const organization = await ref.get();

  if (!organization.exists) return null;

  const logs = ref.collection("auditLogs");

  let query = logs
    .orderBy("at", "desc")
    .orderBy(FieldPath.documentId(), "desc");

  if (cursor && validId(cursor)) {
    const previous = await logs.doc(cursor).get();

    if (previous.exists && previous.get("at")) {
      query = query.startAfter(previous);
    }
  }

  const snapshot = await query
    .select(
      "action",
      "by",
      "at",
      "fields",
      "number",
      "activated",
      "proforma",
      "paid",
      "campaignId",
      "reviewId"
    )
    .limit(PAGE_SIZE + 1)
    .get();

  const hasMore = snapshot.docs.length > PAGE_SIZE;
  const documents = snapshot.docs.slice(0, PAGE_SIZE);

  const events = documents.map(doc => {
    const data = doc.data();
    const action = textValue(data.action);
    const time = timestamp(data.at);

    const details: string[] = [];

    if (Array.isArray(data.fields)) {
      const fields = data.fields
        .filter((field: unknown): field is string =>
          typeof field === "string"
        )
        .slice(0, 30);

      if (fields.length) {
        details.push(`Updated fields: ${fields.join(", ")}`);
      }
    }

    if (typeof data.number === "string") {
      details.push(`Invoice: ${data.number}`);
    }

    if (typeof data.proforma === "string") {
      details.push(`Proforma: ${data.proforma}`);
    }

    if (typeof data.activated === "boolean") {
      details.push(`Subscription activated: ${data.activated ? "Yes" : "No"}`);
    }

    if (typeof data.paid === "boolean") {
      details.push(`Paid: ${data.paid ? "Yes" : "No"}`);
    }

    if (typeof data.campaignId === "string") {
      details.push(`Campaign: ${data.campaignId}`);
    }

    if (typeof data.reviewId === "string") {
      details.push(`Review: ${data.reviewId}`);
    }

    return {
      id: doc.id,
      action,
      label: Object.prototype.hasOwnProperty.call(eventLabels, action)
        ? eventLabels[action]
        : action,
      category: action.split(".")[0],
      actor: textValue(data.by),
      time,
      details,
    };
  });

  return {
    organizationName:
      typeof organization.get("name") === "string"
        ? organization.get("name")
        : "Organization",
    events,
    nextCursor: hasMore
      ? documents[documents.length - 1].id
      : null,
  };
}
