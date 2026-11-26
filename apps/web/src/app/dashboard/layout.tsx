import { requireWorkspaceIdentity } from "@/lib/auth/workspace-identity";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireWorkspaceIdentity();
  return <>{children}</>;
}
