#!/usr/bin/env node
// Extract data/models-registry.json from tmp_models_dev_api.json.
// Usage: node scripts/extract-registry.mjs
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const src = path.join(root, "tmp_models_dev_api.json");
const out = path.join(root, "data", "models-registry.json");

if (!fs.existsSync(src)) {
  console.error(`Missing input: ${src}`);
  process.exit(1);
}

const raw = fs.readFileSync(src, "utf8");
let data;
try {
  data = JSON.parse(raw);
} catch (e) {
  console.error(`Failed to parse ${src}: ${e.message}`);
  process.exit(1);
}

// The dump is { providerId: { id, name, models: { modelId: {...} } } }
// We care about the neuralwatt provider's models as registry metadata.
// But to be robust, we output a normalized form:
// { provider: "neuralwatt", generatedAt, models: [{ id, name, slug hint }] }
// However per plan, registry is used for tooltip extras. Keep it simple:
// { version: 1, generatedAt, providers: { neuralwatt: { models: Record<slug, entry> } }, modelsBySlug }
// For minimal, just dump the neuralwatt.models indexed by slug.

const BOARD_NAME_TO_SLUG = {
  "DeepSeek V4 Flash": "deepseek-v4-flash",
  "DeepSeek V4-Pro": "deepseek-v4-pro",
  "Gemma 4 31B": "gemma-4-31b",
  "GLM-5.2": "glm-5.2",
  "GLM-5.2 (fast)": "glm-5.2-fast",
  "GLM-5.2 (short)": "glm-5.2-short",
  "GLM-5.2 (short, fast)": "glm-5.2-short-fast",
  "Kimi K2.7 Code": "kimi-k2.7-code",
  "Kimi K2.7 Code Fast": "kimi-k2.7-code-fast",
  "Kimi K3": "kimi-k3",
  "Kimi K3 Fast": "kimi-k3-fast",
  "Qwen 3.8 27B": "qwen-3.8-27b",
  "Qwen3.6 35B": "qwen3.6-35b",
  "Qwen3.6 35B Fast": "qwen3.6-35b-fast",
};

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
}

function toSlug(displayName) {
  return BOARD_NAME_TO_SLUG[displayName] ?? slugify(displayName);
}

const generatedAt = new Date().toISOString();

// Prefer neuralwatt provider; fallback to scanning all providers for known model ids
let source = data.neuralwatt ?? null;
let modelsRaw = source?.models ?? null;

// If neuralwatt.missing or sparse, scan all providers for a richer set — but still only keep those whose name matches board mapping?
// Per spec, registry is "models.dev used only as registry metadata" — so include whatever models.dev has for these slugs.

// Build modelsBySlug
const modelsBySlug = {};
if (modelsRaw) {
  for (const [modelId, entry] of Object.entries(modelsRaw)) {
    // Derive slug from entry.name or modelId
    const name = entry.name ?? modelId;
    const slug = toSlug(name);
    // Also map by modelId slug variant (e.g. deepseek-v4-flash)
    const altSlug = modelId.includes("/") ? modelId.split("/").pop() : modelId;
    const key = slug;
    modelsBySlug[key] = {
      id: entry.id ?? modelId,
      name: entry.name ?? null,
      slug: key,
      provider: "neuralwatt",
      family: entry.family ?? null,
      context: entry.limit?.context ?? null,
      cost: entry.cost ?? null,
      description: entry.description ?? null,
      last_updated: entry.last_updated ?? null,
    };
    // also keep alt key if different
    if (altSlug !== key && !modelsBySlug[altSlug]) {
      // don't duplicate; just note alias
    }
  }
}

// Also scan other providers for any model whose name matches board names (to fill gaps)
for (const [provId, prov] of Object.entries(data)) {
  if (provId === "neuralwatt") continue;
  const provModels = prov.models ?? {};
  for (const [mid, entry] of Object.entries(provModels)) {
    const slug = slugify(entry.name ?? mid);
    // Only fill if not already present and slug corresponds to a board model (or looks relevant)
    // Keep it lean: only include if entry.name is in BOARD_NAME_TO_SLUG values or keys
    const boardSlugs = new Set(Object.values(BOARD_NAME_TO_SLUG));
    if (!boardSlugs.has(slug)) continue;
    if (!modelsBySlug[slug]) {
      modelsBySlug[slug] = {
        id: entry.id ?? mid,
        name: entry.name ?? null,
        slug,
        provider: provId,
        family: entry.family ?? null,
        context: entry.limit?.context ?? null,
        cost: entry.cost ?? null,
        description: entry.description ?? null,
        last_updated: entry.last_updated ?? null,
      };
    }
  }
}

const outPayload = {
  version: 1,
  generatedAt,
  source: "tmp_models_dev_api.json (models.dev dump) -> neuralwatt provider",
  models: modelsBySlug,
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(outPayload, null, 2) + "\n", "utf8");
console.log(`Wrote ${out} with ${Object.keys(modelsBySlug).length} models`);
for (const k of Object.keys(modelsBySlug).sort()) {
  console.log(`  - ${k}: ${modelsBySlug[k].name ?? modelsBySlug[k].id}`);
}
