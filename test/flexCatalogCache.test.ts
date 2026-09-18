import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FlexCatalogCacheManager, emptyFlexCatalogCache, FLEX_CATALOG_CACHE_VERSION } from "../src/core/flexCatalogCache";
import type { FlexCatalogCacheData } from "../src/core/flexCatalogCache";
import { parseNeuralwattModels } from "../src/core/flexCatalog";
import type { NeuralwattModelsDoc } from "../src/core/flexCatalog";
import type { FlexPerfDoc } from "../src/core/flexPerf";
import { parseFlexPerfView } from "../src/core/flexPerf";
import { parseFlexCatalogCards } from "../src/core/flexCatalogCards";
import type { FlexCardsDoc } from "../src/core/flexCatalogCards";
import { perfFixtureHtml } from "./flexFixture";

function makeDoc(): NeuralwattModelsDoc {
  return {
    data: [
      {
        id: "glm-5.3-flex",
        owned_by: "neuralwatt",
        max_model_len: 1048560,
        metadata: {
          display_name: "GLM 5.3 (flex)",
          provider: "ZhipuAI",
          pricing: {
            input_per_million: 0.9425,
            output_per_million: 2.925,
            cached_input_per_million: 0.09425,
            service_tier: "flex",
            flex_discount_multiplier: 0.65,
          },
        },
      },
    ],
  };
}

function makePerfDoc(): FlexPerfDoc {
  return { lanes: [{ slug: "glm-5.3", family: "GLM-5.3", flex: true, preview: false }] };
}

function makeCardsDoc(): FlexCardsDoc {
  return {
    cards: [
      {
        ids: ["acme-base", "acme-fast"],
        family: "Acme",
        inputPerMillion: 0.5,
        outputPerMillion: 2,
        cachedInputPerMillion: 0.05,
      },
    ],
  };
}

function memoryStorage(initial: FlexCatalogCacheData | null = null) {
  let data: FlexCatalogCacheData | null = initial;
  return {
    async read(): Promise<FlexCatalogCacheData | null> { return data; },
    async write(d: FlexCatalogCacheData): Promise<void> { data = d; },
  };
}

describe("flexCatalogCache v2", () => {
  it("V1 roundtrip: saveV1 -> load returns the doc slot + content hash + lastSuccessAt", async () => {
    const mgr = new FlexCatalogCacheManager(memoryStorage());
    const doc = makeDoc();
    await mgr.saveV1(doc, "hash-v1");
    const loaded = await mgr.load();
    assert.deepEqual(loaded.v1.doc, doc);
    assert.equal(loaded.v1.contentHash, "hash-v1");
    assert.ok(loaded.v1.lastSuccessAt);
    assert.ok(loaded.lastCheckedAt);
    assert.deepEqual(loaded.perf, { doc: null, contentHash: null, lastSuccessAt: null });
    assert.equal(loaded.version, FLEX_CATALOG_CACHE_VERSION);
  });

  it("V2 per-document independence: savePerf leaves the v1 slot untouched", async () => {
    const mgr = new FlexCatalogCacheManager(memoryStorage());
    const doc = makeDoc();
    const saved = await mgr.saveV1(doc, "hash-v1");
    await new Promise((r) => setTimeout(r, 5));
    const perf = makePerfDoc();
    const after = await mgr.savePerf(perf, "hash-perf");
    assert.deepEqual(after.v1, saved.v1);
    assert.deepEqual(after.perf.doc, perf);
    assert.equal(after.perf.contentHash, "hash-perf");
    assert.ok(after.perf.lastSuccessAt);
  });

  it("V3 old-version (v1) cache -> empty cache (graceful refetch cycle)", async () => {
    const stale = {
      version: 1,
      doc: makeDoc(),
      etag: '"x"',
      lastSuccessAt: "2026-01-01T00:00:00.000Z",
      lastCheckedAt: "2026-01-01T00:00:00.000Z",
    } as unknown as FlexCatalogCacheData;
    const mgr = new FlexCatalogCacheManager(memoryStorage(stale));
    assert.deepEqual(await mgr.load(), emptyFlexCatalogCache());
  });

  it("V4 read-failure (corrupt JSON surface) -> empty cache, no throw", async () => {
    const bad = {
      async read(): Promise<FlexCatalogCacheData | null> { throw new Error("Unexpected token { in JSON"); },
      async write(): Promise<void> {},
    };
    const mgr = new FlexCatalogCacheManager(bad);
    assert.deepEqual(await mgr.load(), emptyFlexCatalogCache());
  });

  it("V5 load on empty storage -> empty cache (both slots null)", async () => {
    const mgr = new FlexCatalogCacheManager(memoryStorage(null));
    const loaded = await mgr.load();
    assert.deepEqual(loaded, emptyFlexCatalogCache());
    assert.equal(loaded.v1.doc, null);
    assert.equal(loaded.perf.doc, null);
    assert.equal(loaded.lastCheckedAt, null);
  });

  it("V6 parse-null outcome keeps the last-known doc and persists NOTHING", async () => {
    // Mirrors controller.refreshFlexCatalog: ok-status + unparseable body =>
    // parse* returns null and the refresh path returns early.
    const storage = memoryStorage();
    const mgr = new FlexCatalogCacheManager(storage);
    const doc = makeDoc();
    await mgr.saveV1(doc, "hash-keep");

    const parsed = parseNeuralwattModels({ object: "list", data: "not-an-array" });
    assert.equal(parsed, null);
    if (parsed) await mgr.saveV1(parsed, "should-never-happen");

    const parsedPerf = parseFlexPerfView("<html><body>error page</body></html>");
    assert.equal(parsedPerf, null);
    if (parsedPerf) await mgr.savePerf(parsedPerf, "should-never-happen");

    const loaded = await mgr.load();
    assert.deepEqual(loaded.v1.doc, doc);
    assert.equal(loaded.v1.contentHash, "hash-keep");
    assert.equal(loaded.perf.doc, null);
  });

  it("V7 touchChecked keeps both docs + hashes, bumps lastCheckedAt only", async () => {
    const mgr = new FlexCatalogCacheManager(memoryStorage());
    await mgr.saveV1(makeDoc(), "hash-v1");
    await mgr.savePerf(makePerfDoc(), "hash-perf");
    const before = await mgr.load();
    await new Promise((r) => setTimeout(r, 5));
    const after = await mgr.touchChecked();
    assert.deepEqual(after.v1, before.v1);
    assert.deepEqual(after.perf, before.perf);
    assert.notEqual(after.lastCheckedAt, before.lastCheckedAt);
  });

  it("V8 shape-corrupt slots normalize to null docs + null hashes (no stale-hash trap)", async () => {
    const corrupt = {
      version: FLEX_CATALOG_CACHE_VERSION,
      v1: { doc: { data: "nope" }, contentHash: "stale-hash", lastSuccessAt: "2026-01-01T00:00:00.000Z" },
      perf: { doc: { lanes: 42 }, contentHash: "stale-hash", lastSuccessAt: "2026-01-01T00:00:00.000Z" },
      lastCheckedAt: "2026-01-01T00:00:00.000Z",
    } as unknown as FlexCatalogCacheData;
    const mgr = new FlexCatalogCacheManager(memoryStorage(corrupt));
    const loaded = await mgr.load();
    assert.equal(loaded.v1.doc, null);
    assert.equal(loaded.v1.contentHash, null);
    assert.equal(loaded.perf.doc, null);
    assert.equal(loaded.perf.contentHash, null);
  });

  it("V9 a hash never outlives its doc (hash without a valid doc is dropped)", async () => {
    const partial = {
      version: FLEX_CATALOG_CACHE_VERSION,
      v1: { doc: null, contentHash: "orphan-hash", lastSuccessAt: null },
      perf: { doc: null, contentHash: null, lastSuccessAt: null },
      lastCheckedAt: null,
    } as unknown as FlexCatalogCacheData;
    const mgr = new FlexCatalogCacheManager(memoryStorage(partial));
    const loaded = await mgr.load();
    assert.equal(loaded.v1.contentHash, null);
  });

  it("V10 schema stays v2 (additive cards slot, NO version bump)", () => {
    assert.equal(FLEX_CATALOG_CACHE_VERSION, 2);
  });

  it("V11 an old v2 file WITHOUT the cards slot loads fine: v1/perf intact, cards materialized empty", async () => {
    // Written by the previous release: no cards key at all.
    const legacy = {
      version: FLEX_CATALOG_CACHE_VERSION,
      v1: { doc: makeDoc(), contentHash: "hash-v1", lastSuccessAt: "2026-01-01T00:00:00.000Z" },
      perf: { doc: makePerfDoc(), contentHash: "hash-perf", lastSuccessAt: "2026-01-02T00:00:00.000Z" },
      lastCheckedAt: "2026-01-03T00:00:00.000Z",
    } as unknown as FlexCatalogCacheData;
    const mgr = new FlexCatalogCacheManager(memoryStorage(legacy));
    const loaded = await mgr.load();
    assert.equal(loaded.v1.contentHash, "hash-v1");
    assert.equal(loaded.perf.contentHash, "hash-perf");
    assert.deepEqual(loaded.cards, { doc: null, contentHash: null, lastSuccessAt: null });
    assert.equal(loaded.version, FLEX_CATALOG_CACHE_VERSION);
  });

  it("V12 saveCards round-trip preserves the v1 + perf slots (per-document independence)", async () => {
    const mgr = new FlexCatalogCacheManager(memoryStorage());
    await mgr.saveV1(makeDoc(), "hash-v1");
    await mgr.savePerf(makePerfDoc(), "hash-perf");
    const before = await mgr.load();
    await new Promise((r) => setTimeout(r, 5));
    const cards = makeCardsDoc();
    const after = await mgr.saveCards(cards, "hash-cards");
    assert.deepEqual(after.v1, before.v1);
    assert.deepEqual(after.perf, before.perf);
    assert.deepEqual(after.cards.doc, cards);
    assert.equal(after.cards.contentHash, "hash-cards");
    assert.ok(after.cards.lastSuccessAt);
    assert.deepEqual((await mgr.load()).cards.doc, cards);
  });

  it("V13 shape-corrupt cards slot normalizes to empty + null hash; orphan cards hash is dropped (wedge guard)", async () => {
    const corrupt = {
      version: FLEX_CATALOG_CACHE_VERSION,
      v1: { doc: null, contentHash: null, lastSuccessAt: null },
      perf: { doc: null, contentHash: null, lastSuccessAt: null },
      cards: { doc: { cards: 42 }, contentHash: "stale-hash", lastSuccessAt: "2026-01-01T00:00:00.000Z" },
      lastCheckedAt: null,
    } as unknown as FlexCatalogCacheData;
    const mgr = new FlexCatalogCacheManager(memoryStorage(corrupt));
    const loaded = await mgr.load();
    assert.equal(loaded.cards.doc, null);
    assert.equal(loaded.cards.contentHash, null);

    const orphan = {
      version: FLEX_CATALOG_CACHE_VERSION,
      v1: { doc: null, contentHash: null, lastSuccessAt: null },
      perf: { doc: null, contentHash: null, lastSuccessAt: null },
      cards: { doc: null, contentHash: "orphan-hash", lastSuccessAt: null },
      lastCheckedAt: null,
    } as unknown as FlexCatalogCacheData;
    const mgr2 = new FlexCatalogCacheManager(memoryStorage(orphan));
    assert.equal((await mgr2.load()).cards.contentHash, null);
  });

  it("V14 touchChecked keeps all three docs + hashes", async () => {
    const mgr = new FlexCatalogCacheManager(memoryStorage());
    await mgr.saveV1(makeDoc(), "hash-v1");
    await mgr.savePerf(makePerfDoc(), "hash-perf");
    await mgr.saveCards(makeCardsDoc(), "hash-cards");
    const before = await mgr.load();
    await new Promise((r) => setTimeout(r, 5));
    const after = await mgr.touchChecked();
    assert.deepEqual(after.v1, before.v1);
    assert.deepEqual(after.perf, before.perf);
    assert.deepEqual(after.cards, before.cards);
  });

  it("V15 parse-null cards outcome keeps the last-known doc and persists NOTHING", async () => {
    const storage = memoryStorage();
    const mgr = new FlexCatalogCacheManager(storage);
    const cards = makeCardsDoc();
    await mgr.saveCards(cards, "hash-keep");
    const parsed = parseFlexCatalogCards("<html><body>error page</body></html>");
    assert.equal(parsed, null);
    if (parsed) await mgr.saveCards(parsed, "should-never-happen");
    const loaded = await mgr.load();
    assert.deepEqual(loaded.cards.doc, cards);
    assert.equal(loaded.cards.contentHash, "hash-keep");
  });
});
