/**
 * models.dev api.json -> ModelsRegistry transform (neuralwatt provider only).
 * Pure, vscode-free. Mirrors the bundled data/models-registry.json shape exactly:
 * { version, generatedAt, source, models: Record<slug, RegistryModel> }.
 */
import type { ModelsRegistry, RegistryModel } from "./flex";
import { slugify } from "./registry";

export const REGISTRY_TRANSFORM_SOURCE = "models.dev api.json";

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function finiteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/**
 * Parsed models.dev api.json -> ModelsRegistry (neuralwatt provider only).
 * Keys every entry by slugify(modelId) — modelIds are already board-slug-shaped,
 * which kills the qwen duplicate-slug bug (name "Qwen3.8 27B" slugifies
 * differently than modelId "qwen-3.8-27b").
 * Skips entries lacking finite numeric cost.input + cost.output.
 * Returns null when the neuralwatt provider or its models record is
 * absent/invalid (caller keeps last-known registry and persists nothing).
 */
export function transformModelsDevRegistry(api: unknown, generatedAt?: string): ModelsRegistry | null {
  if (!isRecord(api)) return null;
  const provider = api["neuralwatt"];
  if (!isRecord(provider)) return null;
  const models = provider["models"];
  if (!isRecord(models)) return null;

  const out: Record<string, RegistryModel> = {};
  for (const [modelId, entry] of Object.entries(models)) {
    if (!isRecord(entry)) continue;
    const cost = entry["cost"];
    if (!isRecord(cost)) continue;
    if (!finiteNumber(cost["input"]) || !finiteNumber(cost["output"])) continue;
    const cacheRead = finiteNumber(cost["cache_read"]) ? (cost["cache_read"] as number) : null;

    const slug = slugify(String(modelId));
    const limit = isRecord(entry["limit"]) ? entry["limit"] : null;
    const contextRaw = limit?.["context"];
    const context = finiteNumber(contextRaw) ? (contextRaw as number) : null;

    out[slug] = {
      id: typeof entry["id"] === "string" ? (entry["id"] as string) : String(modelId),
      name: typeof entry["name"] === "string" ? (entry["name"] as string) : String(modelId),
      slug,
      provider: "neuralwatt",
      family: typeof entry["family"] === "string" ? (entry["family"] as string) : null,
      context,
      cost: { input: cost["input"] as number, output: cost["output"] as number, cache_read: cacheRead },
      description: typeof entry["description"] === "string" ? (entry["description"] as string) : null,
      last_updated: typeof entry["last_updated"] === "string" ? (entry["last_updated"] as string) : null,
    };
  }

  return {
    version: 1,
    generatedAt: generatedAt ?? new Date().toISOString(),
    source: REGISTRY_TRANSFORM_SOURCE,
    models: out,
  };
}
