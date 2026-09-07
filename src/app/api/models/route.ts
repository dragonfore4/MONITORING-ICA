/**
 * `GET /api/models` — the set of models being monitored.
 *
 * Returns the configured allow-list when `ICA_MODELS` is set, otherwise asks the
 * gateway. Useful for verifying credentials and connectivity during setup.
 */
import { getModels } from "@/lib/config";
import { listModels } from "@/lib/ica";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const configured = getModels();
    if (configured.length > 0) {
      return Response.json({ source: "config", models: configured });
    }

    const models = await listModels();
    return Response.json({ source: "gateway", models });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
