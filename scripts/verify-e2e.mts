/**
 * End-to-end pipeline verification against the real ICA gateway.
 *
 * Runs the genuine prober from src/lib/ica.ts, then feeds its results through
 * the exact SQL from src/lib/db.ts executed on a real Postgres engine (PGlite),
 * and finally renders what the dashboard would display.
 *
 * This exercises every stage except the Neon HTTP transport, whose array
 * parameter encoding is covered by scripts/verify-batch-insert.mts.
 */
import { PGlite } from "@electric-sql/pglite";
import { probeAllModels } from "../src/lib/ica";
import { getModels } from "../src/lib/config";
import { formatMs, formatPercent, classifyHealth } from "../src/lib/format";

const db = new PGlite();

// Schema identical to ensureSchema().
await db.exec(`
  CREATE TABLE probes (
    id                BIGSERIAL PRIMARY KEY,
    model             TEXT        NOT NULL,
    ok                BOOLEAN     NOT NULL,
    latency_ms        INTEGER     NOT NULL,
    ttft_ms           INTEGER,
    completion_tokens INTEGER,
    status_code       INTEGER,
    error             TEXT,
    checked_at        TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX probes_model_checked_at_idx ON probes (model, checked_at DESC);
`);

const models = getModels();
console.log(`Probing ${models.length} models: ${models.join(", ")}\n`);

// Two rounds, so averages aggregate more than one sample per model.
for (const round of [1, 2]) {
  const t0 = Date.now();
  const results = await probeAllModels(models);
  console.log(`Round ${round} finished in ${Date.now() - t0}ms`);

  for (const r of results) {
    await db.query(
      `INSERT INTO probes (model, ok, latency_ms, ttft_ms, completion_tokens, status_code, error, checked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        r.model,
        r.ok,
        r.latencyMs,
        r.ttftMs,
        r.completionTokens,
        r.statusCode,
        r.error,
        r.checkedAt,
      ],
    );
  }
  console.table(
    results.map((r) => ({
      model: r.model,
      ok: r.ok,
      latency: r.latencyMs,
      ttft: r.ttftMs,
      tokens: r.completionTokens,
      note: r.error?.slice(0, 46) ?? "",
    })),
  );
}

// Exact aggregation query from getModelStats().
const stats = await db.query<Record<string, string | number | boolean | null>>(`
  SELECT
    model,
    COUNT(*) AS samples,
    AVG(latency_ms) FILTER (WHERE ok) AS avg_latency_ms,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE ok) AS p50_latency_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE ok) AS p95_latency_ms,
    MIN(latency_ms) FILTER (WHERE ok) AS min_latency_ms,
    MAX(latency_ms) FILTER (WHERE ok) AS max_latency_ms,
    AVG(ttft_ms) FILTER (WHERE ok AND ttft_ms IS NOT NULL) AS avg_ttft_ms,
    AVG(CASE WHEN ok THEN 1.0 ELSE 0.0 END) AS success_rate,
    (ARRAY_AGG(latency_ms ORDER BY checked_at DESC))[1] AS latest_latency_ms,
    (ARRAY_AGG(ok ORDER BY checked_at DESC))[1] AS latest_ok,
    (ARRAY_AGG(error ORDER BY checked_at DESC))[1] AS latest_error,
    MAX(checked_at) AS latest_checked_at
  FROM probes
  WHERE checked_at >= now() - MAKE_INTERVAL(hours => 24)
  GROUP BY model
  ORDER BY AVG(latency_ms) FILTER (WHERE ok) NULLS LAST
`);

console.log("\n=== DASHBOARD RENDER (fastest first) ===");
console.table(
  stats.rows.map((r) => {
    const successRate = Number(r.success_rate);
    const avg =
      r.avg_latency_ms === null ? null : Math.round(Number(r.avg_latency_ms));
    const health = classifyHealth(successRate, r.latest_ok as boolean | null, avg);
    return {
      model: r.model as string,
      status: health,
      "avg response": formatMs(avg),
      p50: formatMs(r.p50_latency_ms === null ? null : Math.round(Number(r.p50_latency_ms))),
      p95: formatMs(r.p95_latency_ms === null ? null : Math.round(Number(r.p95_latency_ms))),
      success: formatPercent(successRate),
      samples: Number(r.samples),
      note: ((r.latest_error as string | null) ?? "").slice(0, 34),
    };
  }),
);

const healthy = stats.rows.filter((r) => Number(r.success_rate) === 1).length;
console.log(`\n${healthy}/${stats.rows.length} models fully healthy.`);
