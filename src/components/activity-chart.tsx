"use client";

import { useState } from "react";

/*
 * Servings delivered per day (single series, so no legend: the card title
 * names it). Thin bars with rounded tops anchored to the baseline, a
 * recessive grid, and a hover tooltip per day. A table view sits beside it.
 */

type Day = { day: string; servings: number; listings: number; claims: number; running: number };

const W = 640;
const H = 200;
const PAD = { top: 12, right: 8, bottom: 26, left: 36 };

function niceMax(v: number) {
  if (v <= 0) return 10;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}

function shortDate(iso: string) {
  return new Date(`${iso}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

export function ActivityChart({ days }: { days: Day[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...days.map((d) => d.servings)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / days.length;
  const barW = Math.min(18, slot - 6);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];
  const h = hover === null ? null : days[hover];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Servings delivered per day, last 14 days">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--color-muted)">
              {t}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const top = y(d.servings);
          const bh = PAD.top + innerH - top;
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* hit target is the whole column, wider and taller than the bar */}
              <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={innerH} fill="transparent" />
              {bh > 0 && (
                <path
                  d={`M${x},${top + Math.min(4, bh)} q0,-${Math.min(4, bh)} ${Math.min(4, barW / 2)},-${Math.min(4, bh)} h${barW - 2 * Math.min(4, barW / 2)} q${Math.min(4, barW / 2)},0 ${Math.min(4, barW / 2)},${Math.min(4, bh)} V${PAD.top + innerH} H${x} Z`}
                  fill="var(--color-brand)"
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
              {(i % 2 === 1 || days.length <= 7) && (
                <text x={PAD.left + i * slot + slot / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--color-muted)">
                  {shortDate(d.day)}
                </text>
              )}
            </g>
          );
        })}
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + innerH} y2={PAD.top + innerH} stroke="var(--color-muted)" strokeWidth={1} />
      </svg>
      {h && (
        <div
          className="pointer-events-none absolute top-2 rounded-xl bg-card px-3 py-2 text-xs whitespace-nowrap shadow-lg shadow-black/10"
          style={{ left: `${Math.min(80, Math.max(20, ((PAD.left + (hover! + 0.5) * slot) / W) * 100))}%`, transform: "translateX(-50%)" }}
        >
          <div className="font-medium">{shortDate(h.day)}</div>
          <div>{h.servings} servings delivered</div>
          <div className="text-muted">
            {h.listings} listed · {h.claims} claimed · {h.running} running total
          </div>
        </div>
      )}
    </div>
  );
}
