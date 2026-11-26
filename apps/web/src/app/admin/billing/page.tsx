import { AppShell } from '@/components/app-shell';
import { BillingForm } from '@/components/billing-form';
import { listBilling } from '@/lib/admin/billing';
import { isAdminWriteEnabled } from '@/lib/admin/write-guard';
export const dynamic='force-dynamic';
export default async function Page(){return <AppShell>{isAdminWriteEnabled()?<BillingForm orgs={await listBilling()}/>:<><h1>Billing</h1><p>Test billing is disabled.</p></>}</AppShell>}
