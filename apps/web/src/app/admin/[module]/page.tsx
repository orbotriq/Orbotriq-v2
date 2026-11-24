import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requirePlatformAdmin } from "@/lib/auth/guard";

const modules: Record<string, { title: string; description: string }> = {
  organizations: {
    title: "Organizations",
    description: "Manage customer organizations and workspaces.",
  },
  users: {
    title: "User Management",
    description: "Manage accounts, roles and permissions.",
  },
  plans: {
    title: "Subscription Plans",
    description: "Manage pricing, features and usage limits.",
  },
  billing: {
    title: "Billing & GST",
    description: "Manage subscriptions, payments and invoices.",
  },
  leads: {
    title: "Leads",
    description: "Manage customer enquiries and opportunities.",
  },
  audit: {
    title: "Audit Logs",
    description: "Monitor administrative activity.",
  },
  settings: {
    title: "Platform Settings",
    description: "Manage platform configuration and integrations.",
  },
};

export const dynamic = "force-dynamic";

export default async function AdminModulePage({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  await requirePlatformAdmin();

  const { module } = await params;

  if (!Object.prototype.hasOwnProperty.call(modules, module)) {
    notFound();
  }

  const item = modules[module];

  return (
    <AppShell>
      <div className="eyebrow">Platform administration</div>
      <h1>{item.title}</h1>
      <p className="sub">{item.description}</p>

      <div className="card" style={{ marginTop: 24 }}>
        <h2>Module under development</h2>
        <p className="sub" style={{ marginTop: 12 }}>
          This route is available. Database integration and
          administrative actions are not yet enabled.
        </p>
      </div>
    </AppShell>
  );
}
