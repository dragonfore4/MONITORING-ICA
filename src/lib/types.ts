/** Shared domain types for the ICA monitoring dashboard. */

/** Outcome of a single probe against a single model. */
export interface ProbeResult {
  model: string;
  /** True when the model returned a usable completion. */
  ok: boolean;
  /** Total wall-clock time for the request, in milliseconds. */
  latencyMs: number;
  /**
   * Time to first token, in milliseconds. Only available for streamed probes;
   * `null` when streaming was not used or no token arrived.
   */
  ttftMs: number | null;
  /** Completion tokens reported by the gateway, when available. */
  completionTokens: number | null;
  /** HTTP status returned by the gateway. */
  statusCode: number | null;
  /** Error message when `ok` is false. */
  error: string | null;
  /** When the probe started. */
  checkedAt: string;
}

/** Rolled-up statistics for one model over a time window. */
export interface ModelStats {
  model: string;
  /** Number of probes in the window. */
  samples: number;
  /** Mean latency across successful probes, in milliseconds. */
  avgLatencyMs: number | null;
  /** Median latency, in milliseconds. */
  p50LatencyMs: number | null;
  /** 95th percentile latency, in milliseconds. */
  p95LatencyMs: number | null;
  /** Fastest successful probe. */
  minLatencyMs: number | null;
  /** Slowest successful probe. */
  maxLatencyMs: number | null;
  /** Mean time-to-first-token across probes that reported it. */
  avgTtftMs: number | null;
  /** Fraction of probes that succeeded, 0..1. */
  successRate: number;
  /** Latency of the most recent probe. */
  latestLatencyMs: number | null;
  /** Whether the most recent probe succeeded. */
  latestOk: boolean | null;
  /** Timestamp of the most recent probe. */
  latestCheckedAt: string | null;
  /**
   * Error or note from the most recent probe, if any.
   *
   * Present even on success for informational cases such as a reasoning model
   * that returned no visible text.
   */
  latestError: string | null;
}

/** A single point in a model's latency time series. */
export interface TimeseriesPoint {
  /** Start of the bucket, ISO 8601. */
  bucket: string;
  avgLatencyMs: number | null;
  samples: number;
  successRate: number;
}

/** Time series for one model. */
export interface ModelTimeseries {
  model: string;
  points: TimeseriesPoint[];
}

/** Payload returned by `GET /api/metrics`. */
export interface MetricsResponse {
  /** Window size used for the aggregates, in hours. */
  windowHours: number;
  stats: ModelStats[];
  timeseries: ModelTimeseries[];
  generatedAt: string;
}
