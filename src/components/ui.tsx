import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/* Small, plain building blocks shared by every page. */

export function Page({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return <div className={`mx-auto px-5 pt-12 pb-20 ${narrow ? "max-w-[692px]" : "max-w-[1024px]"}`}>{children}</div>;
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
    <div className="mb-10">
      {back && (
        <Link href={back.href} className="t-small mb-4 inline-block text-brand hover:underline">
          ‹ {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <h1 className="t-headline">{title}</h1>
          {subtitle && <div className="t-subhead mt-2 text-muted">{subtitle}</div>}
        </div>
        {action}
      </div>
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`overflow-hidden rounded-[18px] bg-card ${className}`}>{children}</section>;
}

export function CardHeader({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
      <h2 className="t-card-title">{title}</h2>
      {aside}
    </div>
  );
}

const BUTTON = {
  primary: "bg-brand text-white hover:bg-brand-dark",
  secondary: "bg-sand text-ink hover:bg-line",
  danger: "bg-rose-soft text-rose hover:bg-rose hover:text-white",
  quiet: "text-brand hover:underline",
} as const;

/** Pill buttons, 14px label, Apple proportions. */
export function buttonClass(variant: keyof typeof BUTTON = "primary", extra = "") {
  const shape = variant === "quiet" ? "px-1 py-1" : "rounded-full px-[18px] py-[7px]";
  return `t-small inline-flex items-center justify-center gap-1.5 font-normal transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${shape} ${BUTTON[variant]} ${extra}`;
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
    <span className="t-small mb-2 block font-semibold">
      {children}
      {hint && <span className="ml-1.5 font-normal text-muted">{hint}</span>}
    </span>
  );
}

export function ErrorNote({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="t-small rounded-xl bg-rose-soft px-4 py-3 text-rose">
      {message}
    </p>
  );
}

export function Notice({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" }) {
  const tones = {
    neutral: "bg-card text-ink",
    good: "bg-leaf-soft text-leaf",
    warn: "bg-amber-soft text-amber",
  };
  return <p className={`t-small rounded-xl px-4 py-3 ${tones[tone]}`}>{children}</p>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="t-card-title">{title}</p>
      {children && <div className="t-small mx-auto mt-2 max-w-sm text-muted">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="rounded-[18px] bg-card px-6 py-5">
      <div className="t-small text-muted">{label}</div>
      <div className="mt-1 font-serif text-[40px] leading-[1.1] font-semibold tabular-nums">{value}</div>
      {note && <div className="t-caption mt-1 text-muted">{note}</div>}
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
    <span className={`t-caption inline-flex items-center rounded-full px-2.5 py-[3px] font-medium capitalize ${TONE[tone]}`}>
      {label}
    </span>
  );
}

export function TagList({ tags }: { tags: string[] | null | undefined }) {
  if (!tags?.length) return <span className="t-caption text-muted">No dietary tags</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <span key={t} className="t-caption rounded-full bg-sand px-2 py-0.5 text-muted">
          {t.replaceAll("_", " ")}
        </span>
      ))}
    </span>
  );
}
