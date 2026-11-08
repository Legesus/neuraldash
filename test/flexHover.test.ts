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

describe("flexHover - Flex hover markdown parity with the pre-prefactor inline code", () => {
  it("priced entry with a matched board row: full markdown equals the legacy output", () => {
    assert.equal(buildFlexTooltipMd(entry(), sources(), boardRow(), { pricingUrl: PRICING_URL }), "**Model A \\(flex\\)** · Flex  \n`model-a-flex` · neuralwatt · Family A\n\nFast tier for Model A.\n\n| /1M tok | Normal | → Flex | Saving |\n|---|---:|---:|---:|\n| Input | $1.00 | $0.60 | **−40%** |\n| Output | $4.00 | $2.40 | **−40%** |\n| Cache read | $0.20 | $0.12 | **−40%** |\n\n131k context tokens · Flex multiplier 0.7× · Normal from /v1/models\n\n| Energy / req | Normal | → Flex | Saving |\n|---|---:|---:|---:|\n| Charged | 22.31 mWh | 15.62 mWh | **−30%** |\n| Cost / 1k req | $0.22 | $0.16 | **−30%** |\n\n_Consumed = board right-now for `model-a` · charged = consumed × Flex multiplier · updated 2026-11-01_\n\n_Sources: perf view 11-08 10:29 · /v1/models 11-08 10:30 · pricing exact_\n\n\n[Copy Slug](command:neuraldash.copySlug?%7B%22slug%22%3A%22model-a-flex%22%7D) · [Open Pricing Page ↗](<https://portal.neuralwatt.com/energy-pricing>)");
  });

  it("TBD-priced entry: full markdown equals the legacy output", () => {
    assert.equal(
      buildFlexTooltipMd(
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
      ),
      "**Model B \\(flex\\)** · Flex  \n`model-b-flex` · neuralwatt\n\n_Pricing TBD: multiplier unavailable: document publishes no flex multiplier_\n\n- context tokens\n\n_No live energy data for Flex rows_\n\n_Sources: perf view time unknown · pricing TBD_\n\n\n[Copy Slug](command:neuraldash.copySlug?%7B%22slug%22%3A%22model-b-flex%22%7D) · [Open Pricing Page ↗](<https://portal.neuralwatt.com/energy-pricing>)",
    );
  });

  it("entry with no matched board row: full markdown equals the legacy output", () => {
    assert.equal(
      buildFlexTooltipMd(
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
      ),
      "**Model C \\(flex\\)** · Flex  \n`model-c-flex` · neuralwatt · Family C\n\nFast tier for Model A.\n\n| /1M tok | Normal | → Flex | Saving |\n|---|---:|---:|---:|\n| Input | $1.00 | $0.60 | **−40%** |\n| Output | $4.00 | $2.40 | **−40%** |\n| Cache read | $0.20 | $0.12 | **−40%** |\n\n66k context tokens · Flex multiplier 0.7× · Normal from /v1/models\n\n_No live energy data for Flex rows · updated 2026-10-30_\n\n_Sources: perf view time unknown · /v1/models 11-08 09:00 · pricing exact_\n\n\n[Copy Slug](command:neuraldash.copySlug?%7B%22slug%22%3A%22model-c-flex%22%7D) · [Open Pricing Page ↗](<https://portal.neuralwatt.com/energy-pricing>)",
    );
  });

  it("hostile name, slug and description are escaped, and the command arg stays hazard-free", () => {
    const md = buildFlexTooltipMd(
      entry({ name: "<img src=x onerror=1>", slug: "p(a)r`en`[x]", description: "<script>alert(1)</script>" }),
      null,
      null,
      { pricingUrl: PRICING_URL },
    );
    assert.ok(!md.includes("<img"), "raw <img must never survive into md.value");
    assert.ok(!md.includes("<script>"), "raw <script> must never survive into md.value");
    assert.ok(md.includes("&lt;img src=x onerror=1&gt;"), "name renders as literal text via entities");
    assert.ok(md.includes("&lt;script&gt;alert\\(1\\)&lt;/script&gt;"), "description renders as literal text via entities");
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

  it("renders the Thinking line after the context/multiplier notes line, before the energy table", () => {
    const md = buildFlexTooltipMd(entry(), sources(), boardRow(), { pricingUrl: PRICING_URL, thinking: info() });
    const notes = md.indexOf("context tokens");
    const think = md.indexOf("**Thinking**");
    const energy = md.indexOf("| Energy / req |");
    assert.ok(notes > 0, "tier notes line present");
    assert.ok(think > notes, "thinking line after the notes line");
    assert.ok(energy > think, "thinking line before the energy table");
    assert.ok(
      md.includes("**Thinking** · on by default (high) · levels: max, xhigh, high, low, none · /v1/models"),
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
    assert.ok(md.includes("**Thinking** · always on · levels: max, high · /v1/models"), md);
  });

  it("falls back to the base model's data when the Flex id is missing from the catalog", () => {
    const map = buildThinkingMap(doc([
      { id: "model-a", metadata: { reasoning: { default_enabled: true, default_effort: "low", supported_efforts: ["low", "none"] } } },
    ]));
    const hit = thinkingFor(map, ["model-a-flex", "model-a"]);
    assert.ok(hit);
    assert.equal(hit.mandatory, false);
    const md = buildFlexTooltipMd(entry(), sources(), boardRow(), { pricingUrl: PRICING_URL, thinking: hit });
    assert.ok(md.includes("**Thinking** · on by default (low) · levels: low, none · /v1/models"), md);
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
    assert.ok(md.includes("**Thinking** · on by default (&lt;b&gt;&amp;x)"), md);
    assert.ok(md.includes("levels: &lt;img src=src&gt;, \\(paren\\), \\*em\\*, a\\_b"), md);
    assert.ok(md.includes("**Thinking** · on by default"), "chrome stays bold, not escaped");
    assert.ok(!md.includes("<img"), "no raw html survives");
  });
});
