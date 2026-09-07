/**
 * `GET /api/metrics` — aggregated latency statistics for the dashboard.
 *
 * Query parameters:
 *   - `hours`  trailing window to aggregate over (default 24, max 720)
 *   - `bucket` chart bucket size in minutes (default derived from `hours`)
 */
import { NextRequest } from "next/server";
import { ensureSchema, getModelStats, getModelTimeseries } from "@/lib/db";
import type { MetricsResponse } from "@/lib/types";

/** Always reflects the latest probes, so no caching. */
export const dynamic = "force-dynamic";

/** Clamp a numeric query param into a sane range. */
function clamp(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/**
 * Choose a chart bucket size that yields a readable number of points.
 *
 * Without this, a 30-day window at one probe per minute would return ~43k
 * points and overwhelm both the payload and the chart.
 */
function defaultBucketMinutes(hours: number): number {
  if (hours <= 2) return 1;
  if (hours <= 6) return 5;
  if (hours <= 24) return 15;
  if (hours <= 72) return 60;
  return 180;
}

export async function GET(req: NextRequest) {
  try {
    await ensureSchema();

    const hours = clamp(req.nextUrl.searchParams.get("hours"), 24, 1, 720);
    const bucketMinutes = clamp(
      req.nextUrl.searchParams.get("bucket"),
      defaultBucketMinutes(hours),
      1,
      1440,
    );

    // Independent queries, so run them concurrently.
    const [stats, timeseries] = await Promise.all([
      getModelStats(hours),
      getModelTimeseries(hours, bucketMinutes),
    ]);

    const payload: MetricsResponse = {
      windowHours: hours,
      stats,
      timeseries,
      generatedAt: new Date().toISOString(),
    };

    return Response.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
