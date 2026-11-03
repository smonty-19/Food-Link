import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { Card, Page, PageHeader } from "@/components/ui";
import { RequirementForm } from "./requirement-form";

export const metadata: Metadata = { title: "New requirement" };

export default async function NewRequirementPage() {
  await requireRole("recipient");
  return (
    <Page narrow>
      <PageHeader
        title="What do you need?"
        subtitle="Describe it the way you'd tell a friend. We match listings by meaning, then check diet, capacity and distance."
        back={{ href: "/recipient", label: "Overview" }}
      />
      <Card className="p-6">
        <RequirementForm />
      </Card>
    </Page>
  );
}
