import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDisplayNameMap, applyDisplayNames } from "../src/core/displayNames";
import type { NeuralwattModelsDoc } from "../src/core/flexCatalog";
import { parseNeuralwattModels } from "../src/core/flexCatalog";
import { parseFlexCatalogCards } from "../src/core/flexCatalogCards";
import type { FlexCardsDoc } from "../src/core/flexCatalogCards";
import type { ModelsRegistry, RegistryModel } from "../src/core/flex";
import type { ValuedQuote } from "../src/core/types";
import { V1_ROWS, cardsFixtureHtml, v1FixtureDoc } from "./flexFixture";
import type { V1Row } from "./flexFixture";

/** Mirrors flexCatalog.test.ts:20 — partials filled with neutral defaults. */
function makeRegistry(models: Record<string, Partial<RegistryModel>>): ModelsRegistry {
  const full: Record<string, RegistryModel> = {};
  for (const [slug, v] of Object.entries(models)) {
    full[slug] = {
      id: v.id ?? slug,
      name: v.name ?? slug,
      slug: v.slug ?? slug,
      provider: v.provider ?? "neuralwatt",
      family: v.family ?? null,
      context: v.context ?? null,
      cost: v.cost ?? { input: 1, output: 2, cache_read: null },
      description: v.description ?? null,
      last_updated: v.last_updated ?? null,
    };
  }
  return { version: 1, generatedAt: "2026-09-17T00:00:00.000Z", source: "test", models: full };
}

function v1Doc(rows: readonly V1Row[] = V1_ROWS): NeuralwattModelsDoc {
  const doc = parseNeuralwattModels(v1FixtureDoc(rows));
  assert.ok(doc, "fixture v1 doc must parse");
  return doc!;
}

function cardsDoc(): FlexCardsDoc {
  const doc = parseFlexCatalogCards(cardsFixtureHtml());
  assert.ok(doc, "fixture cards doc must parse");
  return doc!;
}

/**
 * Registry covering exactly the two board ids the v1 fixture lacks, plus
 * S1-overlapping entries for the isolation rungs. Names pinned from the
 * live artifacts (bundled + live registry).
 */
function twoMissingRegistry(): ModelsRegistry {
  return makeRegistry({
    "deepseek-v4-pro": { name: "DeepSeek V4 Pro" },
    "qwen3-embedding-8b": { name: "Qwen3 Embedding 8B" },
  });
}

function valued(slug: string, displayName: string = slug): ValuedQuote {
  return {
    quote: {
      displayName,
      slug,
      isPreview: false,
      contextBand: null,
      cachePct: null,
      rightNowMwh: null,
      typicalMwh: null,
      trend: null,
      bands: [],
      capturedAt: "2026-09-18T00:00:00.000Z",
    },
    basisMwh: null,
    score: null,
    value: null,
    costPer1kUsd: null,
    descriptionMwh: null,
  };
}

describe("displayNames — 14/14 full-stack matrix (real pinned names)", () => {
  // Board slug -> rendered name, per the architect coverage matrix:
  // 11 via S1 (/v1/models display_name), deepseek-v4-pro + qwen3-embedding-8b
  // via S2 (registry), deepseek-v4.1-flash via S3 (card data-name).
  // NOTE: "GLM 5.3" carries a SPACE — the publisher's canonical form.
  const EXPECTED: ReadonlyArray<readonly [string, string]> = [
    ["deepseek-v4-flash", "DeepSeek V4 Flash"],
    ["deepseek-v4-pro", "DeepSeek V4 Pro"],
    ["deepseek-v4.1-flash", "DeepSeek V4.1 Flash"],
    ["gemma-4-31b", "Gemma 4 31B"],
    ["glm-5.3", "GLM 5.3"],
    ["glm-5.3-flash", "GLM-5.3 Flash"],
    ["kimi-k2.7-code", "Kimi K2.7 Code"],
    ["kimi-k2.7-code-fast", "Kimi K2.7 Code Fast"],
    ["kimi-k3", "Kimi K3"],
    ["kimi-k3-fast", "Kimi K3 Fast"],
    ["qwen-3.8-27b", "Qwen 3.8 27B"],
    ["qwen3.6-35b", "Qwen3.6 35B"],
    ["qwen3.6-35b-fast", "Qwen3.6 35B Fast"],
    ["qwen3-embedding-8b", "Qwen3 Embedding 8B"],
  ];

  it("D1 every board slug resolves to its pinned name end to end", () => {
    const names = buildDisplayNameMap(v1Doc(), twoMissingRegistry(), cardsDoc());
    assert.equal(names.size >= EXPECTED.length, true, `map covers all rows (size ${names.size})`);
    for (const [slug, name] of EXPECTED) {
      assert.equal(names.get(slug), name, `slug ${slug}`);
    }
  });

  it("D2 applyDisplayNames enriches all 14 rows without mutating the input", () => {
    const names = buildDisplayNameMap(v1Doc(), twoMissingRegistry(), cardsDoc());
    const before = EXPECTED.map(([slug]) => valued(slug));
    const snapshot = structuredClone(before);
    const after = applyDisplayNames(before, names);
    assert.equal(after.length, EXPECTED.length);
    EXPECTED.forEach(([slug, name], i) => {
      assert.equal(after[i]!.quote.slug, slug);
      assert.equal(after[i]!.quote.displayName, name);
    });
    assert.deepEqual(before, snapshot, "input valued untouched");
  });
});

describe("displayNames — rung isolation", () => {
  it("D3 v1 absent: S2 registry names win", () => {
    const names = buildDisplayNameMap(null, twoMissingRegistry(), cardsDoc());
    assert.equal(names.get("deepseek-v4-pro"), "DeepSeek V4 Pro");
    assert.equal(names.get("qwen3-embedding-8b"), "Qwen3 Embedding 8B");
    // S3 still covers a card-only id.
    assert.equal(names.get("deepseek-v4.1-flash"), "DeepSeek V4.1 Flash");
    // No v1 anywhere: an S1-only id has no entry.
    assert.equal(names.has("glm-5.3-flash"), true, "cards fixture covers glm-5.3-flash via S3");
  });

  it("D4 v1 + registry absent: S3 card data-name covers every card id", () => {
    const names = buildDisplayNameMap(null, null, cardsDoc());
    assert.equal(names.get("deepseek-v4.1-flash"), "DeepSeek V4.1 Flash");
    assert.equal(names.get("qwen3-embedding-8b"), "Qwen3 Embedding 8B");
    assert.equal(names.get("kimi-k2.7-code"), "Kimi K2.7 Code");
  });

  it("D5 registry WITHOUT qwen3-embedding-8b: S3 Qwen3 Embedding 8B fills the gap", () => {
    const reg = makeRegistry({ "deepseek-v4-pro": { name: "DeepSeek V4 Pro" } });
    const names = buildDisplayNameMap(null, reg, cardsDoc());
    assert.equal(names.get("qwen3-embedding-8b"), "Qwen3 Embedding 8B");
    assert.equal(names.get("deepseek-v4-pro"), "DeepSeek V4 Pro");
  });
});

describe("displayNames — priority on conflicts", () => {
  const v1 = { data: [{ id: "deepseek-v4-pro", metadata: { display_name: "S1 Name" } }] } as NeuralwattModelsDoc;
  const reg = makeRegistry({ "deepseek-v4-pro": { name: "S2 Name" } });
  const cards: FlexCardsDoc = {
    cards: [{ ids: ["deepseek-v4-pro"], family: "S3 Family", name: "S3 Name", inputPerMillion: 1, outputPerMillion: 2, cachedInputPerMillion: null }],
  };

  it("D6 S1 beats conflicting S2 and S3", () => {
    assert.equal(buildDisplayNameMap(v1, reg, cards).get("deepseek-v4-pro"), "S1 Name");
  });

  it("D7 S2 beats conflicting S3", () => {
    assert.equal(buildDisplayNameMap(null, reg, cards).get("deepseek-v4-pro"), "S2 Name");
  });

  it("D8 blank/whitespace names never win a rung (next rung fills in)", () => {
    const blankV1 = { data: [{ id: "deepseek-v4-pro", metadata: { display_name: "   " } }] } as NeuralwattModelsDoc;
    assert.equal(buildDisplayNameMap(blankV1, reg, cards).get("deepseek-v4-pro"), "S2 Name");
    const blankReg = makeRegistry({ "deepseek-v4-pro": { name: "" } });
    assert.equal(buildDisplayNameMap(null, blankReg, cards).get("deepseek-v4-pro"), "S3 Name");
  });
});

describe("displayNames — card data-name capture + family fallback", () => {
  it("D9 parser captures data-name where it DIFFERS from data-family", () => {
    const doc = cardsDoc();
    const byId = new Map(doc.cards.flatMap((c) => c.ids.map((id) => [id, c] as const)));
    // Pinned from the live /models capture: name differs from family on 3 cards.
    assert.equal(byId.get("deepseek-v4-pro")!.name, "DeepSeek V4-Pro");
    assert.equal(byId.get("deepseek-v4-pro")!.family, "DeepSeek V4 Pro");
    assert.equal(byId.get("glm-5.3")!.name, "GLM 5.3");
    assert.equal(byId.get("glm-5.3")!.family, "GLM-5.3");
    assert.equal(byId.get("qwen3-embedding-8b")!.name, "Qwen3 Embedding 8B");
    assert.equal(byId.get("qwen3-embedding-8b")!.family, "qwen3-embedding-8b");
    // The embedding card proves S3 must use name, not family: family is the raw slug.
    const names = buildDisplayNameMap(null, null, doc);
    assert.equal(names.get("qwen3-embedding-8b"), "Qwen3 Embedding 8B");
  });

  it("D10 card without data-name falls back to family", () => {
    const html =
      `<html><body><article data-family="Fallback Family" data-price="0.0001" data-provider="P">` +
      `<a data-model-id="fallback-id"></a>` +
      `<div title="Cached input: $0.01/M tokens"><span>Output: <strong>$0.10/M</strong></span></div>` +
      `</article></body></html>`;
    const doc = parseFlexCatalogCards(html);
    assert.ok(doc);
    assert.equal(doc!.cards[0]!.name, null);
    const names = buildDisplayNameMap(null, null, doc);
    assert.equal(names.get("fallback-id"), "Fallback Family");
  });

  it("D11 old-cache FlexCard literal without name compiles and resolves via family", () => {
    const stale: FlexCardsDoc = { cards: [{ ids: ["stale-id"], family: "Stale Family", inputPerMillion: 1, outputPerMillion: 2, cachedInputPerMillion: null }] };
    const names = buildDisplayNameMap(null, null, stale);
    assert.equal(names.get("stale-id"), "Stale Family");
  });
});

describe("displayNames — applyDisplayNames reference semantics", () => {
  it("D12 absent slug passes through by reference; overridden rows are new objects with identical slug", () => {
    const names = new Map([["present-id", "Present Name"]]);
    const present = valued("present-id");
    const absent = valued("absent-id");
    const before = structuredClone([present, absent]);
    const after = applyDisplayNames([present, absent], names);
    assert.equal(after[1], absent, "uncovered row is the SAME object");
    assert.notEqual(after[0], present, "overridden row is a clone");
    assert.equal(after[0]!.quote.slug, "present-id");
    assert.equal(after[0]!.quote.displayName, "Present Name");
    assert.deepEqual([present, absent], before, "inputs unmutated");
  });

  it("D13 empty valued and empty map are no-ops", () => {
    assert.deepEqual(applyDisplayNames([], new Map([["x", "X"]])), []);
    const v = valued("solo-id");
    assert.equal(applyDisplayNames([v], new Map())[0], v);
  });
});

describe("displayNames — corrupt inputs never throw", () => {
  it("D14 all-null and shape-corrupt docs degrade to an empty map", () => {
    assert.equal(buildDisplayNameMap(null, null, null).size, 0);
    const junk = buildDisplayNameMap(
      { data: "junk" } as unknown as NeuralwattModelsDoc,
      { models: 42 } as unknown as ModelsRegistry,
      { cards: [null] } as unknown as FlexCardsDoc,
    );
    assert.equal(junk.size, 0);
  });

  it("D15 partial corruption keeps the healthy rungs (graceful subset)", () => {
    const names = buildDisplayNameMap(
      { data: [{ id: "healthy-v1" }, null, "junk"] } as unknown as NeuralwattModelsDoc,
      { models: { "healthy-reg": { name: "Reg Name" }, broken: 42 } } as unknown as ModelsRegistry,
      { cards: [{ ids: "nope", family: "X" }, { ids: ["healthy-card"], family: "Card Name" }] } as unknown as FlexCardsDoc,
    );
    assert.equal(names.get("healthy-reg"), "Reg Name");
    assert.equal(names.get("healthy-card"), "Card Name");
    assert.equal(names.has("healthy-v1"), false, "entry without display_name yields no entry");
  });
});
