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

/* Slim, frosted 44px bar with 12px links, in the style of Apple's global nav. */
export async function SiteHeader() {
  const user = await getUser();

  return (
    <header className="sticky top-0 z-20 border-b border-black/5 bg-paper/80 backdrop-blur-xl backdrop-saturate-150">
      <div className="t-caption mx-auto flex h-11 max-w-[1024px] items-center gap-8 px-5">
        <Link href="/" className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
          FoodLink
        </Link>

        {user && (
          <nav className="hidden gap-7 md:flex">
            {NAV[user.role].map((item) => (
              <Link key={item.href} href={item.href} className="text-ink/80 transition-colors hover:text-ink">
                {item.label}
              </Link>
            ))}
          </nav>
        )}

        <div className="ml-auto flex items-center gap-5">
          {user ? (
            <>
              <span className="hidden text-ink/80 sm:inline">
                {user.name} <span className="text-muted">· {user.orgName}</span>
              </span>
              <form action={logout}>
                <button className="text-ink/80 transition-colors hover:text-ink">Log out</button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="text-ink/80 hover:text-ink">
                Log in
              </Link>
              <Link href="/register" className="rounded-full bg-brand px-3 py-1 font-medium text-white hover:bg-brand-dark">
                Join
              </Link>
            </>
          )}
        </div>
      </div>

      {user && (
        <nav className="t-caption flex gap-6 overflow-x-auto border-t border-black/5 px-5 py-2 md:hidden">
          {NAV[user.role].map((item) => (
            <Link key={item.href} href={item.href} className="shrink-0 text-ink/80 hover:text-ink">
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
