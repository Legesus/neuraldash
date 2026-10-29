import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildFlexCatalog,
  formatFlexEntryDescription,
  harvestDocMultiplier,
  parseNeuralwattModels,
} from "../src/core/flexCatalog";
import type { FlexEntry } from "../src/core/flexCatalog";
import { parseFlexPerfView } from "../src/core/flexPerf";
import { parseFlexCatalogCards, flexCardById } from "../src/core/flexCatalogCards";
import type { ModelsRegistry, RegistryModel } from "../src/core/flex";
import { V1_ROWS, cardsFixtureHtml, perfFixtureHtml, v1FixtureDoc } from "./flexFixture";
import type { V1Row } from "./flexFixture";

function perfDoc() {
  return parseFlexPerfView(perfFixtureHtml());
}

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

function bySlug(list: FlexEntry[]): Map<string, FlexEntry> {
  return new Map(list.map((e) => [e.slug, e]));
}

describe("flexCatalog.parseNeuralwattModels", () => {
  it("accepts the trimmed 19-entry fixture", () => {
    const doc = parseNeuralwattModels(v1FixtureDoc());
    assert.ok(doc);
    assert.equal(doc!.data.length, 19);
    assert.equal(doc!.data[0]!.id, "kimi-k2.7-code");
  });

  it("rejects non-object bodies", () => {
    for (const bad of [null, undefined, 42, "data", [1, 2]]) {
      assert.equal(parseNeuralwattModels(bad), null);
    }
  });

  it("rejects missing or non-array data", () => {
    assert.equal(parseNeuralwattModels({}), null);
    assert.equal(parseNeuralwattModels({ object: "list" }), null);
    assert.equal(parseNeuralwattModels({ data: {} }), null);
    assert.equal(parseNeuralwattModels({ data: "nope" }), null);
  });

  it("rejects a non-record entry", () => {
    assert.equal(parseNeuralwattModels({ data: [{ id: "ok" }, "junk"] }), null);
    assert.equal(parseNeuralwattModels({ data: [null] }), null);
  });

  it("accepts an empty data array", () => {
    const doc = parseNeuralwattModels({ object: "list", data: [] });
    assert.ok(doc);
    assert.equal(doc!.data.length, 0);
  });
});

describe("flexCatalog membership matrix", () => {
  it("M1 unites the two documents: 7 both + 3 perf-lane rows in price order, both evidence kinds recorded", () => {
    const doc = parseNeuralwattModels(v1FixtureDoc());
    const list = buildFlexCatalog(doc, perfDoc(), null, null, new Set());
    assert.deepEqual(
      list.map((e) => [e.slug, e.baseSlug, e.membership]),
      [
        ["deepseek-v4-flash-flex", "deepseek-v4-flash", "both"],
        ["glm-5.3-flash-flex", "glm-5.3-flash", "both"],
        ["qwen3.6-35b-fast-flex", "qwen3.6-35b-fast", "perf-lane"],
        ["qwen3.6-35b-flex", "qwen3.6-35b", "both"],
        ["qwen-3.8-27b-flex", "qwen-3.8-27b", "both"],
        ["kimi-k2.7-code-flex", "kimi-k2.7-code", "both"],
        ["glm-5.3-flex", "glm-5.3", "both"],
        ["kimi-k3-fast-flex", "kimi-k3-fast", "perf-lane"],
        ["kimi-k3-flex", "kimi-k3", "both"],
        ["deepseek-v4.1-flash-flex", "deepseek-v4.1-flash", "perf-lane"],
      ],
    );
  });

  it("M2 exact alias rows carry verbatim v1 prices and the doc's own multiplier", () => {
    const doc = parseNeuralwattModels(v1FixtureDoc());
    const entries = bySlug(buildFlexCatalog(doc, perfDoc(), null, null, new Set()));
    const kimi = entries.get("kimi-k2.7-code-flex")!;
    assert.equal(kimi.provenance, "v1-alias");
    assert.equal(kimi.inputPerMillion, 0.6175);
    assert.equal(kimi.outputPerMillion, 2.6);
    assert.equal(kimi.cacheReadPerMillion, 0.06175);
    assert.equal(kimi.flexMultiplier, 0.65);
    assert.equal(kimi.multiplierOrigin, "alias-own");
    assert.equal(kimi.preview, false);
    assert.equal(kimi.name, "Kimi K2.7 Code (flex)");
    assert.equal(kimi.provider, "MoonshotAI");
    assert.equal(kimi.family, "Kimi K2.7 Code"); // document family from the perf lane
  });

  it("M3 DOUBLE-DISCOUNT GUARD: alias prices are never re-multiplied", () => {
    const doc = parseNeuralwattModels(v1FixtureDoc());
    const list = buildFlexCatalog(doc, perfDoc(), null, null, new Set());
    for (const e of list.filter((x) => x.provenance === "v1-alias")) {
      const row = V1_ROWS.find((r) => r[0] === e.slug)!;
      assert.equal(e.inputPerMillion, row[6], `${e.slug} input verbatim`);
      assert.equal(e.outputPerMillion, row[7], `${e.slug} output verbatim`);
    }
    assert.equal(bySlug(list).get("kimi-k2.7-code-flex")!.inputPerMillion, 0.6175);
  });

  it("M4 emergent exclusion: kimi-k2.7-code-fast has no alias and no lane -> NO row (zero constants)", () => {
    const doc = parseNeuralwattModels(v1FixtureDoc());
    const list = buildFlexCatalog(doc, perfDoc(), null, null, new Set());
    assert.equal(list.some((e) => e.slug.includes("kimi-k2.7-code-fast")), false);
    assert.equal(list.some((e) => e.slug === "kimi-k2.7-code-flex"), true);
  });

  it("M5 the speed-lane row (raw-slug invocation, no flex tag) is NOT a member", () => {
    const doc = parseNeuralwattModels(v1FixtureDoc());
    const list = buildFlexCatalog(doc, perfDoc(), null, null, new Set());
    assert.equal(list.some((e) => e.slug.includes("deepseek-v4-flash-speed")), false);
    // ...even though the base slug has a v1 flex alias of its own.
    assert.equal(list.some((e) => e.slug === "deepseek-v4-flash-flex"), true);
  });

  it("M6 lane-only rows: preview chip + TBD pricing (no published base pricing)", () => {
    const doc = parseNeuralwattModels(v1FixtureDoc());
    const row = bySlug(buildFlexCatalog(doc, perfDoc(), null, null, new Set())).get("deepseek-v4.1-flash-flex")!;
    assert.equal(row.membership, "perf-lane");
    assert.equal(row.preview, true);
    assert.equal(row.provenance, "tbd");
    assert.equal(row.inputPerMillion, null);
    assert.equal(row.outputPerMillion, null);
    assert.equal(row.cacheReadPerMillion, null);
    assert.equal(row.tbdReason, "base standard entry absent from /v1/models");
    assert.equal(formatFlexEntryDescription(row), "pricing TBD \u00b7 preview");
  });

  it("M7 lane-only fast variants pick up the FAMILY-SIBLING multiplier: derived prices, exact values", () => {
    const doc = parseNeuralwattModels(v1FixtureDoc());
    const list = buildFlexCatalog(doc, perfDoc(), null, null, new Set());
    const entries = bySlug(list);

    const kimiFast = entries.get("kimi-k3-fast-flex")!;
    assert.equal(kimiFast.membership, "perf-lane");
    assert.equal(kimiFast.provenance, "v1-derived");
    assert.equal(kimiFast.inputPerMillion, 1.95); // 3 x 0.65 (document value)
    assert.equal(kimiFast.outputPerMillion, 9.75); // 15 x 0.65
    assert.equal(kimiFast.cacheReadPerMillion, 0.195); // 0.3 x 0.65
    assert.equal(kimiFast.flexMultiplier, 0.65);
    assert.equal(kimiFast.multiplierOrigin, "family-sibling");
    assert.equal(kimiFast.family, "Kimi K3"); // document family
    assert.equal(kimiFast.preview, false);
    assert.equal(formatFlexEntryDescription(kimiFast), "$1.95 in \u00b7 $9.75 out /1M tok \u00b7 0.65\u00d7 derived");

    const qwenFast = entries.get("qwen3.6-35b-fast-flex")!;
    assert.equal(qwenFast.provenance, "v1-derived");
    assert.equal(qwenFast.inputPerMillion, 0.1885); // 0.29 x 0.65
    assert.equal(qwenFast.outputPerMillion, 0.7475); // 1.15 x 0.65
    assert.equal(qwenFast.cacheReadPerMillion, 0.01885); // 0.029 x 0.65
    assert.equal(qwenFast.multiplierOrigin, "family-sibling");
  });

  it("M7b preview lane-only row records the doc-harvest multiplier but stays TBD (no base pricing)", () => {
    const doc = parseNeuralwattModels(v1FixtureDoc());
    const row = bySlug(buildFlexCatalog(doc, perfDoc(), null, null, new Set())).get("deepseek-v4.1-flash-flex")!;
    assert.equal(row.provenance, "tbd");
    assert.equal(row.flexMultiplier, 0.65); // harvested, unused: base absent
    assert.equal(row.multiplierOrigin, "doc-harvest");
  });

  it("M8 v1-alias-only members still render when the perf document is absent/empty", () => {
    const doc = parseNeuralwattModels(v1FixtureDoc());
    for (const perf of [null, { lanes: [] }]) {
      const list = buildFlexCatalog(doc, perf, null, null, new Set());
      assert.equal(list.length, 7);
      assert.ok(list.every((e) => e.membership === "v1-alias"));
      assert.ok(list.every((e) => e.preview === false));
    }
  });

  it("M9 ghost regression: registry glm-5.2 aliases never render (documents are membership)", () => {
    const doc = parseNeuralwattModels(v1FixtureDoc());
    const registry = makeRegistry({
      "glm-5.2-flex": { cost: { input: 0.9, output: 2.8, cache_read: 0.09 } },
      "glm-5.2": { cost: { input: 1.4, output: 4.3, cache_read: 0.14 } },
    });
    const list = buildFlexCatalog(doc, perfDoc(), null, registry, new Set());
    assert.equal(list.some((e) => e.slug.startsWith("glm-5.2")), false);
    assert.equal(list.some((e) => e.slug === "glm-5.3-flex"), true);
  });

  it("M10 own-slug exclusion: board rows for base slugs keep the flex row; board rows for the flex slug suppress it", () => {
    const doc = parseNeuralwattModels(v1FixtureDoc());
    const keep = buildFlexCatalog(doc, perfDoc(), null, null, new Set(["kimi-k3", "glm-5.3"]));
    assert.equal(keep.some((e) => e.slug === "kimi-k3-flex"), true);
    assert.equal(keep.some((e) => e.slug === "glm-5.3-flex"), true);

    const suppressed = buildFlexCatalog(doc, perfDoc(), null, null, new Set(["kimi-k3-flex", "kimi-k3-fast-flex"]));
    assert.equal(suppressed.some((e) => e.slug === "kimi-k3-flex"), false);
    assert.equal(suppressed.some((e) => e.slug === "kimi-k3-fast-flex"), false);
    assert.equal(suppressed.length, 8);
  });

  it("M11 null docs -> []; a missing v1 doc still renders perf-lane members (TBD)", () => {
    assert.deepEqual(buildFlexCatalog(null, null, null, makeRegistry({}), new Set()), []);
    const laneOnly = buildFlexCatalog(null, perfDoc(), null, makeRegistry({}), new Set());
    assert.equal(laneOnly.length, 10);
    assert.ok(laneOnly.every((e) => e.membership === "perf-lane"));
    assert.ok(laneOnly.every((e) => e.provenance === "tbd"));
    assert.equal(laneOnly.filter((e) => e.preview).length, 1);
  });

  it("M12 shape-corrupt cached docs degrade to [] instead of throwing", () => {
    const junkDocs = [{ data: "not-an-array" }, { data: [null, 42, "junk"] }, {}];
    for (const bad of junkDocs) {
      assert.deepEqual(buildFlexCatalog(bad as never, null, null, makeRegistry({}), new Set()), []);
    }
    const junkPerf = [{ lanes: "nope" }, { lanes: [null, 42] }, {}];
    for (const bad of junkPerf) {
      const list = buildFlexCatalog(parseNeuralwattModels({ data: [] }), bad as never, null, null, new Set());
      assert.deepEqual(list, []);
    }
  });

  it("M13 sorts by input price asc with TBD rows last and slug tie-break", () => {
    const doc = parseNeuralwattModels({
      object: "list",
      data: [
        { id: "zzz-flex", metadata: { pricing: { input_per_million: 5, output_per_million: 1, service_tier: "flex" } } },
        { id: "bbb-flex", metadata: { pricing: { input_per_million: 1, output_per_million: 1, service_tier: "flex" } } },
        { id: "aaa-flex", metadata: { pricing: { service_tier: "flex" } } },
        { id: "ccc-flex", metadata: { pricing: { input_per_million: 1, output_per_million: 1, service_tier: "flex" } } },
      ],
    });
    const list = buildFlexCatalog(doc, null, null, null, new Set());
    assert.deepEqual(list.map((e) => e.slug), ["bbb-flex", "ccc-flex", "zzz-flex", "aaa-flex"]);
  });

  it("M14 treats a service_tier flex entry without the -flex suffix as its own base", () => {
    const doc = parseNeuralwattModels({
      object: "list",
      data: [{ id: "oddball", metadata: { pricing: { input_per_million: 1, output_per_million: 2, service_tier: "flex" } } }],
    });
    const list = buildFlexCatalog(doc, null, null, null, new Set());
    assert.equal(list.length, 1);
    assert.equal(list[0]!.slug, "oddball");
    assert.equal(list[0]!.baseSlug, "oddball");
    assert.equal(list[0]!.membership, "v1-alias");
  });
});

describe("flexCatalog pricing chain", () => {
  it("C1 API display_name wins over the registry name; registry enriches the rest", () => {
    const doc = parseNeuralwattModels(v1FixtureDoc());
    const registry = makeRegistry({
      "acme-flex": { name: "Registry Flex", family: "Acme Family", description: "registry description", last_updated: "2026-09-01" },
    });
    const withDoc = parseNeuralwattModels(
      v1FixtureDoc([
        ["acme", "Acme", "AcmeInc", 1000, "standard", null, 2, 1, 0.2],
        ["acme-flex", "Acme Flex (api)", "AcmeInc", 1000, "flex", 0.65, 1.3, 0.65, 0.13],
      ]),
    );
    const entry = buildFlexCatalog(withDoc, null, null, registry, new Set())[0]!;
    assert.equal(entry.name, "Acme Flex (api) (flex)");
    assert.equal(entry.family, "Acme Family");
    assert.equal(entry.description, "registry description");
    assert.equal(entry.lastUpdated, "2026-09-01");
    void doc;
  });

  it("C1b the (flex) label: exact aliases keep Neuralwatt's naming; members without the marker get it appended", () => {
    const doc = parseNeuralwattModels(
      v1FixtureDoc([
        ["acme", "Acme", "AcmeInc", 1000, "standard", null, 2, 1, 0.2],
        ["acme-flex", "Acme (flex)", "AcmeInc", 1000, "flex", 0.65, 1.3, 0.65, 0.13],
        ["acme-fast", "Acme Fast", "AcmeInc", 1000, "standard", null, 2, 1, 0.2],
      ]),
    );
    const perf = { lanes: [{ slug: "acme-fast", family: "Acme Family", flex: true, preview: false }] };
    const registry = makeRegistry({ "acme-fast": { name: "Acme Fast" } });
    const entries = buildFlexCatalog(doc, perf, null, registry, new Set());
    const exact = entries.find((e) => e.slug === "acme-flex")!;
    const derived = entries.find((e) => e.slug === "acme-fast-flex")!;
    assert.equal(exact.name, "Acme (flex)", "verbatim API display_name is untouched");
    assert.equal(derived.name, "Acme Fast (flex)", "derived members carry the marker in the name");
  });

  it("C2 models-dev fallback sits BEFORE the derived rung and keeps its provenance", () => {
    const doc = parseNeuralwattModels(
      v1FixtureDoc([["acme", "Acme", "AcmeInc", 1000, "standard", null, 2, 1, 0.2]]),
    );
    const registry = makeRegistry({
      "acme-flex": { cost: { input: 0.5, output: 1.5, cache_read: 0.05 } },
    });
    const perf = { lanes: [{ slug: "acme", family: "Acme Family", flex: true, preview: false }] };
    const entry = buildFlexCatalog(doc, perf, null, registry, new Set())[0]!;
    assert.equal(entry.slug, "acme-flex");
    assert.equal(entry.membership, "perf-lane");
    assert.equal(entry.provenance, "models-dev");
    assert.equal(entry.inputPerMillion, 0.5);
    assert.equal(entry.outputPerMillion, 1.5);
    assert.equal(entry.cacheReadPerMillion, 0.05);
    assert.equal(entry.family, "Acme Family");
  });

  it("C3 nothing available -> tbd with the exact missing-document reason", () => {
    const doc = parseNeuralwattModels({
      object: "list",
      data: [{ id: "orphan-flex", owned_by: "neuralwatt", metadata: { pricing: { service_tier: "flex" } } }],
    });
    const entry = buildFlexCatalog(doc, null, null, null, new Set())[0]!;
    assert.equal(entry.provenance, "tbd");
    assert.equal(entry.inputPerMillion, null);
    assert.equal(entry.outputPerMillion, null);
    assert.equal(entry.cacheReadPerMillion, null);
    assert.equal(entry.preview, false);
    assert.equal(entry.tbdReason, "base standard entry absent from /v1/models");
  });
});

describe("flexCatalog multiplier ladder", () => {
  /** One lane per family name (document family evidence). */
  const lanes = (...specs: Array<[string, string]>) => ({
    lanes: specs.map(([slug, family]) => ({ slug, family, flex: true, preview: false })),
  });
  const std = (id: string, input: number, output: number, cached: number | null): V1Row => [
    id, id, "X", 1000, "standard", null, input, output, cached,
  ];
  const flex = (id: string, mult: number | null, input: number | null = null, output: number | null = null, cached: number | null = null): V1Row => [
    id, id, "X", 1000, "flex", mult, input, output, cached,
  ];

  it("carries the base model's standard v1 prices for the Normal → Flex comparison", () => {
    const doc = parseNeuralwattModels(v1FixtureDoc([std("a", 2, 1, 0.2), flex("a-flex", 0.5, 1.2, 0.6, 0.1), std("b", 4, 2, null), flex("b-flex", 0.5)]));
    const entries = bySlug(buildFlexCatalog(doc, lanes(), null, null, new Set()));
    assert.deepEqual(entries.get("a-flex")!.standard, { inputPerMillion: 2, outputPerMillion: 1, cacheReadPerMillion: 0.2, source: "v1-standard" });
    assert.equal(entries.get("a-flex")!.inputPerMillion, 1.2);
    assert.deepEqual(entries.get("b-flex")!.standard, { inputPerMillion: 4, outputPerMillion: 2, cacheReadPerMillion: null, source: "v1-standard" });
  });

  it("L1 alias-own beats family-sibling (own rung short-circuits an ambiguous family)", () => {
    const doc = parseNeuralwattModels(
      v1FixtureDoc([std("a", 2, 1, 0.2), flex("a-flex", 0.5), std("b", 4, 2, 0.4), flex("b-flex", 0.9)]),
    );
    const list = buildFlexCatalog(doc, lanes(["a", "Fam"], ["b", "Fam"]), null, null, new Set());
    const entries = bySlug(list);
    const a = entries.get("a-flex")!;
    assert.equal(a.provenance, "v1-derived");
    assert.equal(a.inputPerMillion, 1); // 2 x 0.5 (own)
    assert.equal(a.multiplierOrigin, "alias-own");
    const b = entries.get("b-flex")!;
    assert.equal(b.inputPerMillion, 3.6); // 4 x 0.9 (own)
    assert.equal(b.multiplierOrigin, "alias-own");
  });

  it("L2 family-sibling resolves a member with no alias — even when the doc-wide harvest is ambiguous", () => {
    const rows: V1Row[] = [
      std("c", 10, 5, 1),
      std("d", 1, 1, null),
      flex("d-flex", 0.4),
      std("e", 1, 1, null),
      flex("e-flex", 0.9),
    ];
    const doc = parseNeuralwattModels(v1FixtureDoc(rows));
    assert.deepEqual(harvestDocMultiplier(doc), { distinct: [0.4, 0.9], value: null }); // harvest alone cannot resolve
    const list = buildFlexCatalog(doc, lanes(["c", "Fam2"], ["d", "Fam2"], ["e", "Fam4"]), null, null, new Set());
    const c = bySlug(list).get("c-flex")!;
    assert.equal(c.membership, "perf-lane");
    assert.equal(c.provenance, "v1-derived");
    assert.equal(c.inputPerMillion, 4); // 10 x 0.4 (family sibling)
    assert.equal(c.outputPerMillion, 2);
    assert.equal(c.cacheReadPerMillion, 0.4);
    assert.equal(c.multiplierOrigin, "family-sibling");
  });

  it("L3 disagreement -> derived row TBD with the reason; exact alias rows keep verbatim prices", () => {
    const rows: V1Row[] = [
      std("f", 2, 1, 0.2),
      flex("g-flex", 0.5, 0.9, 0.45, 0.09),
      flex("h-flex", 0.7, 1.2, 0.6, 0.12),
    ];
    const doc = parseNeuralwattModels(v1FixtureDoc(rows));
    const list = buildFlexCatalog(doc, lanes(["f", "Fam3"], ["g", "Fam3"], ["h", "Fam3"]), null, null, new Set());
    const entries = bySlug(list);
    const f = entries.get("f-flex")!;
    assert.equal(f.provenance, "tbd");
    assert.equal(f.inputPerMillion, null);
    assert.equal(f.tbdReason, "multiplier unavailable: document multipliers disagree");
    // Double-discount guard at full strength: exact aliases are verbatim, multiplier present or not.
    assert.equal(entries.get("g-flex")!.inputPerMillion, 0.9);
    assert.equal(entries.get("h-flex")!.inputPerMillion, 1.2);
    assert.equal(entries.get("g-flex")!.provenance, "v1-alias");
  });

  it("L4 no published multiplier anywhere -> TBD with the no-multiplier reason", () => {
    const doc = parseNeuralwattModels(v1FixtureDoc([std("i", 2, 1, 0.2), flex("i-flex", null)]));
    const row = buildFlexCatalog(doc, lanes(["i", "Fam5"]), null, null, new Set())[0]!;
    assert.equal(row.provenance, "tbd");
    assert.equal(row.tbdReason, "multiplier unavailable: document publishes no flex multiplier");
    assert.equal(row.flexMultiplier, null);
    assert.equal(row.multiplierOrigin, null);
  });

  it("L5 no own multiplier and no family sibling falls through to the doc-wide harvest", () => {
    const rows: V1Row[] = [
      std("k", 2, 1, 0.2),
      flex("k-flex", null),
      std("z", 1, 1, null),
      flex("z-flex", 0.25),
    ];
    const doc = parseNeuralwattModels(v1FixtureDoc(rows));
    const list = buildFlexCatalog(doc, lanes(["k", "FamK"], ["z", "FamZ"]), null, null, new Set());
    const k = bySlug(list).get("k-flex")!;
    assert.equal(k.provenance, "v1-derived");
    assert.equal(k.inputPerMillion, 0.5); // 2 x 0.25 (whole-document harvest)
    assert.equal(k.multiplierOrigin, "doc-harvest");
  });

  it("L6 models-dev registry hit keeps its position BEFORE the derived rung (multiplier available or not)", () => {
    const doc = parseNeuralwattModels(v1FixtureDoc([std("j", 2, 1, 0.2), flex("j-flex", 0.25)]));
    const registry = makeRegistry({ "j-flex": { cost: { input: 1, output: 2, cache_read: 0.1 } } });
    const row = buildFlexCatalog(doc, lanes(["j", "Fam6"]), null, registry, new Set())[0]!;
    assert.equal(row.provenance, "models-dev");
    assert.equal(row.inputPerMillion, 1);
    assert.equal(row.outputPerMillion, 2);
  });
});

describe("flexCatalog.harvestDocMultiplier", () => {
  it("H1 unanimous doc -> the single distinct value", () => {
    const doc = parseNeuralwattModels(v1FixtureDoc());
    assert.deepEqual(harvestDocMultiplier(doc), { distinct: [0.65], value: 0.65 });
  });

  it("H2 disagreeing doc -> null value with all distinct values reported", () => {
    const doc = parseNeuralwattModels(
      v1FixtureDoc([
        ["a", "A", "X", 10, "standard", null, 1, 1, null],
        ["a-flex", "A (flex)", "X", 10, "flex", 0.5, 0.5, 0.5, null],
        ["b", "B", "X", 10, "standard", null, 1, 1, null],
        ["b-flex", "B (flex)", "X", 10, "flex", 0.7, 0.7, 0.7, null],
      ]),
    );
    assert.deepEqual(harvestDocMultiplier(doc), { distinct: [0.5, 0.7], value: null });
  });

  it("H3 no flex entries / null doc -> empty harvest", () => {
    assert.deepEqual(harvestDocMultiplier(null), { distinct: [], value: null });
    const doc = parseNeuralwattModels(v1FixtureDoc([["a", "A", "X", 10, "standard", null, 1, 1, null]]));
    assert.deepEqual(harvestDocMultiplier(doc), { distinct: [], value: null });
  });
});

describe("flexCatalog.formatFlexEntryDescription", () => {
  function entry(partial: Partial<FlexEntry>): FlexEntry {
    return {
      slug: "x-flex", baseSlug: "x", name: "X", provider: "neuralwatt", family: null, context: null,
      inputPerMillion: 0.95, outputPerMillion: 4, cacheReadPerMillion: null,
      provenance: "v1-alias", membership: "both", preview: false, description: null, lastUpdated: null,
      ...partial,
    };
  }

  it("D1 v1-alias: plain price shape", () => {
    assert.equal(formatFlexEntryDescription(entry({})), "$0.95 in \u00b7 $4.00 out /1M tok");
  });

  it("D2 models-dev: suffix", () => {
    assert.equal(
      formatFlexEntryDescription(entry({ provenance: "models-dev" })),
      "$0.95 in \u00b7 $4.00 out /1M tok \u00b7 models.dev",
    );
  });

  it("D3 v1-derived: label built from the ACTUAL multiplier value (never a literal)", () => {
    assert.equal(
      formatFlexEntryDescription(entry({ provenance: "v1-derived", flexMultiplier: 0.65 })),
      "$0.95 in \u00b7 $4.00 out /1M tok \u00b7 0.65\u00d7 derived",
    );
    assert.equal(
      formatFlexEntryDescription(entry({ provenance: "v1-derived", flexMultiplier: 0.5 })),
      "$0.95 in \u00b7 $4.00 out /1M tok \u00b7 0.5\u00d7 derived",
    );
  });

  it("D4 tbd: pricing TBD (+ preview suffix)", () => {
    assert.equal(
      formatFlexEntryDescription(entry({ provenance: "tbd", inputPerMillion: null, outputPerMillion: null })),
      "pricing TBD",
    );
    assert.equal(
      formatFlexEntryDescription(entry({ provenance: "tbd", inputPerMillion: null, outputPerMillion: null, preview: true })),
      "pricing TBD \u00b7 preview",
    );
  });
});

describe("flexCatalog portal-card pricing rung", () => {
  const cardsDoc = () => parseFlexCatalogCards(cardsFixtureHtml());
  const perf = () => parseFlexPerfView(perfFixtureHtml());

  /** Minimal one-card cards doc for targeted rung tests. */
  const oneCardDoc = (id: string) =>
    parseFlexCatalogCards(
      `<article data-family="Acme" data-price="0.0002">` +
        `<a data-model-id="${id}"></a>` +
        `<div title="Cached input: $0.02/M tokens"><span>Output: <strong>$1.00/M</strong></span></div>` +
        `</article>`,
    )!;
  const acmeCards = () => oneCardDoc("acme");

  const flexRow = (id: string, mult: number | null): V1Row => [id, id, "X", 1000, "flex", mult, null, null, null];

  it("R1 ACCEPTANCE: the preview lane member with no /v1 entry is priced by its portal card x the doc-harvest multiplier", () => {
    // deepseek-v4.1-flash: perf flex lane + preview chip, ABSENT from /v1/models.
    // Card: data-price 0.00015 (input 0.15 exact), footer Output $0.60/M, title cached $0.02/M.
    const doc = parseNeuralwattModels(v1FixtureDoc());
    const row = bySlug(buildFlexCatalog(doc, perf(), cardsDoc(), null, new Set())).get("deepseek-v4.1-flash-flex")!;
    assert.equal(row.membership, "perf-lane"); // cards NEVER contribute membership
    assert.equal(row.preview, true);
    assert.equal(row.provenance, "portal-card");
    assert.equal(row.inputPerMillion, 0.0975); // (0.00015 x 1000) x 0.65
    assert.equal(row.outputPerMillion, 0.39); // 0.60 x 0.65
    assert.equal(row.cacheReadPerMillion, 0.013); // 0.02 x 0.65
    assert.equal(row.flexMultiplier, 0.65); // doc-harvest: all 7 v1 flex aliases agree
    assert.equal(row.multiplierOrigin, "doc-harvest");
    assert.equal(row.name, "DeepSeek V4.1 Flash (flex)"); // card data-name fills the name gap (no v1/registry entry)
    assert.equal(
      formatFlexEntryDescription(row),
      "$0.10 in \u00b7 $0.39 out /1M tok \u00b7 0.65\u00d7 derived (portal card)",
    );
  });

  it("R2 rung order: v1-alias, models-dev and v1-derived all keep beating an existing card", () => {
    const doc = parseNeuralwattModels(v1FixtureDoc());
    const entries = bySlug(buildFlexCatalog(doc, perf(), cardsDoc(), null, new Set()));

    // Exact alias + card both exist -> alias verbatim, card ignored.
    const alias = entries.get("glm-5.3-flex")!;
    assert.equal(alias.provenance, "v1-alias");
    assert.equal(alias.inputPerMillion, 0.9425);
    assert.equal(alias.outputPerMillion, 2.925);

    // Lane member with a v1 std base + card -> v1-derived (not portal-card).
    const derived = entries.get("kimi-k3-fast-flex")!;
    assert.equal(derived.provenance, "v1-derived");
    assert.equal(derived.inputPerMillion, 1.95);
    assert.equal(derived.outputPerMillion, 9.75);
  });

  it("R2b models-dev keeps its position ahead of the card rung", () => {
    const doc = parseNeuralwattModels(v1FixtureDoc([["acme", "Acme", "AcmeInc", 1000, "standard", null, 2, 1, 0.2]]));
    const registry = makeRegistry({ "acme-flex": { cost: { input: 0.5, output: 1.5, cache_read: 0.05 } } });
    const perfLane = { lanes: [{ slug: "acme", family: "Acme Family", flex: true, preview: false }] };
    const entry = buildFlexCatalog(doc, perfLane, acmeCards(), registry, new Set())[0]!;
    assert.equal(entry.provenance, "models-dev");
    assert.equal(entry.inputPerMillion, 0.5);
  });

  it("R3 the card rung fires only when the base v1 std prices are absent/unusable", () => {
    // Base entry EXISTS but publishes no prices -> rung 3 skips -> card x alias-own mult.
    const rows: V1Row[] = [
      ["acme", "Acme", "X", 1000, "standard", null, null, null, null],
      ["acme-flex", "Acme (flex)", "X", 1000, "flex", 0.5, null, null, null],
    ];
    const doc = parseNeuralwattModels(v1FixtureDoc(rows));
    const entry = buildFlexCatalog(doc, null, acmeCards(), null, new Set())[0]!;
    assert.equal(entry.provenance, "portal-card");
    assert.equal(entry.inputPerMillion, 0.1); // 0.2 x 0.5
    assert.equal(entry.outputPerMillion, 0.5); // 1.00 x 0.5
    assert.equal(entry.cacheReadPerMillion, 0.01); // 0.02 x 0.5
    assert.equal(entry.multiplierOrigin, "alias-own");
  });

  it("R4 CARDS NEVER SUPPLY MULTIPLIERS: card-only prices with a null ladder still render TBD", () => {
    // The v1 doc publishes no multiplier anywhere; the base has no entry; the
    // card HAS prices for the base id. The tbd (mult.reason) from the ladder
    // stands — a card never overrides it.
    const doc = parseNeuralwattModels(v1FixtureDoc([flexRow("x-flex", null)]));
    const entry = buildFlexCatalog(doc, null, oneCardDoc("x"), null, new Set()).find((e) => e.slug === "x-flex")!;
    assert.equal(entry.provenance, "tbd");
    assert.equal(entry.inputPerMillion, null);
    assert.equal(entry.outputPerMillion, null);
    assert.equal(entry.tbdReason, "multiplier unavailable: document publishes no flex multiplier");
  });

  it("R5 card absent + v1 absent (cards doc fetched) -> tbd reason names BOTH sources", () => {
    const doc = parseNeuralwattModels(v1FixtureDoc([flexRow("y-flex", 0.5)]));
    const entry = buildFlexCatalog(doc, null, acmeCards(), null, new Set()).find((e) => e.slug === "y-flex")!;
    assert.equal(entry.provenance, "tbd");
    assert.equal(entry.tbdReason, "base standard entry absent from /v1/models and no portal /models card prices it");
  });

  it("R6 no cards doc fetched -> tbd reason stays v1-only (no card noise)", () => {
    const doc = parseNeuralwattModels(v1FixtureDoc([flexRow("y-flex", 0.5)]));
    const entry = buildFlexCatalog(doc, null, null, null, new Set()).find((e) => e.slug === "y-flex")!;
    assert.equal(entry.tbdReason, "base standard entry absent from /v1/models");
  });

  it("R7 shape-corrupt cards docs degrade like the other docs (no throw, pricing falls through)", () => {
    const doc = parseNeuralwattModels(v1FixtureDoc());
    for (const badCards of [{ cards: 42 }, { cards: [null, "junk"] }, {}]) {
      const list = buildFlexCatalog(doc, perf(), badCards as never, null, new Set());
      // deepseek-v4.1-flash falls back to TBD (no card survived), everything else unchanged.
      const row = bySlug(list).get("deepseek-v4.1-flash-flex")!;
      assert.equal(row.provenance, "tbd");
      assert.equal(list.filter((e) => e.provenance === "v1-alias").length, 7);
    }
  });

  it("R8 with the cards doc present the catalog still derives every pre-existing row identically", () => {
    const doc = parseNeuralwattModels(v1FixtureDoc());
    const withoutCards = buildFlexCatalog(doc, perf(), null, null, new Set());
    const withCards = buildFlexCatalog(doc, perf(), cardsDoc(), null, new Set());
    // Exactly one row changes: the previously-TBD preview row becomes portal-card.
    assert.equal(withoutCards.length, withCards.length);
    const changed = withCards.filter((e, i) => {
      const before = withoutCards.find((x) => x.slug === e.slug)!;
      return before.provenance !== e.provenance || before.inputPerMillion !== e.inputPerMillion;
    });
    assert.deepEqual(changed.map((e) => e.slug), ["deepseek-v4.1-flash-flex"]);
  });

  it("R9 MEMBERSHIP REGRESSION: the fast id its family card lists must NOT become a row", () => {
    // The card doc prices EVERY listed id — including the fast variant that
    // has no -flex alias and no perf lane. Pricing fallback joins by id onto
    // EXISTING members only; membership stays v1 aliases + perf flex lanes.
    const cards = cardsDoc();
    assert.ok(flexCardById(cards, "kimi-k2.7-code-fast")); // the card would price it...
    const doc = parseNeuralwattModels(v1FixtureDoc());
    const list = buildFlexCatalog(doc, perf(), cards, null, new Set());
    assert.equal(list.some((e) => e.slug.includes("kimi-k2.7-code-fast")), false); // ...but it is no member
    // The legitimately-priced member of the same family card is untouched.
    assert.equal(bySlug(list).get("kimi-k2.7-code-flex")!.provenance, "v1-alias");
    // And the card-free exclusion (M4) keeps holding without the cards doc too.
    assert.equal(buildFlexCatalog(doc, perf(), null, null, new Set()).some((e) => e.slug.includes("kimi-k2.7-code-fast")), false);
  });

  it("R10 board own-slug exclusion is unaffected by the cards doc", () => {
    const doc = parseNeuralwattModels(v1FixtureDoc());
    const suppressed = buildFlexCatalog(doc, perf(), cardsDoc(), null, new Set(["kimi-k3-flex", "kimi-k3-fast-flex"]));
    assert.equal(suppressed.some((e) => e.slug === "kimi-k3-flex"), false);
    assert.equal(suppressed.some((e) => e.slug === "kimi-k3-fast-flex"), false);
    // A board row for the BASE slug still keeps the flex row (portal-card priced or not).
    const keep = buildFlexCatalog(doc, perf(), cardsDoc(), null, new Set(["kimi-k3"]));
    assert.equal(keep.some((e) => e.slug === "kimi-k3-flex"), true);
  });
});

/** Typed alias so the V1Row import is exercised in this suite too. */
export type { V1Row };
