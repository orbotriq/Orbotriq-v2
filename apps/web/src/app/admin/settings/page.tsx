import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PlatformBusinessForm } from "@/components/platform-business-form";
import { getBusinessSettings } from "@/lib/admin/platform-business";
import { PlatformBillingForm } from "@/components/platform-billing-form";
import { getBillingSettings } from "@/lib/admin/platform-billing";
import { PlatformProvisioningForm } from "@/components/platform-provisioning-form";
import { getProvisioningSettings } from "@/lib/admin/platform-provisioning";
import { PlatformAccessForm } from "@/components/platform-access-form";
import { getAccessSettings } from "@/lib/admin/platform-access";
export const dynamic="force-dynamic";
export const metadata={title:"Platform settings"};
export default async function PlatformSettingsPage() {
  const [result,billing,provisioning,access]=await Promise.all([getBusinessSettings(),getBillingSettings(),getProvisioningSettings(),getAccessSettings()]);
  return <AppShell><div className="eyebrow">Platform administration</div><h1>Platform settings</h1>
    <p className="sub">Manage isolated test configuration. Settings do not yet affect production services.</p>
    <div className="admin-stats-grid"><div className="admin-stat-card"><div className="admin-stat-label">Business configuration</div><div className="admin-stat-value">{result.configured?"Saved":"Not configured"}</div></div><div className="admin-stat-card"><div className="admin-stat-label">Access mode</div><div className="admin-stat-value">{result.business?"Emulator":"Disabled"}</div></div></div>
    {result.notice&&<p className="sub" role="status">{result.notice}</p>}
    {result.business&&<PlatformBusinessForm key={`business-${result.version}`} business={result.business} version={result.version}/>}
    {billing.notice&&<p className="sub" role="status">{billing.notice}</p>}
    {billing.billing&&<PlatformBillingForm key={`billing-${billing.version}`} billing={billing.billing} version={billing.version}/>}
    {provisioning.notice&&<p className="sub" role="status">{provisioning.notice}</p>}
    {provisioning.provisioning&&<PlatformProvisioningForm key={`provisioning-${provisioning.version}`} provisioning={provisioning.provisioning} version={provisioning.version}/>}
    <section className="card" style={{marginTop:20}}><h2>Cashfree gateway configuration</h2><p>Mode: {provisioning.gateway.mode}</p><p>App ID: {provisioning.gateway.appConfigured?"Configured":"Missing"} · Secret key: {provisioning.gateway.secretConfigured?"Configured":"Missing"}</p><p>New checkout: {provisioning.gateway.checkoutAvailable?"Available":"Unavailable"}</p><p className="sub">Configuration indicators only; no gateway connectivity or credential validity check. Secrets are never displayed.</p></section>
    {access.notice&&<p className="sub" role="status">{access.notice}</p>}
    {access.access&&<PlatformAccessForm key={`access-${access.version}`} access={access.access} version={access.version}/>}
    <section className="card" style={{marginTop:20}}><h2>Settings change history</h2><Link href="/admin/audit">View global audit logs</Link></section>
  </AppShell>;
}
