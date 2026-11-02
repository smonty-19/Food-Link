import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { Card, Page, PageHeader } from "@/components/ui";
import { DonationForm } from "./donation-form";

export const metadata: Metadata = { title: "List food" };

export default async function NewDonationPage() {
  const user = await requireRole("donor");
  return (
    <Page narrow>
      <PageHeader
        title="List surplus food"
        subtitle="Save it as a draft, or publish it now so recipients nearby can claim it."
        back={{ href: "/donor", label: "My listings" }}
      />
      <Card className="p-6">
        <DonationForm lat={user.lat} lng={user.lng} />
      </Card>
    </Page>
  );
}
