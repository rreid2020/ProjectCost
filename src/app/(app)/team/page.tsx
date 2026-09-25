import { OrganizationProfile } from "@clerk/nextjs";
import { getTenant } from "@/lib/tenant";
import { PageHeader } from "@/components/ui";

export default async function Team() {
  const { isAdmin } = await getTenant({ allowInactive: true });
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Team" subtitle={isAdmin ? "Invite people to this company and choose who is an admin. Admins manage settings, billing, cost codes and month-end." : "People in this company. Ask an admin to invite others or change roles."} />
      <OrganizationProfile routing="hash" appearance={{ elements: { rootBox: "w-full", cardBox: "w-full max-w-none shadow-sm border border-slate-200" } }} />
    </div>
  );
}
