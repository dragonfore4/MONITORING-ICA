/**
 * ICA gateway client and latency prober.
 *
 * Latency is measured by actively issuing a small chat completion to each model
 * and timing the response. Two numbers are captured:
 *
 *   - **TTFT** (time to first token): elapsed time until the first visible
 *     content token arrives.
 *   - **Total latency**: elapsed time until the stream completes.
 *
 * Note on the ICA gateway specifically: although it accepts `stream: true` and
 * replies with SSE framing, measurements show it buffers the upstream response
 * and emits only 3-4 frames all at once at the end. TTFT therefore lands within
 * a few milliseconds of total latency rather than being meaningfully lower. The
 * value is still recorded for gateways that stream incrementally, but the
 * dashboard treats total latency as the primary metric.
 */
import { config } from "./config";
import type { ProbeResult } from "./types";

/** Build the auth headers, accommodating both Bearer and bare-key gateways. */
function authHeaders(): Record<string, string> {
  const value = config.icaUseBearerPrefix
    ? `Bearer ${config.icaApiKey}`
    : config.icaApiKey;
  return {
    [config.icaAuthHeader]: value,
    "Content-Type": "application/json",
  };
}

/**
 * Fetch the model list from the gateway (`GET /models`).
 *
 * Used to discover models when `ICA_MODELS` is not set explicitly.
 */
export async function listModels(): Promise<string[]> {
  const res = await fetch(`${config.icaBaseUrl}/models`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Failed to list models: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { data?: Array<{ id?: string }> };
  return (body.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => Boolean(id));
}

/**
 * Probe one model and measure its latency.
 *
 * Never throws: a failed probe is a legitimate data point (it drives the
 * success-rate metric), so all errors are captured into the returned result.
 */
export async function probeModel(model: string): Promise<ProbeResult> {
  const checkedAt = new Date().toISOString();
  const startedAt = performance.now();

  // AbortController bounds the request so one hung model cannot consume the
  // whole function's execution budget.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.probeTimeoutMs);

  let ttftMs: number | null = null;
  let statusCode: number | null = null;

  try {
    const res = await fetch(`${config.icaBaseUrl}/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      signal: controller.signal,
      cache: "no-store",
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: config.probePrompt }],
        // Generous enough that reasoning models can finish thinking and still
        // emit visible text. See config.probeMaxTokens for the rationale.
        max_tokens: config.probeMaxTokens,
        // `temperature` is deliberately omitted. Several models behind the ICA
        // gateway (e.g. claude-sonnet-5) reject any value other than 1 with an
        // HTTP 400, which would be recorded as an outage. Sampling settings do
        // not affect latency, so the parameter buys nothing here.
        stream: true,
        stream_options: { include_usage: true },
      }),
    });

    statusCode = res.status;

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        model,
        ok: false,
        latencyMs: Math.round(performance.now() - startedAt),
        ttftMs: null,
        completionTokens: null,
        statusCode,
        error: `HTTP ${res.status}: ${detail.slice(0, 300)}`,
        checkedAt,
      };
    }

    if (!res.body) {
      throw new Error("Response contained no body");
    }

    // Consume the SSE stream, recording when the first content token arrives
    // and the token usage/finish reason reported at the end.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    let sawContent = false;
    let completionTokens: number | null = null;
    let finishReason: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffered += decoder.decode(value, { stream: true });

      // SSE frames are newline-delimited; process complete lines and keep any
      // trailing partial line in the buffer.
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;

        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;

        try {
          const chunk = JSON.parse(payload) as {
            choices?: Array<{
              delta?: { content?: string };
              finish_reason?: string | null;
            }>;
            usage?: { completion_tokens?: number };
          };

          const choice = chunk.choices?.[0];
          const delta = choice?.delta?.content;
          if (!sawContent && delta) {
            sawContent = true;
            ttftMs = Math.round(performance.now() - startedAt);
          }
          if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
          }
          if (chunk.usage?.completion_tokens != null) {
            completionTokens = chunk.usage.completion_tokens;
          }
        } catch {
          // A malformed frame should not fail the probe; the timing data
          // gathered so far is still valid.
        }
      }
    }

    const latencyMs = Math.round(performance.now() - startedAt);

    /*
     * A probe counts as successful when the gateway returned a well-formed
     * stream that terminated normally, even if no visible text arrived.
     *
     * Reasoning models can consume their entire token budget on internal
     * thought and legitimately finish with `finish_reason: "length"` and an
     * empty message. That is a healthy round trip and a valid latency sample,
     * so treating "no content" as an outage would misreport those models.
     * Only a truncated/absent finish reason indicates a genuinely broken
     * response.
     */
    const ok = sawContent || finishReason !== null;

    let error: string | null = null;
    if (!ok) {
      error = "Stream ended without content or a finish reason";
    } else if (!sawContent) {
      // Surfaced as a note rather than a failure: latency is still valid.
      error = `No visible content (finish_reason: ${finishReason})`;
    }

    return {
      model,
      ok,
      latencyMs,
      ttftMs,
      completionTokens,
      statusCode,
      error,
      checkedAt,
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      model,
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
      ttftMs,
      completionTokens: null,
      statusCode,
      error: aborted
        ? `Timed out after ${config.probeTimeoutMs}ms`
        : err instanceof Error
          ? err.message
          : String(err),
      checkedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Probe every model concurrently.
 *
 * Running in parallel keeps the total execution time near that of the slowest
 * single model, which matters under Vercel's function duration limit.
 * `allSettled` is not needed because `probeModel` absorbs its own errors.
 */
export async function probeAllModels(models: string[]): Promise<ProbeResult[]> {
  return Promise.all(models.map((model) => probeModel(model)));
}
