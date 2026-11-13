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
  it("on with default effort and levels", () => {
    assert.equal(
      formatThinkingLine(info()),
      "**Thinking** · on (high) · max, xhigh, high, low, none",
    );
  });

  it("always on", () => {
    assert.equal(
      formatThinkingLine(info({ mandatory: true, defaultEffort: "max", efforts: ["max", "high", "low"] })),
      "**Thinking** · always on (max) · max, high, low",
    );
  });

  it("off omits the default effort even when published", () => {
    assert.equal(
      formatThinkingLine(info({ defaultEnabled: false, defaultEffort: "high", efforts: ["max", "none"] })),
      "**Thinking** · off · max, none",
    );
  });

  it("not available", () => {
    assert.equal(formatThinkingLine(info({ supported: false })), "**Thinking** · not available");
  });

  it("omits the effort segment when unpublished and the levels segment when empty", () => {
    assert.equal(
      formatThinkingLine(info({ defaultEffort: null, efforts: [] })),
      "**Thinking** · on",
    );
  });

  it("shows efforts verbatim in published order", () => {
    assert.equal(
      formatThinkingLine(info({ defaultEffort: null, efforts: ["zeta", "alpha", "none"] })),
      "**Thinking** · on · zeta, alpha, none",
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

  it("renders the Thinking line after Benchmark and Top sizes, with the /v1/models source label", () => {
    const md = render(info());
    const bench = md.indexOf("**Benchmark**");
    const think = md.indexOf("**Thinking**");
    const prompt = md.indexOf("| Top sizes |");
    assert.ok(bench >= 0, "benchmark section present");
    assert.ok(prompt > 0, "top-sizes row present");
    assert.ok(think > bench, "thinking line after benchmark");
    assert.ok(prompt < bench, "top-sizes row precedes benchmark");
    assert.ok(
      md.includes("**Thinking** · on (high) · max, xhigh, high, low, none"),
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
    const md = render(info({ defaultEffort: "<b>&x", efforts: ["<img src=src>", "(paren)", "*em*", "a_b"] }));
    assert.ok(md.includes("**Thinking** · on (&lt;b&gt;&amp;x)"), md);
    assert.ok(md.includes("&lt;img src=src&gt;, \\(paren\\), \\*em\\*, a\\_b"), md);
    assert.ok(md.includes("**Thinking** · on"), "chrome stays bold, not escaped");
    assert.ok(!md.includes("<img"), "no raw html survives");
  });
});


describe("thinking - review fixes", () => {
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

  it("boolean capabilities.reasoning true alone yields a ThinkingInfo without published fields", () => {
    const map = buildThinkingMap(doc([{ id: "model-j", metadata: { capabilities: { reasoning: true } } }]));
    assert.deepEqual(map.get("model-j"), {
      supported: true,
      mandatory: false,
      defaultEnabled: false,
      defaultEffort: null,
      efforts: [],
    } satisfies ThinkingInfo);
  });

  it("boolean capabilities.reasoning false alone yields not-available info and wording", () => {
    const map = buildThinkingMap(doc([{ id: "model-k", metadata: { capabilities: { reasoning: false } } }]));
    assert.deepEqual(map.get("model-k"), {
      supported: false,
      mandatory: false,
      defaultEnabled: false,
      defaultEffort: null,
      efforts: [],
    } satisfies ThinkingInfo);
    assert.equal(formatThinkingLine(map.get("model-k")!), "**Thinking** · not available");
  });

  it("entries with neither a reasoning block nor a boolean capabilities flag stay absent", () => {
    const map = buildThinkingMap(doc([
      { id: "model-l", metadata: { capabilities: { reasoning: "auto" } } },
      { id: "model-m", metadata: { capabilities: "junk" } },
    ]));
    assert.equal(map.size, 0);
  });

  it("catalog values neutralise markdown emphasis while the chrome stays bold", () => {
    assert.equal(
      formatThinkingLine(info({ defaultEffort: "*x*", efforts: ["_y_", "**z**"] })),
      "**Thinking** · on (\\*x\\*) · \\_y\\_, \\*\\*z\\*\\*",
    );
  });
});

describe("thinking - same-weights note on lanes with thinking off", () => {
  function onEntry(
    id: string,
    hf: string,
    over?: { mandatory?: boolean; defaultEffort?: string; efforts?: string[] },
  ): Record<string, unknown> {
    return {
      id,
      metadata: {
        huggingface_id: hf,
        reasoning: {
          mandatory: over?.mandatory ?? false,
          default_enabled: true,
          default_effort: over?.defaultEffort ?? "high",
          supported_efforts: over?.efforts ?? ["max", "high", "low"],
        },
      },
    };
  }

  function offEntry(id: string, hf: string | null): Record<string, unknown> {
    const metadata: Record<string, unknown> = { capabilities: { reasoning: false } };
    if (hf != null) metadata.huggingface_id = hf;
    return { id, metadata };
  }

  function laneValued(slug: string): ValuedQuote {
    return {
      quote: {
        displayName: "Lane Fast",
        slug,
        isPreview: false,
        contextBand: null,
        cachePct: null,
        rightNowMwh: 5,
        typicalMwh: 4,
        trend: null,
        bands: [],
        capturedAt: "2026-11-08T00:00:00Z",
      },
      basisMwh: 4,
      score: null,
      value: null,
      costPer1kUsd: null,
      descriptionMwh: 5,
    };
  }

  it("attaches the agreeing supported sibling to a thinking-off lane sharing huggingface_id", () => {
    const map = buildThinkingMap(doc([
      offEntry("lane-fast", "weights-shared"),
      onEntry("base-a", "weights-shared"),
      offEntry("other-slow", null),
    ]));
    const fast = map.get("lane-fast");
    assert.equal(fast?.supported, false);
    assert.deepEqual(fast?.sameWeights, {
      mandatory: false,
      defaultEnabled: true,
      defaultEffort: "high",
      efforts: ["max", "high", "low"],
    });
    assert.equal(map.get("base-a")?.sameWeights, undefined);
    assert.equal(map.get("other-slow")?.sameWeights, undefined);
  });

  it("formats the note after the own not-available statement, reusing the state wording", () => {
    const map = buildThinkingMap(doc([offEntry("lane-fast", "w"), onEntry("base-a", "w")]));
    assert.equal(
      formatThinkingLine(map.get("lane-fast")!),
      "**Thinking** \u00b7 not available \u00b7 same weights: on (high)",
    );
  });

  it("always-on sibling wording", () => {
    const map = buildThinkingMap(doc([
      offEntry("lane-fast", "w"),
      onEntry("base-a", "w", { mandatory: true, defaultEffort: "max", efforts: ["max", "high"] }),
    ]));
    assert.equal(
      formatThinkingLine(map.get("lane-fast")!),
      "**Thinking** \u00b7 not available \u00b7 same weights: always on (max)",
    );
  });

  it("off-by-default sibling omits the default effort in the note", () => {
    const map = buildThinkingMap(doc([
      offEntry("lane-fast", "w"),
      {
        id: "base-a",
        metadata: { huggingface_id: "w", reasoning: { mandatory: false, default_enabled: false, default_effort: "high", supported_efforts: ["max", "none"] } },
      },
    ]));
    assert.equal(
      formatThinkingLine(map.get("lane-fast")!),
      "**Thinking** \u00b7 not available \u00b7 same weights: off",
    );
  });

  it("no note when supported siblings disagree on default effort", () => {
    const map = buildThinkingMap(doc([
      offEntry("lane-fast", "w"),
      onEntry("base-a", "w"),
      onEntry("base-b", "w", { defaultEffort: "low" }),
    ]));
    assert.equal(map.get("lane-fast")?.sameWeights, undefined);
  });

  it("no note when supported siblings disagree on efforts", () => {
    const map = buildThinkingMap(doc([
      offEntry("lane-fast", "w"),
      onEntry("base-a", "w"),
      onEntry("base-b", "w", { efforts: ["max", "high"] }),
    ]));
    assert.equal(map.get("lane-fast")?.sameWeights, undefined);
  });

  it("no note when no same-weights entry supports thinking", () => {
    const map = buildThinkingMap(doc([
      offEntry("lane-fast", "w"),
      offEntry("lane-slow", "w"),
    ]));
    assert.equal(map.size, 2);
    assert.equal(map.get("lane-fast")?.sameWeights, undefined);
  });

  it("siblings without thinking data are ignored and do not block a lone supported one", () => {
    const map = buildThinkingMap(doc([
      offEntry("lane-fast", "w"),
      { id: "silent-base", metadata: { huggingface_id: "w", display_name: "Silent" } },
      onEntry("base-a", "w"),
    ]));
    assert.equal(map.size, 2);
    assert.deepEqual(map.get("lane-fast")?.sameWeights, {
      mandatory: false,
      defaultEnabled: true,
      defaultEffort: "high",
      efforts: ["max", "high", "low"],
    });
  });

  it("no note when the model itself supports thinking", () => {
    const map = buildThinkingMap(doc([
      onEntry("model-on", "w"),
      onEntry("base-b", "w"),
    ]));
    assert.equal(map.get("model-on")?.supported, true);
    assert.equal(map.get("model-on")?.sameWeights, undefined);
    assert.equal(map.get("base-b")?.sameWeights, undefined);
  });

  it("missing, empty or non-string huggingface_id forms no group", () => {
    const map = buildThinkingMap(doc([
      offEntry("lane-fast", null),
      onEntry("base-a", ""),
      { id: "lane-mid", metadata: { huggingface_id: 42, capabilities: { reasoning: false } } },
      onEntry("base-b", "real-group"),
    ]));
    for (const id of ["lane-fast", "base-a", "lane-mid", "base-b"]) {
      assert.equal(map.get(id)?.sameWeights, undefined, id);
    }
  });

  it("escapes hostile sibling catalog strings in the note", () => {
    const map = buildThinkingMap(doc([
      offEntry("lane-fast", "w"),
      onEntry("base-a", "w", { defaultEffort: "<b>&x" }),
    ]));
    const line = formatThinkingLine(map.get("lane-fast")!);
    assert.ok(line.includes("same weights: on (&lt;b&gt;&amp;x)"), line);
    assert.ok(!line.includes("<b>"), line);
  });

  it("capabilities-only sibling is ignored as a source and does not block the note", () => {
    const map = buildThinkingMap(doc([
      offEntry("lane-fast", "w"),
      { id: "cap-only", metadata: { huggingface_id: "w", capabilities: { reasoning: true } } },
      onEntry("base-a", "w"),
    ]));
    assert.deepEqual(map.get("lane-fast")?.sameWeights, {
      mandatory: false,
      defaultEnabled: true,
      defaultEffort: "high",
      efforts: ["max", "high", "low"],
    });
    assert.equal(map.get("cap-only")?.sameWeights, undefined);
  });

  it("capabilities-only siblings alone never produce an off-by-default note", () => {
    const map = buildThinkingMap(doc([
      offEntry("lane-fast", "w"),
      { id: "cap-only", metadata: { huggingface_id: "w", capabilities: { reasoning: true } } },
    ]));
    assert.equal(map.get("lane-fast")?.sameWeights, undefined);
  });

  it("a duplicated catalog id under two huggingface_id values reads only its own entry", () => {
    const map = buildThinkingMap(doc([
      onEntry("dup", "group-a"),
      offEntry("dup", "group-b"),
      offEntry("lane-d", "group-a"),
    ]));
    assert.deepEqual(map.get("lane-d")?.sameWeights, {
      mandatory: false,
      defaultEnabled: true,
      defaultEffort: "high",
      efforts: ["max", "high", "low"],
    });
    assert.equal(map.get("dup")?.sameWeights, undefined);
  });

  it("model hover renders the note through the shared formatter", () => {
    const map = buildThinkingMap(doc([offEntry("lane-fast", "w"), onEntry("base-a", "w")]));
    const md = buildModelTooltipMd(laneValued("lane-fast"), {
      fetchedAt: null,
      isBest: false,
      pricingUrl: "https://example.com/pricing",
      tariff: 10,
      thinking: map.get("lane-fast") ?? null,
    });
    assert.ok(md.includes("**Thinking** \u00b7 not available \u00b7 same weights: on (high)"), md);
  });
});
