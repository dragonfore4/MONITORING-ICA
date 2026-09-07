/**
 * `GET|POST /api/probe` — run one round of latency probes and store the results.
 *
 * Invoked by an external scheduler (GitHub Actions, cron-job.org, an uptime
 * monitor, ...) rather than Vercel Cron, because Vercel's Hobby plan caps cron
 * jobs at once per day, which is far too coarse for latency monitoring.
 */
import { NextRequest } from "next/server";
import { config, getModels } from "@/lib/config";
import {
  ensureSchema,
  insertProbeResults,
  pruneOldProbes,
} from "@/lib/db";
import { listModels, probeAllModels } from "@/lib/ica";

/** Probing is a side effect; it must never be cached or prerendered. */
export const dynamic = "force-dynamic";

/**
 * Probes run concurrently, so the round takes roughly as long as the slowest
 * model. Measured against the ICA gateway, the slowest healthy model returns in
 * ~55s and one model does not respond at all, so this must exceed
 * ICA_PROBE_TIMEOUT_MS (default 90s) for the per-probe timeout to be what
 * actually fires. 300s is the Hobby-plan maximum.
 */
export const maxDuration = 300;

/** Retain roughly a week of history to stay within Neon's free storage tier. */
const RETENTION_DAYS = 1;

/**
 * Compare the caller's secret against `CRON_SECRET`.
 *
 * Accepts either `Authorization: Bearer <secret>` or `?secret=` so the endpoint
 * works with schedulers that cannot set custom headers.
 *
 * Returns a discriminated result rather than throwing, so a misconfigured
 * `CRON_SECRET` produces a clear 500 instead of an empty crash.
 */
function checkAuth(
  req: NextRequest,
): { ok: true } | { ok: false; status: number; error: string } {
  let expected: string;
  try {
    expected = config.cronSecret;
  } catch {
    return {
      ok: false,
      status: 500,
      error: "CRON_SECRET is not configured on the server.",
    };
  }

  const header = req.headers.get("authorization");
  if (header === `Bearer ${expected}`) return { ok: true };
  if (req.nextUrl.searchParams.get("secret") === expected) return { ok: true };

  return { ok: false, status: 401, error: "Unauthorised" };
}

async function handle(req: NextRequest) {
  const auth = checkAuth(req);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  try {
    await ensureSchema();

    // Prefer the explicit allow-list; fall back to gateway discovery so the app
    // still works before ICA_MODELS is configured.
    let models = getModels();
    let discovered = false;
    if (models.length === 0) {
      models = await listModels();
      discovered = true;
    }

    if (models.length === 0) {
      return Response.json(
        { error: "No models configured. Set ICA_MODELS." },
        { status: 400 },
      );
    }

    const results = await probeAllModels(models);
    await insertProbeResults(results);
    const pruned = await pruneOldProbes(RETENTION_DAYS);

    return Response.json({
      probed: results.length,
      discovered,
      pruned,
      results: results.map((r) => ({
        model: r.model,
        ok: r.ok,
        latencyMs: r.latencyMs,
        ttftMs: r.ttftMs,
        error: r.error,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
