import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { flexTiers, formatFlexDescription, formatContextTokens, loadModelsRegistry } from "../src/core/flex";
import type { RegistryModel, ModelsRegistry } from "../src/core/flex";

function makeRegistry(models: Record<string, Partial<RegistryModel> & { slug: string }>): ModelsRegistry {
  const full: Record<string, RegistryModel> = {};
  for (const [k, v] of Object.entries(models)) {
    full[k] = {
      id: v.id ?? k,
      name: v.name ?? k,
      slug: v.slug,
      provider: v.provider ?? "neuralwatt",
      family: v.family ?? null,
      context: v.context ?? null,
      cost: v.cost ?? { input: 1, output: 2, cache_read: null as unknown as number },
      description: v.description ?? null,
      last_updated: v.last_updated ?? null,
    } as RegistryModel;
  }
  return { version: 1, generatedAt: new Date().toISOString(), source: "test", models: full };
}

describe("flex.flexTiers", () => {
  it("filters only -flex slugged entries", () => {
    const reg = makeRegistry({
      "a-flex": { slug: "a-flex", cost: { input: 1, output: 2, cache_read: null } },
      "a": { slug: "a", cost: { input: 1, output: 2, cache_read: null } },
      "b-flex": { slug: "b-flex", cost: { input: 2, output: 2, cache_read: null } },
    });
    const tiers = flexTiers(reg, new Set());
    assert.equal(tiers.length, 2);
    assert.ok(tiers.every((m) => m.slug.endsWith("-flex")));
  });

  it("board-wins exclusion: flex slug already on board is excluded", () => {
    const reg = makeRegistry({
      "glm-5.2-flex": { slug: "glm-5.2-flex", cost: { input: 1, output: 2, cache_read: null } },
      "deepseek-v4-flash-flex": { slug: "deepseek-v4-flash-flex", cost: { input: 1, output: 2, cache_read: null } },
    });
    const tiers = flexTiers(reg, new Set(["glm-5.2-flex"]));
    assert.equal(tiers.length, 1);
    assert.equal(tiers[0].slug, "deepseek-v4-flash-flex");
  });

  it("sort by cost.input asc", () => {
    const reg = makeRegistry({
      "c-flex": { slug: "c-flex", cost: { input: 3, output: 1, cache_read: null } },
      "a-flex": { slug: "a-flex", cost: { input: 1, output: 1, cache_read: null } },
      "b-flex": { slug: "b-flex", cost: { input: 2, output: 1, cache_read: null } },
    });
    const tiers = flexTiers(reg, new Set());
    assert.deepEqual(tiers.map((m) => m.slug), ["a-flex", "b-flex", "c-flex"]);
  });

  it("missing cost.input skipped", () => {
    const reg = makeRegistry({
      "a-flex": { slug: "a-flex", cost: { input: NaN as unknown as number, output: 1, cache_read: null } },
      "b-flex": { slug: "b-flex", cost: { input: 1, output: 1, cache_read: null } },
    });
    // also test undefined case by constructing raw
    const raw: ModelsRegistry = {
      version: 1,
      generatedAt: "",
      source: "",
      models: {
        "bad-flex": { id: "bad-flex", name: "bad", slug: "bad-flex", provider: "neuralwatt", family: null, context: null, cost: { input: undefined as unknown as number, output: 1, cache_read: null }, description: null, last_updated: null },
        "ok-flex": { id: "ok-flex", name: "ok", slug: "ok-flex", provider: "neuralwatt", family: null, context: null, cost: { input: 1, output: 1, cache_read: null }, description: null, last_updated: null },
      },
    };
    const tiers = flexTiers(raw, new Set());
    assert.equal(tiers.length, 1);
    assert.equal(tiers[0].slug, "ok-flex");
  });
});

describe("flex.formatters", () => {
  it("formatFlexDescription: output 4 -> $4.00 and full shape", () => {
    const m: RegistryModel = {
      id: "x-flex", name: "X Flex", slug: "x-flex", provider: "neuralwatt", family: null, context: null,
      cost: { input: 0.95, output: 4, cache_read: null }, description: null, last_updated: null,
    };
    assert.equal(formatFlexDescription(m), "$0.95 in · $4.00 out /1M tok");
  });

  it("formatContextTokens cases", () => {
    assert.equal(formatContextTokens(262128), "262k");
    assert.equal(formatContextTokens(1048560), "1.0M");
    assert.equal(formatContextTokens(null), "-");
    assert.equal(formatContextTokens(500), "500");
    assert.equal(formatContextTokens(1000), "1k");
  });
});

describe("flex.loader", () => {
  it("missing file -> null", () => {
    assert.equal(loadModelsRegistry("/no/such/path.json"), null);
  });
  it("corrupt json -> null", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flex-"));
    const p = path.join(dir, "bad.json");
    fs.writeFileSync(p, "{ not json");
    assert.equal(loadModelsRegistry(p), null);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("flexTiers(null) -> []", () => {
    assert.deepEqual(flexTiers(null, new Set(["a"])), []);
  });
});
