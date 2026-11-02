import { requireRole } from "@/lib/auth";

export default async function DonorLayout({ children }: LayoutProps<"/donor">) {
  await requireRole("donor");
  return children;
}
