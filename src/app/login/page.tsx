import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser, homeFor } from "@/lib/auth";
import { Card, Page } from "@/components/ui";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

const DEMO_ACCOUNTS = [
  ["Donor", "ravi@annapoorna.in", "Ravi@123"],
  ["Recipient", "anita@akshaya.org", "Anita@123"],
  ["Admin", "admin@foodlink.app", "Admin@123"],
];

export default async function LoginPage() {
  const user = await getUser();
  if (user) redirect(homeFor(user.role));

  return (
    <Page narrow>
      <div className="mx-auto max-w-md">
        <h1 className="font-serif text-3xl font-semibold">Welcome back</h1>
        <p className="mt-1.5 text-muted">
          New here?{" "}
          <Link href="/register" className="text-brand underline-offset-2 hover:underline">
            Register your organization
          </Link>
        </p>

        <Card className="mt-8 p-6">
          <LoginForm />
        </Card>

        <div className="mt-6 rounded-xl border border-dashed border-line p-4 text-sm">
          <p className="mb-2 font-medium">Demo accounts (seed data)</p>
          <table className="w-full text-muted">
            <tbody>
              {DEMO_ACCOUNTS.map(([role, email, pw]) => (
                <tr key={email}>
                  <td className="py-0.5 pr-3 text-ink">{role}</td>
                  <td className="py-0.5 pr-3 font-mono text-xs">{email}</td>
                  <td className="py-0.5 font-mono text-xs">{pw}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Page>
  );
}
