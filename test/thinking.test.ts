import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { NeuralwattModelsDoc } from "../src/core/flexCatalog";
import type { ValuedQuote } from "../src/core/types";
import { buildThinkingMap, thinkingFor, formatThinkingLine } from "../src/core/thinking";
import type { ThinkingInfo } from "../src/core/thinking";
import { buildModelTooltipMd } from "../src/core/rowView";

function doc(data: unknown[]): NeuralwattModelsDoc {
  return { data } as unknown as NeuralwattModelsDoc;
}

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

describe("thinking - buildThinkingMap (catalog document -> thinking info)", () => {
  it("always on: mandatory entry with capabilities.reasoning true", () => {
    const map = buildThinkingMap(doc([
      {
        id: "model-a",
        metadata: {
          capabilities: { reasoning: true },
          reasoning: { mandatory: true, default_enabled: true, default_effort: "max", supported_efforts: ["max", "high", "low"] },
        },
      },
    ]));
    assert.deepEqual(map.get("model-a"), {
      supported: true,
      mandatory: true,
      defaultEnabled: true,
      defaultEffort: "max",
      efforts: ["max", "high", "low"],
    } satisfies ThinkingInfo);
  });

  it("on by default: availability falls back to non-empty supported_efforts when capabilities.reasoning is absent", () => {
    const map = buildThinkingMap(doc([
      {
        id: "model-b",
        metadata: {
          reasoning: { mandatory: false, default_enabled: true, default_effort: "high", supported_efforts: ["max", "xhigh", "high", "low", "none"] },
        },
      },
    ]));
    assert.deepEqual(map.get("model-b"), {
      supported: true,
      mandatory: false,
      defaultEnabled: true,
      defaultEffort: "high",
      efforts: ["max", "xhigh", "high", "low", "none"],
    } satisfies ThinkingInfo);
  });

  it("off by default: default effort is recorded even though the display omits it", () => {
    const map = buildThinkingMap(doc([
      { id: "model-c", metadata: { reasoning: { mandatory: false, default_enabled: false, default_effort: "high", supported_efforts: ["max", "none"] } } },
    ]));
    assert.deepEqual(map.get("model-c"), {
      supported: true,
      mandatory: false,
      defaultEnabled: false,
      defaultEffort: "high",
      efforts: ["max", "none"],
    } satisfies ThinkingInfo);
  });

  it("not available: explicit capabilities.reasoning false wins over published efforts", () => {
    const map = buildThinkingMap(doc([
      { id: "model-d", metadata: { capabilities: { reasoning: false }, reasoning: { mandatory: false, default_enabled: false, supported_efforts: ["none"] } } },
    ]));
    assert.deepEqual(map.get("model-d"), {
      supported: false,
      mandatory: false,
      defaultEnabled: false,
      defaultEffort: null,
      efforts: ["none"],
    } satisfies ThinkingInfo);
  });

  it("not available: reasoning block present but no efforts and no capabilities flag", () => {
    const map = buildThinkingMap(doc([
      { id: "model-e", metadata: { reasoning: { mandatory: false, default_enabled: false } } },
    ]));
    assert.deepEqual(map.get("model-e"), {
      supported: false,
      mandatory: false,
      defaultEnabled: false,
      defaultEffort: null,
      efforts: [],
    } satisfies ThinkingInfo);
  });

  it("missing reasoning block: entry appears nowhere in the map (no line, never a guess)", () => {
    const map = buildThinkingMap(doc([
      { id: "model-f", metadata: { display_name: "Model F" } },
      { id: "model-g" },
    ]));
    assert.equal(map.size, 0);
    assert.equal(map.get("model-f"), undefined);
    assert.equal(map.get("model-g"), undefined);
  });

  it("malformed entries are skipped while good entries survive", () => {
    const map = buildThinkingMap(doc([
      null,
      42,
      "junk",
      { metadata: { reasoning: { default_enabled: true } } },
      { id: "" },
      { id: "model-bad", metadata: { reasoning: "not-a-record" } },
      { id: "model-bad2", metadata: "not-a-record" },
      { id: "model-good", metadata: { reasoning: { default_enabled: true, supported_efforts: ["high"] } } },
    ]));
    assert.equal(map.size, 1);
    assert.deepEqual(map.get("model-good"), {
      supported: true,
      mandatory: false,
      defaultEnabled: true,
      defaultEffort: null,
      efforts: ["high"],
    } satisfies ThinkingInfo);
  });

  it("duplicate efforts are de-duplicated in first-seen order; non-string and empty efforts dropped", () => {
    const map = buildThinkingMap(doc([
      { id: "model-h", metadata: { reasoning: { default_enabled: true, supported_efforts: ["max", "high", "max", 42, "", "low", "high"] } } },
    ]));
    assert.deepEqual(map.get("model-h")?.efforts, ["max", "high", "low"]);
  });

  it("non-boolean flags and non-string default effort degrade to defaults", () => {
    const map = buildThinkingMap(doc([
      { id: "model-i", metadata: { reasoning: { mandatory: "yes", default_enabled: 1, default_effort: 42, supported_efforts: ["high"] } } },
    ]));
    assert.deepEqual(map.get("model-i"), {
      supported: true,
      mandatory: false,
      defaultEnabled: false,
      defaultEffort: null,
      efforts: ["high"],
    } satisfies ThinkingInfo);
  });

  it("null and absent documents degrade to an empty map", () => {
    assert.equal(buildThinkingMap(null).size, 0);
    assert.equal(buildThinkingMap({} as unknown as NeuralwattModelsDoc).size, 0);
    assert.equal(buildThinkingMap({ data: "junk" } as unknown as NeuralwattModelsDoc).size, 0);
    assert.equal(buildThinkingMap({ data: [] } as unknown as NeuralwattModelsDoc).size, 0);
  });
});

describe("thinking - thinkingFor (candidate-id lookup)", () => {
  const map = buildThinkingMap(doc([
    { id: "model-a", metadata: { reasoning: { default_enabled: true, default_effort: "low", supported_efforts: ["low"] } } },
    { id: "model-b", metadata: { reasoning: { mandatory: true, supported_efforts: ["max"] } } },
  ]));

  it("returns the info of the first candidate present in the map", () => {
    assert.equal(thinkingFor(map, ["nope", "model-b", "model-a"])?.defaultEffort, null);
    assert.equal(thinkingFor(map, ["model-a", "model-b"])?.defaultEffort, "low");
  });

  it("skips null and empty candidates", () => {
    assert.equal(thinkingFor(map, [null, undefined, "", "model-a"])?.defaultEffort, "low");
  });

  it("returns null when no candidate matches", () => {
    assert.equal(thinkingFor(map, ["zzz"]), null);
    assert.equal(thinkingFor(map, []), null);
  });
});

describe("thinking - formatThinkingLine (summary text)", () => {
  it("on by default with default effort and levels", () => {
    assert.equal(
      formatThinkingLine(info()),
      "**Thinking** · on by default (high) · levels: max, xhigh, high, low, none · /v1/models",
    );
  });

  it("always on", () => {
    assert.equal(
      formatThinkingLine(info({ mandatory: true, defaultEffort: "max", efforts: ["max", "high", "low"] })),
      "**Thinking** · always on (max) · levels: max, high, low · /v1/models",
    );
  });

  it("off by default omits the default effort even when published", () => {
    assert.equal(
      formatThinkingLine(info({ defaultEnabled: false, defaultEffort: "high", efforts: ["max", "none"] })),
      "**Thinking** · off by default · levels: max, none · /v1/models",
    );
  });

  it("not available", () => {
    assert.equal(formatThinkingLine(info({ supported: false })), "**Thinking** · not available · /v1/models");
  });

  it("omits the effort segment when unpublished and the levels segment when empty", () => {
    assert.equal(
      formatThinkingLine(info({ defaultEffort: null, efforts: [] })),
      "**Thinking** · on by default · /v1/models",
    );
  });

  it("shows efforts verbatim in published order", () => {
    assert.equal(
      formatThinkingLine(info({ defaultEffort: null, efforts: ["zeta", "alpha", "none"] })),
      "**Thinking** · on by default · levels: zeta, alpha, none · /v1/models",
    );
  });
});

describe("thinking - model hover seam (buildModelTooltipMd)", () => {
  function valued(): ValuedQuote {
    return {
      quote: {
        displayName: "Model A",
        slug: "model-a",
        isPreview: false,
        contextBand: null,
        cachePct: null,
        rightNowMwh: 22.31,
        typicalMwh: 20.0,
        trend: null,
        bands: [{ band: "0-256", mwh: 1.5, sharePct: 40 }],
        capturedAt: "2026-11-08T00:00:00Z",
      },
      basisMwh: 20.0,
      score: { performanceScore: 40, source: "bench-src", asOf: "2026-11-01" },
      value: 2,
      costPer1kUsd: null,
      descriptionMwh: 22.31,
    };
  }

  function render(thinking?: ThinkingInfo | null): string {
    return buildModelTooltipMd(valued(), {
      fetchedAt: null,
      isBest: false,
      pricingUrl: "https://example.com/pricing",
      tariff: 10,
      thinking,
    });
  }

  it("renders the Thinking line after Benchmark and before Prompt size, with the /v1/models source label", () => {
    const md = render(info());
    const bench = md.indexOf("**Benchmark**");
    const think = md.indexOf("**Thinking**");
    const prompt = md.indexOf("| Prompt size |");
    assert.ok(bench >= 0, "benchmark section present");
    assert.ok(prompt > 0, "prompt-size table present");
    assert.ok(think > bench, "thinking line after benchmark");
    assert.ok(prompt > think, "thinking line before prompt-size table");
    assert.ok(
      md.includes("**Thinking** · on by default \\(high\\) · levels: max, xhigh, high, low, none · /v1/models"),
      md,
    );
  });

  it("no line when the slug is not in the map (thinking info null or absent)", () => {
    for (const t of [null, undefined]) {
      const md = render(t);
      assert.ok(!md.includes("**Thinking**"), "no thinking line");
      assert.ok(!md.includes("/v1/models"), "no source label");
      assert.ok(!md.includes("not available"), "no wording");
    }
  });

  it("escapes hostile catalog strings in the rendered line", () => {
    const md = render(info({ defaultEffort: "<b>&x", efforts: ["<img src=src>", "(paren)"] }));
    assert.ok(md.includes("**Thinking** · on by default \\(&lt;b&gt;&amp;x\\)"), md);
    assert.ok(md.includes("levels: &lt;img src=src&gt;, \\(paren\\)"), md);
    assert.ok(!md.includes("<img"), "no raw html survives");
  });
});
