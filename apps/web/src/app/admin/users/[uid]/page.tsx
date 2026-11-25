import Link from "next/link";
import {notFound} from "next/navigation";
import {AppShell} from "@/components/app-shell";
import {getUserDetails} from "@/lib/admin/users";
import {isAdminWriteEnabled} from "@/lib/admin/write-guard";
import {UserStatusForm} from "@/components/user-status-form";
import {UserRoleForm} from "@/components/user-role-form";
export const dynamic="force-dynamic";
export default async function UserPage({params}:{params:Promise<{uid:string}>}) {
 const {uid}=await params;const u=await getUserDetails(uid);if(!u)notFound();
 const editable=isAdminWriteEnabled()&&u.matched&&!u.platformAdmin&&["admin","staff","viewer"].includes(u.role)&&u.email.endsWith(".test");
 return <AppShell><Link href="/admin/users" className="org-back">Back to users</Link><h1>{u.email}</h1><div className="card"><p>UID: {u.uid}</p><p>Name: {u.name}</p><p>Status: {u.disabled?"Disabled":"Enabled"}</p><p>Email verified: {u.verified?"Yes":"No"}</p><p>Role: {u.platformAdmin?"Platform administrator":u.role}</p><p>Membership integrity: {u.matched?"Matched":"Not matched"}</p>{u.orgId&&<Link href={`/admin/organizations/${encodeURIComponent(u.orgId)}/members`}>Organization members</Link>}</div>{editable?<UserStatusForm uid={uid} disabled={u.disabled}/>:<p className="sub">Protected or read-only account.</p>}{editable&&!u.disabled&&u.verified&&<UserRoleForm uid={uid} role={u.role}/>}</AppShell>;
}
