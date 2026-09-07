/** Presentation helpers shared by the dashboard components. */

/** Format a millisecond duration for display, or an em dash when unknown. */
export function formatMs(value: number | null): string {
  if (value === null) return "—";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

/** Format a 0..1 ratio as a percentage. */
export function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

/** Human-readable "time ago" for a timestamp. */
export function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const deltaMs = Date.now() - new Date(iso).getTime();
  const seconds = Math.round(deltaMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Short clock label for chart axes. */
export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Health classification driving the status colour.
 *
 * Considers both reliability and speed. Latency matters independently: a model
 * that answers every probe but takes a minute to do so is not healthy, and
 * grading on success rate alone would show it as green.
 *
 * Thresholds are tuned for LLM gateways, where multi-second responses are
 * normal, so they are deliberately loose.
 */
export type Health = "healthy" | "degraded" | "down" | "unknown";

/** Above this average latency a model is considered degraded. */
export const DEGRADED_LATENCY_MS = 10_000;

/** Above this average latency a model is effectively unusable. */
export const UNUSABLE_LATENCY_MS = 30_000;

export function classifyHealth(
  successRate: number,
  latestOk: boolean | null,
  avgLatencyMs: number | null = null,
): Health {
  if (latestOk === null) return "unknown";

  // Reliability problems take precedence over speed.
  if (!latestOk && successRate < 0.5) return "down";
  if (successRate < 0.95) return "degraded";

  // Responding reliably but far too slowly to be usable.
  if (avgLatencyMs !== null && avgLatencyMs >= UNUSABLE_LATENCY_MS) return "down";
  if (avgLatencyMs !== null && avgLatencyMs >= DEGRADED_LATENCY_MS) return "degraded";

  return "healthy";
}

/** Tailwind classes for each health state. */
export const healthStyles: Record<Health, { dot: string; text: string; label: string }> = {
  healthy: { dot: "bg-emerald-500", text: "text-emerald-400", label: "Healthy" },
  degraded: { dot: "bg-amber-500", text: "text-amber-400", label: "Degraded" },
  down: { dot: "bg-rose-500", text: "text-rose-400", label: "Down" },
  unknown: { dot: "bg-zinc-500", text: "text-zinc-400", label: "No data" },
};
