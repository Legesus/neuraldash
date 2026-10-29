import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BandEnergy } from "../src/core/types";
import {
  boardTrendLabel,
  formatEnergy,
  formatEnergyRange,
  isContextBandText,
  pickUnit,
  rankBands,
  sameEnergy,
  textSparkline,
  tierComparisonTable,
  savingPct,
  formatPrice,
} from "../src/core/cardFormat";

describe("cardFormat — pickUnit", () => {
  it("returns mWh when no finite values are present", () => {
    assert.equal(pickUnit(), "mWh");
    assert.equal(pickUnit(null, undefined), "mWh");
  });

  it("returns mWh when the largest value is below 1000", () => {
    assert.equal(pickUnit(999), "mWh");
  });

  it("returns Wh when any single value reaches 1000", () => {
    assert.equal(pickUnit(1000), "Wh");
    assert.equal(pickUnit(1, 1000), "Wh");
  });
});

describe("cardFormat — formatEnergy", () => {
  it("renders an em dash for null, undefined, and non-finite values", () => {
    assert.equal(formatEnergy(null), "—");
    assert.equal(formatEnergy(undefined), "—");
    assert.equal(formatEnergy(Number.NaN), "—");
  });

  it("respects an explicitly passed unit", () => {
    assert.equal(formatEnergy(1110, "mWh"), "1110.00 mWh");
    assert.equal(formatEnergy(22.31, "mWh"), "22.31 mWh");
  });

  it("derives the unit from the value by default", () => {
    assert.equal(formatEnergy(1110), "1.11 Wh");
    assert.equal(formatEnergy(5.5), "5.50 mWh");
  });
});

describe("cardFormat — formatEnergyRange", () => {
  it("returns null when either bound is missing", () => {
    assert.equal(formatEnergyRange(null, 10), null);
    assert.equal(formatEnergyRange(10, null), null);
    assert.equal(formatEnergyRange(null, null), null);
  });

  it("shares one unit across the range with it appearing once on the high end", () => {
    assert.equal(formatEnergyRange(218.41, 2730), "0.22–2.73 Wh");
  });

  it("stays in mWh when both bounds are under 1000", () => {
    const out = formatEnergyRange(10, 20)!;
    assert.equal(out, "10.00–20.00 mWh");
    assert.equal((out.match(/mWh/g) ?? []).length, 1);
  });
});

describe("cardFormat — boardTrendLabel", () => {
  it("returns null for null and undefined trend", () => {
    assert.equal(boardTrendLabel(null), null);
    assert.equal(boardTrendLabel(undefined), null);
  });

  it("labels a below-7d trend with the down arrow", () => {
    assert.equal(boardTrendLabel({ pct: 23, direction: "below" }), "▼ 23% vs 7d");
  });

  it("labels an above-7d trend with the up arrow", () => {
    assert.equal(boardTrendLabel({ pct: 23, direction: "above" }), "▲ 23% vs 7d");
  });

  it("labels an inline trend with the approx marker", () => {
    assert.equal(boardTrendLabel({ pct: 1, direction: "inline" }), "≈ in line with 7d");
  });
});

describe("cardFormat — textSparkline", () => {
  it("returns null for null and undefined input", () => {
    assert.equal(textSparkline(null), null);
    assert.equal(textSparkline(undefined), null);
  });

  it("returns null for a single point", () => {
    assert.equal(textSparkline([{ x: 1, y: 2 }]), null);
  });

  it("returns null when every point shares one x (zero x-span)", () => {
    assert.equal(textSparkline([{ x: 5, y: 1 }, { x: 5, y: 9 }]), null);
  });

  it("honors the default width of 16 and an explicit width", () => {
    const slope = [{ x: 0, y: 10 }, { x: 9, y: 0 }];
    assert.equal(textSparkline(slope)!.length, 16);
    assert.equal(textSparkline(slope, 8)!.length, 8);
  });

  it("uses only glyphs from the eight-step ladder", () => {
    const out = textSparkline([{ x: 0, y: 10 }, { x: 9, y: 0 }])!;
    for (const ch of out) {
      assert.ok("▁▂▃▄▅▆▇█".includes(ch), `unexpected glyph ${ch}`);
    }
  });

  it("inverts y for SVG semantics: smaller y renders the highest glyph", () => {
    const out = textSparkline([{ x: 0, y: 10 }, { x: 9, y: 0 }])!;
    assert.equal(out[0], "▁");
    assert.equal(out[15], "█");
    assert.ok(out.indexOf("█") > out.indexOf("▁"));
  });

  it("renders a flat line as sixteen identical mid-ladder glyphs", () => {
    assert.equal(textSparkline([{ x: 0, y: 5 }, { x: 10, y: 5 }]), "▄".repeat(16));
  });
});

describe("cardFormat — rankBands", () => {
  const bands: Array<{ band: string; mwh: number | null; sharePct: number | null }> = [
    { band: "0-256", mwh: 129.44, sharePct: 3.8 },
    { band: "256-1k", mwh: 109.12, sharePct: 16.9 },
    { band: "1k-4k", mwh: 677.44, sharePct: 7.5 },
    { band: "4k-16k", mwh: 795.1, sharePct: 14.1 },
    { band: "16k-64k", mwh: 886.84, sharePct: 42.1 },
    { band: "64k-256k", mwh: 1110, sharePct: 15.5 },
    { band: "256k-1M", mwh: null, sharePct: null },
    { band: "512k-2M", mwh: 100, sharePct: 0 },
  ];
  const ranked = rankBands(bands as BandEnergy[]);

  it("sorts shown bands by sharePct descending", () => {
    assert.deepEqual(ranked.shown.map((b) => b.band), ["16k-64k", "256-1k", "64k-256k", "4k-16k"]);
  });

  it("drops null-share and zero-share bands entirely", () => {
    assert.ok(!ranked.shown.some((b) => b.band === "256k-1M"));
    assert.ok(!ranked.shown.some((b) => b.band === "512k-2M"));
  });

  it("respects the limit and counts only usable-but-unshown bands as hidden", () => {
    assert.equal(ranked.shown.length, 4);
    assert.equal(ranked.hiddenCount, 2);
  });

  it("renders the top band's bar at exactly barWidth", () => {
    const top = rankBands(bands as BandEnergy[], 4, 12).shown[0];
    assert.equal(top.bar, "█".repeat(12));
  });

  it("keeps every shown bar at least one glyph and always the block glyph", () => {
    for (const b of ranked.shown) {
      assert.ok(b.bar.length >= 1, `bar for ${b.band} must be at least one char`);
      assert.match(b.bar, /^█+$/, `bar for ${b.band} must be all block glyphs, got ${b.bar}`);
    }
  });
});

describe("cardFormat — sameEnergy", () => {
  it("treats two nulls as equal and one-sided nulls as unequal", () => {
    assert.equal(sameEnergy(null, null), true);
    assert.equal(sameEnergy(null, 5), false);
    assert.equal(sameEnergy(5, null), false);
  });

  it("compares values within the 0.005 tolerance", () => {
    assert.equal(sameEnergy(10, 10), true);
    assert.equal(sameEnergy(10, 10.004), true);
    assert.equal(sameEnergy(10, 10.01), false);
  });
});

describe("cardFormat — isContextBandText", () => {
  it("accepts band tokens with hyphen, en dash, and k/M suffixes", () => {
    assert.equal(isContextBandText("16k-64k"), true);
    assert.equal(isContextBandText("256–1k"), true);
    assert.equal(isContextBandText("256k-1M"), true);
  });

  it("rejects non-band text, empty string, null, and undefined", () => {
    assert.equal(isContextBandText("clef-flash"), false);
    assert.equal(isContextBandText("abc-def"), false);
    assert.equal(isContextBandText(null), false);
    assert.equal(isContextBandText(undefined), false);
    assert.equal(isContextBandText(""), false);
  });
});

describe("cardFormat — tierComparisonTable", () => {
  it("renders Normal → Flex rows with savings computed from the two prices", () => {
    const lines = tierComparisonTable([
      { label: "Input", normal: 2, flex: 1.3, digits: 2 },
      { label: "Output", normal: 8, flex: null, digits: 2 },
      { label: "Cache read", normal: null, flex: null, digits: 3 },
    ]);
    assert.deepEqual(lines, [
      "| /1M tok | Normal | → Flex | Saving |",
      "|---|---:|---:|---:|",
      "| Input | $2.00 | $1.30 | **−35%** |",
      "| Output | $8.00 | — | — |",
    ]);
  });

  it("returns no lines when neither tier has a price, and flags a flex price above normal", () => {
    assert.deepEqual(tierComparisonTable([{ label: "Input", normal: null, flex: null, digits: 2 }]), []);
    assert.equal(savingPct(1, 1.2)! < 0, true);
    assert.ok(tierComparisonTable([{ label: "Input", normal: 1, flex: 1.2, digits: 2 }])[2].includes("20% more"));
    assert.equal(savingPct(0, 1), null);
  });
});

describe("cardFormat — formatPrice", () => {
  it("keeps sub-cent precision up to 4 decimals without padding round prices", () => {
    assert.equal(formatPrice(0.0975), "$0.0975");
    assert.equal(formatPrice(0.091), "$0.091");
    assert.equal(formatPrice(0.14), "$0.14");
    assert.equal(formatPrice(2), "$2.00");
    assert.equal(formatPrice(null), "—");
  });
});
