import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FlexEntry, FlexSources } from "../src/core/flexCatalog";
import type { NeuralwattModelsDoc } from "../src/core/flexCatalog";
import { buildThinkingMap, thinkingFor } from "../src/core/thinking";
import type { ThinkingInfo } from "../src/core/thinking";
import type { ValuedQuote } from "../src/core/types";
import { buildFlexTooltipMd } from "../src/core/flexHover";

const PRICING_URL = "https://portal.neuralwatt.com/energy-pricing";

function entry(over?: Partial<FlexEntry>): FlexEntry {
  return {
    slug: "model-a-flex",
    baseSlug: "model-a",
    name: "Model A (flex)",
    provider: "neuralwatt",
    family: "Family A",
    context: 131072,
    inputPerMillion: 0.6,
    outputPerMillion: 2.4,
    cacheReadPerMillion: 0.12,
    provenance: "v1-alias",
    membership: "both",
    flexMultiplier: 0.7,
    multiplierOrigin: "alias-own",
    preview: false,
    tbdReason: null,
    description: "Fast tier for Model A.",
    lastUpdated: "2026-11-01",
    standard: { inputPerMillion: 1, outputPerMillion: 4, cacheReadPerMillion: 0.2, source: "v1-standard" },
    ...over,
  };
}

function sources(over?: Partial<FlexSources>): FlexSources {
  return {
    v1: { url: "https://api.neuralwatt.com/v1/models", fetchedAt: "2026-11-08T10:30:00Z" },
    perf: { url: "https://portal.neuralwatt.com/energy-pricing?view=performance", fetchedAt: "2026-11-08T10:29:00Z" },
    cards: null,
    ...over,
  };
}

function boardRow(over?: Partial<ValuedQuote>): ValuedQuote {
  return {
    quote: {
      displayName: "Model A",
      slug: "model-a",
      isPreview: false,
      contextBand: null,
      cachePct: null,
      rightNowMwh: 22.31,
      typicalMwh: 20,
      trend: null,
      sparkline: null,
      bands: [],
      capturedAt: "2026-11-08T10:00:00Z",
    },
    basisMwh: 20,
    score: null,
    value: null,
    costPer1kUsd: 0.2231,
    descriptionMwh: 22.31,
    ...over,
  };
}

describe("flexHover - Flex hover markdown (Variant B KPI strip + tables)", () => {
  it("priced entry with a matched board row: includes KPI strip, price table, energy table, and provenance", () => {
    const md = buildFlexTooltipMd(entry(), sources(), boardRow(), { pricingUrl: PRICING_URL });
    assert.ok(md.includes("| Flex in/out (1M) | Dispatch wait | Multiplier |"));
    assert.ok(md.includes("| **$0.60 / $2.40** | — | **0.7×** |"));
    assert.ok(md.includes("| vs Normal below | — | 131k ctx |"));
    assert.ok(md.includes("| Input | $1.00 | $0.60 | **−40%** |"));
    assert.ok(md.includes("| Charged | 22.31 mWh | 15.62 mWh | **−30%** |"));
    assert.ok(!md.includes("Cache read"), "drops Cache read row");
    assert.ok(!md.includes("_Consumed ="), "drops formula footnote");
    assert.ok(!md.includes("Fast tier for Model A."), "drops description paragraph");
    assert.ok(md.includes("_Sources: perf · /v1/models · exact_"));
  });

  it("TBD-priced entry: shows TBD reason in KPI strip and no live energy", () => {
    const md = buildFlexTooltipMd(
      entry({
        slug: "model-b-flex",
        baseSlug: "model-b",
        name: "Model B (flex)",
        family: null,
        context: null,
        inputPerMillion: null,
        outputPerMillion: null,
        cacheReadPerMillion: null,
        provenance: "tbd",
        membership: "perf-lane",
        flexMultiplier: null,
        multiplierOrigin: null,
        tbdReason: "multiplier unavailable: document publishes no flex multiplier",
        description: null,
        lastUpdated: null,
        preview: true,
        standard: null,
      }),
      sources({ perf: { url: "https://portal.neuralwatt.com/energy-pricing?view=performance", fetchedAt: null } }),
      boardRow(),
      { pricingUrl: PRICING_URL },
    );
    assert.ok(md.includes("| — | — | — |"));
    assert.ok(md.includes("multiplier unavailable: document publishes no flex multiplier"));
    assert.ok(!md.includes("_No live energy data"), "drops no-energy footnote");
    assert.ok(md.includes("_Sources: perf · TBD_"));
  });

  it("entry with no matched board row: shows KPI strip + price table + no live energy", () => {
    const md = buildFlexTooltipMd(
      entry({
        slug: "model-c-flex",
        baseSlug: "model-c",
        name: "Model C (flex)",
        family: "Family C",
        context: 65536,
        lastUpdated: "2026-10-30",
      }),
      sources({ v1: { url: "https://api.neuralwatt.com/v1/models", fetchedAt: "2026-11-08T09:00:00Z" }, perf: null }),
      null,
      { pricingUrl: PRICING_URL },
    );
    assert.ok(md.includes("| **$0.60 / $2.40** | — | **0.7×** |"));
    assert.ok(md.includes("| vs Normal below | — | 66k ctx |"));
    assert.ok(md.includes("| Input | $1.00 | $0.60 | **−40%** |"));
    assert.ok(md.includes("_Sources: perf · /v1/models · exact_"));
  });

  it("hostile name and slug are escaped, and the command arg stays hazard-free", () => {
    const md = buildFlexTooltipMd(
      entry({ name: "<img src=x onerror=1>", slug: "p(a)r`en`[x]", description: "<script>alert(1)</script>" }),
      null,
      null,
      { pricingUrl: PRICING_URL },
    );
    assert.ok(!md.includes("<img"), "raw <img must never survive into md.value");
    assert.ok(!md.includes("<script>"), "raw <script> must never survive into md.value");
    assert.ok(md.includes("&lt;img src=x onerror=1&gt;"), "name renders as literal text via entities");
    assert.ok(md.includes("`p\\(a\\)r\\`en\\`\\[x\\]`"), "slug escapes parens, backticks and brackets");
    assert.ok(md.includes("%28") && md.includes("%29"), "copySlug arg percent-encodes parentheses");
    assert.equal(md.match(/command:neuraldash\.copySlug\?[^)]+\)/g)?.length, 1, "exactly one closed copySlug link");
  });
});


describe("flexHover - thinking line on Flex hovers", () => {
  function info(over?: Partial<ThinkingInfo>): ThinkingInfo {
    return {
      supported: true,
      mandatory: false,
      defaultEnabled: true,
      defaultEffort: "high",
      efforts: ["max", "xhigh", "high", "low", "none"],
      ...over,
    };
  }

  function doc(data: unknown[]): NeuralwattModelsDoc {
    return { data } as unknown as NeuralwattModelsDoc;
  }

  it("renders the Thinking line after the unified table and before Sources", () => {
    const md = buildFlexTooltipMd(entry(), sources(), boardRow(), { pricingUrl: PRICING_URL, thinking: info() });
    const charged = md.indexOf("| Charged |");
    const think = md.indexOf("**Thinking**");
    const src = md.indexOf("_Sources:");
    assert.ok(charged > 0, "charged row present in unified table");
    assert.ok(think > charged, "thinking line after unified table");
    assert.ok(src > think, "thinking line before Sources");
    assert.ok(
      md.includes("**Thinking** · on (high) · max, xhigh, high, low, none"),
      md,
    );
  });

  it("uses the Flex entry's own catalog data when its id is listed", () => {
    const map = buildThinkingMap(doc([
      { id: "model-a-flex", metadata: { reasoning: { mandatory: true, supported_efforts: ["max", "high"] } } },
      { id: "model-a", metadata: { reasoning: { default_enabled: true, default_effort: "low", supported_efforts: ["low", "none"] } } },
    ]));
    const hit = thinkingFor(map, ["model-a-flex", "model-a"]);
    assert.ok(hit);
    assert.equal(hit.mandatory, true);
    const md = buildFlexTooltipMd(entry(), sources(), boardRow(), { pricingUrl: PRICING_URL, thinking: hit });
    assert.ok(md.includes("**Thinking** · always on · max, high"), md);
  });

  it("falls back to the base model's data when the Flex id is missing from the catalog", () => {
    const map = buildThinkingMap(doc([
      { id: "model-a", metadata: { reasoning: { default_enabled: true, default_effort: "low", supported_efforts: ["low", "none"] } } },
    ]));
    const hit = thinkingFor(map, ["model-a-flex", "model-a"]);
    assert.ok(hit);
    assert.equal(hit.mandatory, false);
    const md = buildFlexTooltipMd(entry(), sources(), boardRow(), { pricingUrl: PRICING_URL, thinking: hit });
    assert.ok(md.includes("**Thinking** · on (low) · low, none"), md);
  });

  it("no Thinking line when neither the Flex id nor the base slug is listed", () => {
    const map = buildThinkingMap(doc([
      { id: "model-a", metadata: { reasoning: { default_enabled: true, default_effort: "low", supported_efforts: ["low"] } } },
    ]));
    assert.equal(thinkingFor(map, ["model-z-flex", "model-z"]), null);
    for (const t of [null, undefined]) {
      const md = buildFlexTooltipMd(entry(), sources(), boardRow(), { pricingUrl: PRICING_URL, thinking: t });
      assert.ok(!md.includes("**Thinking**"), "no thinking line");
    }
  });

  it("output is byte-identical to the ticket-01 baseline when thinking info is absent", () => {
    const baseline = buildFlexTooltipMd(entry(), sources(), boardRow(), { pricingUrl: PRICING_URL });
    assert.equal(buildFlexTooltipMd(entry(), sources(), boardRow(), { pricingUrl: PRICING_URL, thinking: null }), baseline);
    assert.equal(buildFlexTooltipMd(entry(), sources(), boardRow(), { pricingUrl: PRICING_URL, thinking: undefined }), baseline);
    const tbdBaseline = buildFlexTooltipMd(entry({ provenance: "tbd", membership: "perf-lane" }), sources(), null, { pricingUrl: PRICING_URL });
    assert.equal(buildFlexTooltipMd(entry({ provenance: "tbd", membership: "perf-lane" }), sources(), null, { pricingUrl: PRICING_URL, thinking: null }), tbdBaseline);
  });

  it("escapes hostile effort strings in the rendered line", () => {
    const md = buildFlexTooltipMd(
      entry(),
      sources(),
      boardRow(),
      { pricingUrl: PRICING_URL, thinking: info({ defaultEffort: "<b>&x", efforts: ["<img src=src>", "(paren)", "*em*", "a_b"] }) },
    );
    assert.ok(md.includes("**Thinking** · on (&lt;b&gt;&amp;x)"), md);
    assert.ok(md.includes("&lt;img src=src&gt;, \\(paren\\), \\*em\\*, a\\_b"), md);
    assert.ok(md.includes("**Thinking** · on"), "chrome stays bold, not escaped");
    assert.ok(!md.includes("<img"), "no raw html survives");
  });
});

describe("flexHover - same-weights thinking note on Flex hovers", () => {
  it("renders the note for an unsupported Flex-row thinking info", () => {
    const map = buildThinkingMap({
      data: [
        { id: "lane-fast", metadata: { huggingface_id: "weights-shared", capabilities: { reasoning: false } } },
        { id: "base-a", metadata: { huggingface_id: "weights-shared", reasoning: { mandatory: false, default_enabled: true, default_effort: "high", supported_efforts: ["max", "high"] } } },
      ],
    } as unknown as NeuralwattModelsDoc);
    const md = buildFlexTooltipMd(entry(), sources(), boardRow(), { pricingUrl: PRICING_URL, thinking: map.get("lane-fast") ?? null });
    assert.ok(md.includes("**Thinking** \u00b7 not available \u00b7 same weights: on (high)"), md);
  });
});
