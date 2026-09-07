"use client";

/**
 * Multi-series latency chart.
 *
 * Two decisions make ~19 concurrent series readable:
 *
 * 1. **Logarithmic y-axis by default.** Gateway latencies span three orders of
 *    magnitude (sub-second to 60s+). On a linear axis a single slow model
 *    compresses every healthy one into a flat line at the bottom. A log scale
 *    keeps sub-second differences visible alongside outliers.
 * 2. **Hover isolation.** Hovering a legend entry dims the other series, so an
 *    individual model can be traced through a dense chart.
 *
 * The legend is rendered separately rather than by Recharts, which lets it be
 * scrollable, grouped by vendor, and interactive without consuming plot height.
 */
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ModelTimeseries } from "@/lib/types";
import { formatClock } from "@/lib/format";
import { providerOf, shortName } from "@/lib/providers";

type ChartRow = Record<string, number | string | null> & { bucket: string };

/** Pivot per-model series into one row per timestamp. */
function toChartRows(timeseries: ModelTimeseries[]): ChartRow[] {
  const byBucket = new Map<string, ChartRow>();
  for (const series of timeseries) {
    for (const point of series.points) {
      const row = byBucket.get(point.bucket) ?? { bucket: point.bucket };
      row[series.model] = point.avgLatencyMs;
      byBucket.set(point.bucket, row);
    }
  }
  return [...byBucket.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
}

/** Tooltip listing only the nearest few series, sorted fastest-first. */
function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; stroke?: string }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;

  // A 19-model tooltip is unreadable, so show the fastest few plus a count.
  const items = payload
    .filter((p) => typeof p.value === "number")
    .sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
  const shown = items.slice(0, 8);
  const hidden = items.length - shown.length;

  return (
    <div className="rounded-md border border-zinc-700 bg-zinc-900/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <div className="mb-1.5 font-medium text-zinc-300">
        {typeof label === "string" ? new Date(label).toLocaleString() : ""}
      </div>
      <div className="space-y-0.5">
        {shown.map((p) => (
          <div key={p.name} className="flex items-center gap-2 tabular-nums">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: p.stroke }}
            />
            <span className="truncate text-zinc-400">{shortName(p.name ?? "")}</span>
            <span className="ml-auto font-mono text-zinc-100">
              {Math.round(p.value ?? 0)} ms
            </span>
          </div>
        ))}
        {hidden > 0 && (
          <div className="pt-1 text-zinc-500">+{hidden} more</div>
        )}
      </div>
    </div>
  );
}

export function LatencyChart({
  timeseries,
  colours,
  logScale,
}: {
  timeseries: ModelTimeseries[];
  colours: Map<string, string>;
  logScale: boolean;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const rows = useMemo(() => toChartRows(timeseries), [timeseries]);

  if (rows.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center text-sm text-zinc-500">
        No probe data in this window yet.
      </div>
    );
  }

  return (
    <div>
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
            <XAxis
              dataKey="bucket"
              tickFormatter={formatClock}
              stroke="#71717a"
              fontSize={11}
              minTickGap={40}
            />
            <YAxis
              stroke="#71717a"
              fontSize={11}
              width={56}
              // `domain: auto` with a log scale requires positive bounds;
              // latencies are always >= 1ms so this is safe.
              scale={logScale ? "log" : "linear"}
              domain={logScale ? [1, "auto"] : [0, "auto"]}
              allowDataOverflow={false}
              tickFormatter={(v: number) =>
                v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}s` : `${v}ms`
              }
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: "#52525b", strokeWidth: 1 }}
            />
            {timeseries.map((series) => {
              const dim = hovered !== null && hovered !== series.model;
              return (
                <Line
                  key={series.model}
                  type="monotone"
                  dataKey={series.model}
                  stroke={colours.get(series.model) ?? "#94a3b8"}
                  strokeWidth={hovered === series.model ? 2.5 : 1.5}
                  strokeOpacity={dim ? 0.12 : 1}
                  dot={false}
                  // Bridge gaps left by failed probes instead of dropping to zero.
                  connectNulls
                  isAnimationActive={false}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Custom legend: grouped, scrollable, and drives hover isolation. */}
      <div className="mt-3 max-h-24 overflow-y-auto border-t border-zinc-800 pt-2">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {timeseries.map((series) => (
            <button
              key={series.model}
              onMouseEnter={() => setHovered(series.model)}
              onMouseLeave={() => setHovered(null)}
              className={`flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] transition ${
                hovered !== null && hovered !== series.model
                  ? "opacity-40"
                  : "opacity-100"
              } hover:bg-zinc-800`}
              title={`${providerOf(series.model).label} · ${series.model}`}
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: colours.get(series.model) }}
              />
              <span className="text-zinc-400">{shortName(series.model)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
