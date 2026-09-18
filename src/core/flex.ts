/**
 * Models-registry types + loader — vscode-free.
 * Mirrors scores.ts pattern: loadModelsRegistry -> null on missing/corrupt, no throw.
 * Flex MEMBERSHIP/pricing now lives in flexCatalog.ts (derived from
 * Neuralwatt /v1/models); the registry here is the enrichment source.
 */
import * as fs from "fs";
import * as path from "path";

export interface RegistryModel {
  id: string;
  name: string;
  slug: string;
  provider: string;
  family: string | null;
  context: number | null;
  cost: { input: number; output: number; cache_read: number | null };
  description: string | null;
  last_updated: string | null;
}

export interface ModelsRegistry {
  version: number;
  generatedAt: string;
  source: string;
  models: Record<string, RegistryModel>;
}

export function resolveBundledRegistryPath(extensionRoot: string): string {
  return path.join(extensionRoot, "data", "models-registry.json");
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function isRegistryModel(v: unknown): boolean {
  if (!isRecord(v)) return false;
  if (typeof v.slug !== "string" || typeof v.id !== "string" || typeof v.name !== "string") return false;
  return true;
}

export function loadModelsRegistry(filePath: string): ModelsRegistry | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    if (typeof parsed.version !== "number") return null;
    if (!isRecord(parsed.models)) return null;
    // Validate that models values at least look like RegistryModel
    const models: Record<string, RegistryModel> = {};
    for (const [k, v] of Object.entries(parsed.models as Record<string, unknown>)) {
      if (!isRegistryModel(v)) continue;
      models[k] = v as RegistryModel;
    }
    return {
      version: parsed.version as number,
      generatedAt: (parsed.generatedAt as string) ?? "",
      source: (parsed.source as string) ?? "",
      models,
    };
  } catch {
    return null;
  }
}

export function formatContextTokens(context: number | null): string {
  if (context == null || !Number.isFinite(context)) return "-";
  if (context >= 1_000_000) {
    return `${(context / 1_000_000).toFixed(1)}M`;
  }
  if (context >= 1000) {
    const k = Math.round(context / 1000);
    return `${k}k`;
  }
  return String(context);
}
