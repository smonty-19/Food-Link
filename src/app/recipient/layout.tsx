import { requireRole } from "@/lib/auth";

// Every page under /recipient is for recipient accounts only
export default async function RecipientLayout({ children }: LayoutProps<"/recipient">) {
  await requireRole("recipient");
  return children;
}
