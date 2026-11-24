import { requireUser } from "@/lib/auth/guard";

export default async function AgencyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();
  return <>{children}</>;
}
