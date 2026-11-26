"use client";

import type { WorkspaceRole } from "@/lib/auth/customer-policy";
import { canViewWorkspaceModule } from "@/lib/auth/customer-policy";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogoutButton } from "@/components/logout-button";
import {
  Activity, BarChart3, Bot, Building2, CalendarDays,
  ChartNoAxesCombined, CircleDollarSign, FileText,
  FolderKanban, Globe2, LayoutDashboard, Megaphone,
  Settings, ShieldCheck, Users, Layers, Mail,
  ScrollText, Menu, X, ArrowLeft,
} from "lucide-react";

const workspaceGroups = [
  {
    title: "Workspace",
    items: [
      { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
      { label: "Brands", href: "/dashboard/brands", icon: Building2 },
      { label: "Social & Publishing", href: "/dashboard/social", icon: CalendarDays },
      { label: "Ads", href: "/dashboard/ads", icon: Megaphone },
    ],
  },
  {
    title: "Intelligence",
    items: [
      { label: "SEO & Analytics", href: "/dashboard/seo", icon: ChartNoAxesCombined },
      { label: "GEO - AI Search", href: "/dashboard/geo", icon: Globe2 },
      { label: "Competitors", href: "/dashboard/competitors", icon: BarChart3 },
      { label: "Growth Copilot", href: "/dashboard/copilot", icon: Bot },
      { label: "Alerts", href: "/dashboard/alerts", icon: Activity },
      { label: "Reports", href: "/dashboard/reports", icon: FileText },
    ],
  },
  {
    title: "Agency",
    items: [
      { label: "Clients & CRM", href: "/agency/clients", icon: Users },
      { label: "Projects & Tasks", href: "/agency/projects", icon: FolderKanban },
      { label: "Billing", href: "/dashboard/billing", icon: CircleDollarSign },
      { label: "Settings", href: "/dashboard/settings", icon: Settings },
    ],
  },
  {
    title: "Platform",
    items: [
      { label: "Super Admin", href: "/admin", icon: ShieldCheck },
    ],
  },
];

const adminGroups = [
  {
    title: "Platform administration",
    items: [
      { label: "Overview", href: "/admin", icon: LayoutDashboard },
      { label: "Organizations", href: "/admin/organizations", icon: Building2 },
      { label: "Users", href: "/admin/users", icon: Users },
      { label: "Subscription Plans", href: "/admin/plans", icon: Layers },
      { label: "Billing & GST", href: "/admin/billing", icon: CircleDollarSign },
      { label: "Leads", href: "/admin/leads", icon: Mail },
      { label: "Audit Logs", href: "/admin/audit", icon: ScrollText },
      { label: "Platform Settings", href: "/admin/settings", icon: Settings },
    ],
  },
  {
    title: "Navigation",
    items: [
      { label: "Back to Workspace", href: "/dashboard", icon: ArrowLeft },
    ],
  },
];

export function AppShell({
  children, workspaceRole,
}: {
  children: React.ReactNode;
  active?: string;
  workspaceRole?: WorkspaceRole;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isAdmin =
    pathname === "/admin" || pathname.startsWith("/admin/");

  const groups = isAdmin ? adminGroups : workspaceGroups.map(group=>({...group,items:group.items.filter(item=>{
    if(item.href==="/admin")return workspaceRole==="platform";
    if(item.href==="/dashboard")return true;
    return canViewWorkspaceModule(workspaceRole??"viewer",item.href.split("/").pop());
  })})).filter(group=>group.items.length>0);

  const current = groups
    .flatMap((group) => group.items)
    .find((item) => item.href === pathname);

  return (
    <div className={`shell ${isAdmin ? "admin-shell" : ""}`}>
      {mobileOpen && (
        <button
          className="sidebar-overlay"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          ORB<span>O</span>TRIQ
        </div>

        {groups.map((group) => (
          <div key={group.title}>
            <div className="nav-label">{group.title}</div>

            {group.items.map(({ label, href, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={`nav-link ${pathname === href ? "active" : ""}`}
                aria-current={pathname === href ? "page" : undefined}
                onClick={() => setMobileOpen(false)}
              >
                <Icon size={17} />
                {label}
              </Link>
            ))}
          </div>
        ))}

        <div className="sidebar-footer">
          ORBOTRIQ V2
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu-button"
              aria-label="Toggle navigation"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>

            <div className="shell-breadcrumb">
              {isAdmin ? "Super Admin" : "Workspace"} /{" "}
              <strong>{current?.label ?? "Overview"}</strong>
            </div>
          </div>

          <div className="topbar-actions">
            {isAdmin && (
              <span className="admin-header-label">
                <ShieldCheck size={16} />
                Platform Admin
              </span>
            )}
            <LogoutButton />
          </div>
        </header>

        <div className="shell-body">{children}</div>
      </main>
    </div>
  );
}
