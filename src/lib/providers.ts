/**
 * Provider grouping for ICA model identifiers.
 *
 * The gateway exposes models from several vendors under inconsistent naming
 * schemes: some are namespaced (`ibm/granite-4-h-small`,
 * `meta-llama/llama-3-3-70b-instruct`) and some are bare (`gpt-5.1`,
 * `claude-opus-5`). Grouping by vendor makes 19 models legible and lets the
 * dashboard filter to one family at a time.
 */

export interface Provider {
  id: string;
  label: string;
  /** Base colour for the family; individual models get shades of it. */
  colour: string;
}

export const PROVIDERS: Provider[] = [
  { id: "anthropic", label: "Anthropic", colour: "#f59e0b" },
  { id: "openai", label: "OpenAI", colour: "#10b981" },
  { id: "google", label: "Google", colour: "#3b82f6" },
  { id: "meta", label: "Meta", colour: "#8b5cf6" },
  { id: "mistral", label: "Mistral", colour: "#ef4444" },
  { id: "ibm", label: "IBM", colour: "#06b6d4" },
  { id: "other", label: "Other", colour: "#94a3b8" },
];

const PROVIDER_BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

/**
 * Infer the vendor from a model identifier.
 *
 * Matching is ordered most-specific-first and keys off both namespace prefixes
 * and model-name conventions, so it survives new releases within a family
 * (a future `claude-opus-6` still resolves to Anthropic).
 */
export function providerOf(model: string): Provider {
  const m = model.toLowerCase();

  if (m.startsWith("ibm/") || m.includes("granite")) return PROVIDER_BY_ID.get("ibm")!;
  if (m.startsWith("meta-llama/") || m.includes("llama")) return PROVIDER_BY_ID.get("meta")!;
  if (m.includes("claude") || m.startsWith("anthropic")) return PROVIDER_BY_ID.get("anthropic")!;
  if (m.includes("gpt") || m.startsWith("o1") || m.startsWith("o3")) return PROVIDER_BY_ID.get("openai")!;
  // Gemini and Gemma are both Google families.
  if (m.includes("gemini") || m.includes("gemma")) return PROVIDER_BY_ID.get("google")!;
  if (m.includes("mistral") || m.includes("mixtral")) return PROVIDER_BY_ID.get("mistral")!;

  return PROVIDER_BY_ID.get("other")!;
}

/**
 * Distinct line colour for a model, derived from its provider's base hue.
 *
 * Models in the same family stay visually related while remaining
 * distinguishable, which is what makes a 19-series chart readable.
 */
export function modelColour(model: string, indexWithinProvider: number): string {
  const base = providerOf(model).colour;
  if (indexWithinProvider === 0) return base;

  // Walk lightness in fixed steps so sibling models separate predictably.
  const shades = [0, 0.22, -0.18, 0.42, -0.34, 0.6];
  const amount = shades[indexWithinProvider % shades.length];
  return shiftLightness(base, amount);
}

/** Lighten (positive) or darken (negative) a hex colour by a 0..1 ratio. */
function shiftLightness(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;

  if (amount >= 0) {
    r = Math.round(r + (255 - r) * amount);
    g = Math.round(g + (255 - g) * amount);
    b = Math.round(b + (255 - b) * amount);
  } else {
    const k = 1 + amount;
    r = Math.round(r * k);
    g = Math.round(g * k);
    b = Math.round(b * k);
  }
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * Assign a stable colour to every model, numbering within each provider.
 *
 * Callers pass the full model list once so colours stay consistent regardless
 * of the current sort order or filter.
 */
export function buildColourMap(models: string[]): Map<string, string> {
  const seen = new Map<string, number>();
  const out = new Map<string, string>();

  for (const model of [...models].sort()) {
    const pid = providerOf(model).id;
    const i = seen.get(pid) ?? 0;
    seen.set(pid, i + 1);
    out.set(model, modelColour(model, i));
  }
  return out;
}

/** Providers actually present in the given models, in canonical order. */
export function presentProviders(models: string[]): Provider[] {
  const ids = new Set(models.map((m) => providerOf(m).id));
  return PROVIDERS.filter((p) => ids.has(p.id));
}

/** Strip a vendor namespace for compact display (`ibm/granite-4` -> `granite-4`). */
export function shortName(model: string): string {
  const slash = model.indexOf("/");
  return slash === -1 ? model : model.slice(slash + 1);
}
