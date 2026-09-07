/** Per-model summary card showing latency headline figures. */
import type { ModelStats } from "@/lib/types";
import {
  classifyHealth,
  formatMs,
  formatPercent,
  formatRelative,
  healthStyles,
} from "@/lib/format";
import { providerOf, shortName } from "@/lib/providers";

/** One labelled metric inside the card. */
function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-zinc-500">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-sm text-zinc-100" title={hint}>
        {value}
      </dd>
    </div>
  );
}

export function ModelCard({
  stats,
  colour,
}: {
  stats: ModelStats;
  colour?: string;
}) {
  const health = classifyHealth(
    stats.successRate,
    stats.latestOk,
    stats.avgLatencyMs,
  );
  const style = healthStyles[health];
  const provider = providerOf(stats.model);

  return (
    <article className="relative overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      {/* Colour bar ties the card to its line in the chart. */}
      <span
        className="absolute inset-x-0 top-0 h-0.5"
        style={{ background: colour ?? provider.colour }}
      />

      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* The namespace is shown separately so long ids stay readable. */}
          <h3
            className="truncate font-medium text-zinc-100"
            title={stats.model}
          >
            {shortName(stats.model)}
          </h3>
          <p className="text-[11px] text-zinc-500">{provider.label}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={`size-2 rounded-full ${style.dot}`} />
          <span className={`text-xs ${style.text}`}>{style.label}</span>
        </span>
      </header>

      {/* Average latency is the headline number the dashboard exists to show. */}
      <div className="mt-3">
        <div className="text-[11px] uppercase tracking-wide text-zinc-500">
          Avg response
        </div>
        <div className="font-mono text-2xl text-zinc-50">
          {formatMs(stats.avgLatencyMs)}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-zinc-800 pt-3">
        <Metric
          label="Latest"
          value={formatMs(stats.latestLatencyMs)}
          hint="Most recent probe"
        />
        <Metric
          label="p50"
          value={formatMs(stats.p50LatencyMs)}
          hint="Median latency"
        />
        <Metric
          label="p95"
          value={formatMs(stats.p95LatencyMs)}
          hint="95th percentile latency"
        />
        <Metric
          label="Min"
          value={formatMs(stats.minLatencyMs)}
          hint="Fastest successful probe"
        />
        <Metric
          label="Max"
          value={formatMs(stats.maxLatencyMs)}
          hint="Slowest successful probe"
        />
        <Metric
          label="Success"
          value={formatPercent(stats.successRate)}
          hint={`${stats.samples} probes in window`}
        />
      </dl>

      <p className="mt-2 text-[11px] text-zinc-500">
        Checked {formatRelative(stats.latestCheckedAt)} · {stats.samples} samples
      </p>

      {/* Surfacing the reason keeps a non-green badge actionable. */}
      {stats.latestError && (
        <p
          className={`mt-2 truncate border-t border-zinc-800 pt-2 font-mono text-[11px] ${
            stats.latestOk ? "text-zinc-500" : "text-rose-400/90"
          }`}
          title={stats.latestError}
        >
          {stats.latestError}
        </p>
      )}
    </article>
  );
}
