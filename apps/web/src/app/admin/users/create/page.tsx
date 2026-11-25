import Link from "next/link";
import {AppShell} from "@/components/app-shell";
import {UserProvisionForm} from "@/components/user-provision-form";
import {requirePlatformAdmin} from "@/lib/auth/guard";
import {isAdminWriteEnabled} from "@/lib/admin/write-guard";
export const dynamic="force-dynamic";
export default async function Page(){await requirePlatformAdmin();return <AppShell><Link href="/admin/users">Back to users</Link><h1>Create test account</h1><p className="sub">Copy an eligible organization ID from its detail URL. No email invitation is sent. Test accounts cannot sign into the platform admin workspace.</p>{isAdminWriteEnabled()?<UserProvisionForm/>:<p>Administrative writes disabled.</p>}</AppShell>;}
