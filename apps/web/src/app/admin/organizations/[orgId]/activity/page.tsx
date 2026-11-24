import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, History } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ActivityTable } from "@/components/activity-table";
import { getOrganizationActivity } from "@/lib/admin/activity";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Organization Activity",
};

export default async function OrganizationActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ after?: string | string[] }>;
}) {
  const { orgId } = await params;
  const filters = await searchParams;

  const cursor =
    typeof filters.after === "string"
      ? filters.after
      : undefined;

  const result = await getOrganizationActivity(orgId, cursor);

  if (!result) notFound();

  const base = `/admin/organizations/${encodeURIComponent(orgId)}`;
  const activityPath = `${base}/activity`;

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const recentCount = result.events.filter(
    event => event.time !== null && event.time >= sevenDaysAgo
  ).length;

  return (
    <AppShell>
      <Link href={base} className="org-back">
        <ArrowLeft size={17} />
        Back to organization
      </Link>

      <div className="eyebrow">
        Platform administration
      </div>

      <h1>Organization Activity</h1>

      <p className="sub">
        {result.organizationName} - Activity and audit history
      </p>

      <ActivityTable
        key={cursor || "latest"}
        events={result.events}
        recentCount={recentCount}
      />

      <div className="audit-pagination">
        <Link
          href={activityPath}
          className="org-members-button"
        >
          <History size={16} />
          Latest events
        </Link>

        {result.nextCursor && (
          <Link
            href={`${activityPath}?after=${encodeURIComponent(result.nextCursor)}`}
            className="org-members-button"
          >
            Older events
            <ArrowRight size={16} />
          </Link>
        )}
      </div>

      <p className="sub">
        Showing up to 25 events per page.
        Search and filters apply to the currently loaded events.
      </p>
    </AppShell>
  );
}
