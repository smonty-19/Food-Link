import Link from "next/link";
import { getUser, type Role } from "@/lib/auth";
import { logout } from "@/actions/auth";

const NAV: Record<Role, { href: string; label: string }[]> = {
  donor: [
    { href: "/donor", label: "My listings" },
    { href: "/donor/donations/new", label: "List food" },
  ],
  recipient: [
    { href: "/recipient", label: "Overview" },
    { href: "/recipient/browse", label: "Browse food" },
    { href: "/recipient/requirements/new", label: "New requirement" },
  ],
  admin: [
    { href: "/admin", label: "Platform" },
    { href: "/admin/demo", label: "Concurrency demo" },
  ],
};

export async function SiteHeader() {
  const user = await getUser();

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-4 sm:px-6">
        <Link href="/" className="flex items-baseline gap-1.5">
          <span className="font-serif text-xl font-semibold tracking-tight text-ink">FoodLink</span>
          <span className="hidden text-xs text-muted sm:inline">Bengaluru</span>
        </Link>

        {user && (
          <nav className="hidden gap-6 text-sm md:flex">
            {NAV[user.role].map((item) => (
              <Link key={item.href} href={item.href} className="text-muted transition hover:text-ink">
                {item.label}
              </Link>
            ))}
          </nav>
        )}

        <div className="ml-auto flex items-center gap-4 text-sm">
          {user ? (
            <>
              <div className="hidden text-right leading-tight sm:block">
                <div className="font-medium">{user.name}</div>
                <div className="text-xs text-muted">{user.orgName}</div>
              </div>
              <form action={logout}>
                <button className="rounded-md border border-line px-3 py-1.5 text-muted transition hover:border-ink hover:text-ink">
                  Log out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="text-muted hover:text-ink">
                Log in
              </Link>
              <Link href="/register" className="rounded-md bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand-dark">
                Join
              </Link>
            </>
          )}
        </div>
      </div>

      {user && (
        <nav className="flex gap-5 overflow-x-auto border-t border-line px-4 py-2 text-sm md:hidden">
          {NAV[user.role].map((item) => (
            <Link key={item.href} href={item.href} className="shrink-0 text-muted hover:text-ink">
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
