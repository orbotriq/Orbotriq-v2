import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { UserDirectory } from "@/components/user-directory";
import { listUsers } from "@/lib/admin/users";
import {isAdminWriteEnabled} from "@/lib/admin/write-guard";
export const dynamic="force-dynamic";
export default async function UsersPage({searchParams}:{searchParams:Promise<{cursor?:string}>}) {
 const {cursor}=await searchParams; const result=await listUsers(typeof cursor==="string"?cursor:undefined);
 return <AppShell><div className="eyebrow">Platform administration</div><h1>Users</h1><p className="sub">Firebase accounts, up to 100 per page. Search and filters apply to this page.</p>{isAdminWriteEnabled()&&<Link href="/admin/users/create">Create test account</Link>}<UserDirectory users={result.users}/><div className="org-toolbar"><Link href="/admin/users">First page</Link>{result.next&&<Link href={`/admin/users?cursor=${encodeURIComponent(result.next)}`}>Next page</Link>}</div></AppShell>;
}
