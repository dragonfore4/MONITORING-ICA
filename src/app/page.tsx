"use client";

/**
 * ICA monitoring dashboard.
 *
 * Polls `/api/metrics` and renders per-model latency. With ~19 models the raw
 * list is hard to read, so sorting, provider filtering and grouping are applied
 * client-side; the API always returns the full window and the view derives from
 * it, which keeps interactions instant.
 */
import { useEffect, useMemo, useState } from "react";
import { LatencyChart } from "@/components/latency-chart";
import { ModelCard } from "@/components/model-card";
import {
  DashboardControls,
  type GroupMode,
  type SortKey,
} from "@/components/dashboard-controls";
import type { MetricsResponse, ModelStats } from "@/lib/types";
import {
  buildColourMap,
  presentProviders,
  providerOf,
  PROVIDERS,
} from "@/lib/providers";
import { formatMs } from "@/lib/format";

/** Dashboard refresh cadence. */
const REFRESH_MS = 30_000;

/** Order models according to the selected sort key. */
function sortStats(stats: ModelStats[], sort: SortKey): ModelStats[] {
  const out = [...stats];
  // Models with no successful probe have no latency; they sort last rather than
  // appearing fastest.
  const nullsLast = (v: number | null) => (v === null ? Number.MAX_SAFE_INTEGER : v);

  switch (sort) {
    case "latency":
      return out.sort((a, b) => nullsLast(a.avgLatencyMs) - nullsLast(b.avgLatencyMs));
    case "p95":
      return out.sort((a, b) => nullsLast(a.p95LatencyMs) - nullsLast(b.p95LatencyMs));
    case "success":
      // Reliability first, then speed as the tie-breaker.
      return out.sort(
        (a, b) =>
          b.successRate - a.successRate ||
          nullsLast(a.avgLatencyMs) - nullsLast(b.avgLatencyMs),
      );
    case "name":
      return out.sort((a, b) => a.model.localeCompare(b.model));
    case "provider":
      return out.sort(
        (a, b) =>
          providerOf(a.model).label.localeCompare(providerOf(b.model).label) ||
          nullsLast(a.avgLatencyMs) - nullsLast(b.avgLatencyMs),
      );
  }
}

export default function DashboardPage() {
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [hours, setHours] = useState(24);
  const [sort, setSort] = useState<SortKey>("latency");
  const [group, setGroup] = useState<GroupMode>("provider");
  const [logScale, setLogScale] = useState(true);
  /** Empty set means "all providers". */
  const [activeProviders, setActiveProviders] = useState<Set<string>>(new Set());

  /*
   * Fetching lives in the effect and only writes state from async
   * continuations. The `cancelled` flag discards responses from a superseded
   * window so a slow request cannot overwrite fresher data.
   */
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/metrics?hours=${hours}`, {
          cache: "no-store",
        });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setData(body as MetricsResponse);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [hours]);

  const allModels = useMemo(
    () => (data?.stats ?? []).map((s) => s.model),
    [data],
  );

  // Colours are keyed off the complete model list so a model keeps its colour
  // when filters change.
  const colours = useMemo(() => buildColourMap(allModels), [allModels]);
  const providers = useMemo(() => presentProviders(allModels), [allModels]);

  const showAll = activeProviders.size === 0;
  const visible = useMemo(() => {
    const filtered = (data?.stats ?? []).filter(
      (s) => showAll || activeProviders.has(providerOf(s.model).id),
    );
    return sortStats(filtered, sort);
  }, [data, activeProviders, showAll, sort]);

  const visibleModels = useMemo(
    () => new Set(visible.map((s) => s.model)),
    [visible],
  );

  // Chart mirrors the card filter so both views stay in sync.
  const visibleSeries = useMemo(
    () => (data?.timeseries ?? []).filter((t) => visibleModels.has(t.model)),
    [data, visibleModels],
  );

  function toggleProvider(id: string) {
    setActiveProviders((prev) => {
      const next = new Set(prev);
      // First click from "all" isolates the clicked provider.
      if (next.size === 0) return new Set([id]);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const fastest = visible.find((s) => s.avgLatencyMs !== null);

  /** Cards grouped by provider, or a single unlabelled group when flat. */
  const groups = useMemo(() => {
    if (group === "none") return [{ label: null, items: visible }];
    const byProvider = new Map<string, ModelStats[]>();
    for (const s of visible) {
      const id = providerOf(s.model).id;
      byProvider.set(id, [...(byProvider.get(id) ?? []), s]);
    }
    return PROVIDERS.filter((p) => byProvider.has(p.id)).map((p) => ({
      label: p.label,
      colour: p.colour,
      items: byProvider.get(p.id)!,
    }));
  }, [visible, group]);

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <header>
        <h1 className="text-2xl font-semibold text-zinc-50">
          ICA Model Monitoring
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Latency and average response time per model.
          {data && (
            <span className="ml-1 text-zinc-500">
              Updated {new Date(data.generatedAt).toLocaleTimeString()}.
            </span>
          )}
        </p>
      </header>

      {data && data.stats.length > 0 && (
        <div className="mt-6">
          <DashboardControls
            hours={hours}
            onHours={setHours}
            sort={sort}
            onSort={setSort}
            group={group}
            onGroup={setGroup}
            logScale={logScale}
            onLogScale={setLogScale}
            providers={providers}
            activeProviders={activeProviders}
            onToggleProvider={toggleProvider}
            onAllProviders={() => setActiveProviders(new Set())}
          />
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-md border border-rose-900 bg-rose-950/50 p-4 text-sm text-rose-300">
          <p className="font-medium">Could not load metrics</p>
          <p className="mt-1 font-mono text-xs">{error}</p>
          <p className="mt-2 text-rose-400/80">
            Check that DATABASE_URL is set and that /api/probe has run at least
            once.
          </p>
        </div>
      )}

      {loading && !data && (
        <p className="mt-10 text-sm text-zinc-500">Loading metrics…</p>
      )}

      {data && data.stats.length === 0 && !error && (
        <div className="mt-6 rounded-md border border-zinc-800 bg-zinc-900/60 p-6 text-sm text-zinc-400">
          <p className="font-medium text-zinc-200">No data yet</p>
          <p className="mt-1">
            Trigger the first probe to start collecting latency data:
          </p>
          <pre className="mt-3 overflow-x-auto rounded bg-black/50 p-3 font-mono text-xs text-zinc-300">
            curl -X POST &quot;$SITE_URL/api/probe?secret=$CRON_SECRET&quot;
          </pre>
        </div>
      )}

      {data && data.stats.length > 0 && (
        <>
          <p className="mt-5 text-sm text-zinc-400">
            Showing{" "}
            <span className="text-zinc-200">{visible.length}</span> of{" "}
            {data.stats.length} models.
            {fastest && (
              <>
                {" "}
                Fastest:{" "}
                <span className="font-mono text-emerald-400">
                  {fastest.model}
                </span>{" "}
                at {formatMs(fastest.avgLatencyMs)}.
              </>
            )}
          </p>

          <section className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="text-sm font-medium text-zinc-200">
                Average latency over time
              </h2>
              <span className="text-[11px] text-zinc-500">
                {logScale ? "Log scale" : "Linear scale"} · hover a name to
                isolate
              </span>
            </div>
            <LatencyChart
              timeseries={visibleSeries}
              colours={colours}
              logScale={logScale}
            />
          </section>

          {groups.map((g) => (
            <section key={g.label ?? "all"} className="mt-8">
              {g.label && (
                <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-300">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ background: (g as { colour: string }).colour }}
                  />
                  {g.label}
                  <span className="text-zinc-500">({g.items.length})</span>
                </h2>
              )}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {g.items.map((stats) => (
                  <ModelCard
                    key={stats.model}
                    stats={stats}
                    colour={colours.get(stats.model)}
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
