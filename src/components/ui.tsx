import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/* Small, plain building blocks shared by every page. */

export function Page({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return <div className={`mx-auto px-4 py-10 sm:px-6 ${narrow ? "max-w-2xl" : "max-w-6xl"}`}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  action,
  back,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-8">
      {back && (
        <Link href={back.href} className="mb-3 inline-block text-sm text-muted hover:text-ink">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-card ${className}`}>{children}</section>;
}

export function CardHeader({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
      <h2 className="font-serif text-lg font-semibold">{title}</h2>
      {aside}
    </div>
  );
}

const BUTTON = {
  primary: "bg-brand text-white hover:bg-brand-dark",
  secondary: "border border-line bg-card text-ink hover:border-ink",
  danger: "border border-rose/30 bg-card text-rose hover:bg-rose-soft",
  quiet: "text-muted hover:text-ink",
} as const;

export function buttonClass(variant: keyof typeof BUTTON = "primary", extra = "") {
  return `inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${BUTTON[variant]} ${extra}`;
}

export function ButtonLink({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: keyof typeof BUTTON }) {
  return <Link {...props} className={buttonClass(variant, className)} />;
}

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <span className="mb-1.5 block text-sm font-medium">
      {children}
      {hint && <span className="ml-1.5 font-normal text-muted">{hint}</span>}
    </span>
  );
}

export function ErrorNote({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border border-rose/25 bg-rose-soft px-4 py-2.5 text-sm text-rose">
      {message}
    </p>
  );
}

export function Notice({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" }) {
  const tones = {
    neutral: "border-line bg-sand text-ink",
    good: "border-leaf/25 bg-leaf-soft text-leaf",
    warn: "border-amber/25 bg-amber-soft text-amber",
  };
  return <p className={`rounded-lg border px-4 py-2.5 text-sm ${tones[tone]}`}>{children}</p>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-serif text-lg">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="rounded-xl border border-line bg-card px-5 py-4">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 font-serif text-3xl font-semibold tabular-nums">{value}</div>
      {note && <div className="mt-0.5 text-xs text-muted">{note}</div>}
    </div>
  );
}

// ---------- status chips ----------

type Tone = "leaf" | "amber" | "brand" | "slate" | "rose" | "ink";
const TONE: Record<Tone, string> = {
  leaf: "bg-leaf-soft text-leaf",
  amber: "bg-amber-soft text-amber",
  brand: "bg-brand-soft text-brand-dark",
  slate: "bg-slate-soft text-slate",
  rose: "bg-rose-soft text-rose",
  ink: "bg-sand text-ink",
};

const STATUS_TONE: Record<string, Tone> = {
  // donations
  DRAFT: "slate",
  AVAILABLE: "leaf",
  ALLOCATED: "amber",
  PICKED_UP: "brand",
  COMPLETED: "ink",
  EXPIRED: "rose",
  CANCELLED: "rose",
  // allocations
  confirmed: "amber",
  completed: "leaf",
  cancelled: "rose",
  // pickups
  pending: "slate",
  scheduled: "amber",
  missed: "rose",
};

export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? "slate";
  const label = status.replaceAll("_", " ").toLowerCase();
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${TONE[tone]}`}>
      {label}
    </span>
  );
}

export function TagList({ tags }: { tags: string[] | null | undefined }) {
  if (!tags?.length) return <span className="text-xs text-muted">No dietary tags</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <span key={t} className="rounded border border-line px-1.5 py-0.5 text-xs text-muted">
          {t.replaceAll("_", " ")}
        </span>
      ))}
    </span>
  );
}
