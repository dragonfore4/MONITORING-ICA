/**
 * Centralised environment configuration.
 *
 * Every value the app needs from the environment is read here so that a missing
 * variable fails loudly at the edge of the system rather than deep inside a
 * request handler.
 */

/** Read a required env var, throwing a helpful error when it is absent. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

/** Read an optional env var with a fallback. */
function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

/**
 * The ICA models to probe.
 *
 * Provided as a comma-separated list so it can be changed on Vercel without a
 * code deploy, e.g. `ICA_MODELS=gpt-4o,claude-3-5-sonnet,llama-3.1-70b`.
 */
export function getModels(): string[] {
  return optional("ICA_MODELS", "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

export const config = {
  /** Base URL of the ICA gateway, e.g. `https://ica.example.com/v1`. */
  get icaBaseUrl() {
    return required("ICA_BASE_URL").replace(/\/$/, "");
  },
  get icaApiKey() {
    return required("ICA_API_KEY");
  },
  /**
   * Header used to send credentials.
   *
   * The IBM ICA gateway authenticates with a bare `X-API-Key` and rejects
   * `Authorization: Bearer`, so that is the default. Override for gateways that
   * follow the OpenAI convention.
   */
  get icaAuthHeader() {
    return optional("ICA_AUTH_HEADER", "X-API-Key");
  },
  /** Set to `true` when the gateway expects `Authorization: Bearer <key>`. */
  get icaUseBearerPrefix() {
    return optional("ICA_USE_BEARER_PREFIX", "false") === "true";
  },
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  /** Shared secret guarding the probe endpoint against public invocation. */
  get cronSecret() {
    return required("CRON_SECRET");
  },
  /** Prompt sent to each model. Deliberately tiny to keep cost and latency low. */
  get probePrompt() {
    return optional("ICA_PROBE_PROMPT", "Reply with the single word: ok");
  },
  /**
   * Output token budget for each probe.
   *
   * Must stay well above the reasoning budget of thinking models. Measured
   * against the ICA gateway, `gemini-*` models spend 50-105 tokens on internal
   * reasoning before emitting any visible text; a low cap truncates them at
   * `finish_reason: "length"` with an empty reply, which would be
   * misreported as an outage. 512 leaves ample headroom, and because the
   * models are asked for a single word the extra budget is rarely consumed.
   */
  get probeMaxTokens() {
    return Number(optional("ICA_PROBE_MAX_TOKENS", "512"));
  },
  /**
   * Per-request timeout in milliseconds.
   *
   * Sized from observed worst-case behaviour: the slowest healthy model on the
   * ICA gateway returned in ~55s. A tight timeout would report slow-but-working
   * models as down.
   */
  get probeTimeoutMs() {
    return Number(optional("ICA_PROBE_TIMEOUT_MS", "90000"));
  },
} as const;
