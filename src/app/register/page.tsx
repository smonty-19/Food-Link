import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser, homeFor } from "@/lib/auth";
import { Card, Page } from "@/components/ui";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Register" };

export default async function RegisterPage() {
  const user = await getUser();
  if (user) redirect(homeFor(user.role));

  return (
    <Page narrow>
      <h1 className="t-headline">Register your organization.</h1>
      <p className="t-subhead mt-2 text-muted">
        One account per person. Already registered?{" "}
        <Link href="/login" className="text-brand underline-offset-2 hover:underline">
          Log in
        </Link>
      </p>
      <Card className="mt-8 p-7">
        <RegisterForm />
      </Card>
    </Page>
  );
}
