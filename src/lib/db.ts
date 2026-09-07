/**
 * Neon Postgres data access layer.
 *
 * Vercel functions are ephemeral and may run concurrently, so all state lives in
 * Postgres rather than on local disk. The Neon serverless driver speaks HTTP,
 * which avoids the connection-pool exhaustion that plagues TCP clients in
 * serverless environments.
 */
import { neon } from "@neondatabase/serverless";
import { config } from "./config";
import type {
  ModelStats,
  ModelTimeseries,
  ProbeResult,
  TimeseriesPoint,
} from "./types";

/** Lazily constructed SQL tag, so importing this module never throws. */
let cachedSql: ReturnType<typeof neon> | null = null;

function sql() {
  if (!cachedSql) {
    cachedSql = neon(config.databaseUrl);
  }
  return cachedSql;
}

/**
 * Create the schema if it does not exist.
 *
 * Cheap enough to call on demand: `CREATE TABLE IF NOT EXISTS` is a no-op once
 * the table is present. Keeping it in code avoids a separate migration step for
 * a project this size.
 */
export async function ensureSchema(): Promise<void> {
  const db = sql();
  await db`
    CREATE TABLE IF NOT EXISTS probes (
      id                BIGSERIAL PRIMARY KEY,
      model             TEXT        NOT NULL,
      ok                BOOLEAN     NOT NULL,
      latency_ms        INTEGER     NOT NULL,
      ttft_ms           INTEGER,
      completion_tokens INTEGER,
      status_code       INTEGER,
      error             TEXT,
      checked_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Supports the "recent probes for a model" access pattern behind every query
  // in this module.
  await db`
    CREATE INDEX IF NOT EXISTS probes_model_checked_at_idx
      ON probes (model, checked_at DESC)
  `;
}

/** Persist a batch of probe results in a single round trip. */
export async function insertProbeResults(
  results: ProbeResult[],
): Promise<void> {
  if (results.length === 0) return;
  const db = sql();

  // UNNEST turns parallel arrays into rows, so one statement inserts the whole
  // batch without building dynamic placeholder lists.
  await db`
    INSERT INTO probes (
      model, ok, latency_ms, ttft_ms, completion_tokens,
      status_code, error, checked_at
    )
    SELECT * FROM UNNEST(
      ${results.map((r) => r.model)}::text[],
      ${results.map((r) => r.ok)}::boolean[],
      ${results.map((r) => r.latencyMs)}::int[],
      ${results.map((r) => r.ttftMs)}::int[],
      ${results.map((r) => r.completionTokens)}::int[],
      ${results.map((r) => r.statusCode)}::int[],
      ${results.map((r) => r.error)}::text[],
      ${results.map((r) => r.checkedAt)}::timestamptz[]
    )
  `;
}

/** Shape of the aggregate query result, before camel-casing. */
interface StatsRow {
  model: string;
  samples: string;
  avg_latency_ms: string | null;
  p50_latency_ms: string | null;
  p95_latency_ms: string | null;
  min_latency_ms: number | null;
  max_latency_ms: number | null;
  avg_ttft_ms: string | null;
  success_rate: string;
  latest_latency_ms: number | null;
  latest_ok: boolean | null;
  latest_checked_at: string | null;
  latest_error: string | null;
}

/** Coerce a Postgres numeric (returned as string) to a rounded number. */
function num(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

/**
 * Aggregate latency statistics per model over the trailing `windowHours`.
 *
 * Latency percentiles intentionally consider only successful probes: a failed
 * request's duration reflects a timeout or error path, not model speed, and
 * mixing the two would distort the averages. Success rate, by contrast, is
 * computed over all probes.
 */
export async function getModelStats(windowHours: number): Promise<ModelStats[]> {
  const db = sql();
  const rows = (await db`
    SELECT
      model,
      COUNT(*)                                              AS samples,
      AVG(latency_ms)    FILTER (WHERE ok)                   AS avg_latency_ms,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms)
        FILTER (WHERE ok)                                    AS p50_latency_ms,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)
        FILTER (WHERE ok)                                    AS p95_latency_ms,
      MIN(latency_ms)    FILTER (WHERE ok)                   AS min_latency_ms,
      MAX(latency_ms)    FILTER (WHERE ok)                   AS max_latency_ms,
      AVG(ttft_ms)       FILTER (WHERE ok AND ttft_ms IS NOT NULL)
                                                             AS avg_ttft_ms,
      AVG(CASE WHEN ok THEN 1.0 ELSE 0.0 END)               AS success_rate,
      (ARRAY_AGG(latency_ms ORDER BY checked_at DESC))[1]    AS latest_latency_ms,
      (ARRAY_AGG(ok         ORDER BY checked_at DESC))[1]    AS latest_ok,
      (ARRAY_AGG(error      ORDER BY checked_at DESC))[1]    AS latest_error,
      MAX(checked_at)                                        AS latest_checked_at
    FROM probes
    WHERE checked_at >= now() - MAKE_INTERVAL(hours => ${windowHours})
    GROUP BY model
    ORDER BY model
  `) as unknown as StatsRow[];

  return rows.map((r) => ({
    model: r.model,
    samples: Number(r.samples),
    avgLatencyMs: num(r.avg_latency_ms),
    p50LatencyMs: num(r.p50_latency_ms),
    p95LatencyMs: num(r.p95_latency_ms),
    minLatencyMs: num(r.min_latency_ms),
    maxLatencyMs: num(r.max_latency_ms),
    avgTtftMs: num(r.avg_ttft_ms),
    successRate: Number(r.success_rate),
    latestLatencyMs: num(r.latest_latency_ms),
    latestOk: r.latest_ok,
    latestCheckedAt: r.latest_checked_at,
    latestError: r.latest_error,
  }));
}

interface TimeseriesRow {
  model: string;
  bucket: string;
  avg_latency_ms: string | null;
  samples: string;
  success_rate: string;
}

/**
 * Bucketed latency history per model, for charting.
 *
 * `bucketMinutes` controls granularity; `date_bin` groups probes into fixed
 * intervals so the chart stays readable regardless of probe frequency.
 */
export async function getModelTimeseries(
  windowHours: number,
  bucketMinutes: number,
): Promise<ModelTimeseries[]> {
  const db = sql();
  const rows = (await db`
    SELECT
      model,
      date_bin(
        MAKE_INTERVAL(mins => ${bucketMinutes}),
        checked_at,
        TIMESTAMPTZ '2000-01-01'
      )                                        AS bucket,
      AVG(latency_ms) FILTER (WHERE ok)        AS avg_latency_ms,
      COUNT(*)                                 AS samples,
      AVG(CASE WHEN ok THEN 1.0 ELSE 0.0 END)  AS success_rate
    FROM probes
    WHERE checked_at >= now() - MAKE_INTERVAL(hours => ${windowHours})
    GROUP BY model, bucket
    ORDER BY model, bucket
  `) as unknown as TimeseriesRow[];

  // Collapse the flat rows into one series per model, preserving bucket order.
  const byModel = new Map<string, TimeseriesPoint[]>();
  for (const row of rows) {
    const points = byModel.get(row.model) ?? [];
    points.push({
      bucket: row.bucket,
      avgLatencyMs: num(row.avg_latency_ms),
      samples: Number(row.samples),
      successRate: Number(row.success_rate),
    });
    byModel.set(row.model, points);
  }

  return [...byModel.entries()].map(([model, points]) => ({ model, points }));
}

/** Most recent probes across all models, newest first. */
export async function getRecentProbes(limit: number): Promise<ProbeResult[]> {
  const db = sql();
  const rows = (await db`
    SELECT model, ok, latency_ms, ttft_ms, completion_tokens,
           status_code, error, checked_at
    FROM probes
    ORDER BY checked_at DESC
    LIMIT ${limit}
  `) as unknown as Array<{
    model: string;
    ok: boolean;
    latency_ms: number;
    ttft_ms: number | null;
    completion_tokens: number | null;
    status_code: number | null;
    error: string | null;
    checked_at: string;
  }>;

  return rows.map((r) => ({
    model: r.model,
    ok: r.ok,
    latencyMs: r.latency_ms,
    ttftMs: r.ttft_ms,
    completionTokens: r.completion_tokens,
    statusCode: r.status_code,
    error: r.error,
    checkedAt: r.checked_at,
  }));
}

/**
 * Delete probes older than `retentionDays`.
 *
 * Neon's free tier has a storage cap, and unbounded probe history would grow
 * without limit. Called from the probe endpoint so cleanup needs no extra cron.
 */
export async function pruneOldProbes(retentionDays: number): Promise<number> {
  const db = sql();
  const rows = (await db`
    DELETE FROM probes
    WHERE checked_at < now() - MAKE_INTERVAL(days => ${retentionDays})
    RETURNING id
  `) as unknown as Array<{ id: string }>;
  return rows.length;
}
