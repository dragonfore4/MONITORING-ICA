/**
 * Validates the aggregation SQL from src/lib/db.ts against a real Postgres
 * engine (PGlite = Postgres compiled to WASM), using the exact same statements.
 * Seeds known latencies so the expected averages/percentiles are hand-checkable.
 */
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();

await db.exec(`
  CREATE TABLE probes (
    id BIGSERIAL PRIMARY KEY,
    model TEXT NOT NULL,
    ok BOOLEAN NOT NULL,
    latency_ms INTEGER NOT NULL,
    ttft_ms INTEGER,
    completion_tokens INTEGER,
    status_code INTEGER,
    error TEXT,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX probes_model_checked_at_idx ON probes (model, checked_at DESC);
`);

// model-a: latencies 100,200,300,400 all ok  -> avg 250, p50 250
// plus one FAILED probe at 9999 which must be EXCLUDED from latency stats
// success rate = 4/5 = 0.8
await db.exec(`
  INSERT INTO probes (model, ok, latency_ms, ttft_ms, checked_at) VALUES
    ('model-a', true,  100,  50, now() - interval '40 minutes'),
    ('model-a', true,  200, 100, now() - interval '30 minutes'),
    ('model-a', true,  300, 150, now() - interval '20 minutes'),
    ('model-a', true,  400, 200, now() - interval '10 minutes'),
    ('model-a', false, 9999, NULL, now() - interval '5 minutes'),
    ('model-b', true,  1000, 500, now() - interval '10 minutes');
`);

const stats = await db.query(`
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
    MAX(checked_at) AS latest_checked_at
  FROM probes
  WHERE checked_at >= now() - MAKE_INTERVAL(hours => $1)
  GROUP BY model
  ORDER BY model
`, [24]);

console.log("=== STATS ===");
console.table(stats.rows);

const ts = await db.query(`
  SELECT
    model,
    date_bin(MAKE_INTERVAL(mins => $1), checked_at, TIMESTAMPTZ '2000-01-01') AS bucket,
    AVG(latency_ms) FILTER (WHERE ok) AS avg_latency_ms,
    COUNT(*) AS samples,
    AVG(CASE WHEN ok THEN 1.0 ELSE 0.0 END) AS success_rate
  FROM probes
  WHERE checked_at >= now() - MAKE_INTERVAL(hours => $2)
  GROUP BY model, bucket
  ORDER BY model, bucket
`, [15, 24]);

console.log("=== TIMESERIES (15min buckets) ===");
console.table(ts.rows);

// Verify the UNNEST batch insert used by insertProbeResults.
await db.query(`
  INSERT INTO probes (model, ok, latency_ms, ttft_ms, completion_tokens, status_code, error, checked_at)
  SELECT * FROM UNNEST(
    $1::text[], $2::boolean[], $3::int[], $4::int[], $5::int[], $6::int[], $7::text[], $8::timestamptz[]
  )
`, [
  ["batch-1", "batch-2"],
  [true, false],
  [111, 222],
  [11, null],
  [2, null],
  [200, 500],
  [null, "boom"],
  [new Date().toISOString(), new Date().toISOString()],
]);

const batch = await db.query(
  `SELECT model, ok, latency_ms, ttft_ms, error FROM probes WHERE model LIKE 'batch%' ORDER BY model`,
);
console.log("=== UNNEST BATCH INSERT ===");
console.table(batch.rows);

// Verify the prune statement.
await db.exec(`INSERT INTO probes (model, ok, latency_ms, checked_at)
               VALUES ('old', true, 1, now() - interval '30 days')`);
const pruned = await db.query(
  `DELETE FROM probes WHERE checked_at < now() - MAKE_INTERVAL(days => $1) RETURNING id`,
  [7],
);
console.log("=== PRUNE === deleted rows:", pruned.rows.length);

const a = stats.rows.find((r: any) => r.model === "model-a") as any;
console.log("\n=== ASSERTIONS ===");
const checks: [string, boolean, string][] = [
  ["failed probe excluded from avg", Math.round(Number(a.avg_latency_ms)) === 250, `got ${a.avg_latency_ms}, want 250`],
  ["p50 correct", Math.round(Number(a.p50_latency_ms)) === 250, `got ${a.p50_latency_ms}, want 250`],
  ["max excludes failure", Number(a.max_latency_ms) === 400, `got ${a.max_latency_ms}, want 400`],
  ["success rate 0.8", Math.abs(Number(a.success_rate) - 0.8) < 1e-6, `got ${a.success_rate}, want 0.8`],
  ["samples counts failures", Number(a.samples) === 5, `got ${a.samples}, want 5`],
  ["latest probe is the failure", a.latest_ok === false, `got ${a.latest_ok}, want false`],
  ["avg ttft ignores nulls", Math.round(Number(a.avg_ttft_ms)) === 125, `got ${a.avg_ttft_ms}, want 125`],
  ["prune removed 1 old row", pruned.rows.length === 1, `got ${pruned.rows.length}, want 1`],
];
let failed = 0;
for (const [name, pass, detail] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : `  (${detail})`}`);
  if (!pass) failed++;
}
console.log(failed === 0 ? "\nAll assertions passed." : `\n${failed} assertion(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
