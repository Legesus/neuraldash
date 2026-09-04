import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ModelQuote, Sparkline48h } from "../src/core/types";
import { TREND_COLORS, trendArrow, sparklineCardSvg, sparklineIconSvg, sparklineDescriptionSuffix } from "../src/core/sparkline";
import { computeSeverityScale } from "../src/core/color";

const SCALE = computeSeverityScale([10, 100, 1000]);

function spark(over?: Partial<Sparkline48h>): Sparkline48h {
  return {
    points: [
      { x: 0, y: 3 },
      { x: 100, y: 27 },
    ],
    refY: 15,
    direction: "below",
    maxMwh: 51.26,
    minMwh: 8.88,
    ...over,
  };
}

describe("sparkline — geometry (exact strings)", () => {
  it("scales 2-point input (0,3)/(100,27) to points=\"0,3.2 16,12.8\"", () => {
    const svg = sparklineIconSvg(spark({ refY: null }), 50, SCALE)!;
    assert.ok(svg.includes(`points="0,3.2 16,12.8"`), svg);
  });

  it("emits xmlns + viewBox 0 0 16 16", () => {
    const svg = sparklineIconSvg(spark(), 50, SCALE)!;
    assert.ok(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">`), svg);
    assert.ok(svg.endsWith(`</svg>`), svg);
  });

  it("draws the refline only when refY is finite: y = 2 + 0.4*refY", () => {
    const withRef = sparklineIconSvg(spark({ refY: 15 }), 50, SCALE)!;
    assert.ok(withRef.includes(`<line x1="0" y1="8" x2="16" y2="8"`), withRef);
    assert.ok(!sparklineIconSvg(spark({ refY: null }), 50, SCALE)!.includes("<line"));
    assert.ok(!sparklineIconSvg(spark({ refY: NaN }), 50, SCALE)!.includes("<line"));
  });

  it("draws exactly ONE circle (the severity dot, on top / last)", () => {
    const svg = sparklineIconSvg(spark(), 50, SCALE)!;
    const circles = svg.match(/<circle/g) ?? [];
    assert.equal(circles.length, 1);
    assert.ok(svg.indexOf("<circle") > svg.indexOf("<polyline"), "dot must be drawn after the polyline");
  });
});

describe("sparkline — colors", () => {
  it("maps directions to TREND_COLORS", () => {
    assert.deepEqual(TREND_COLORS, { below: "#34d399", above: "#fb7185", neutral: "#9ca3af" });
    assert.ok(sparklineIconSvg(spark({ direction: "below" }), 50, SCALE)!.includes(`stroke="#34d399"`));
    assert.ok(sparklineIconSvg(spark({ direction: "above" }), 50, SCALE)!.includes(`stroke="#fb7185"`));
    assert.ok(sparklineIconSvg(spark({ direction: "neutral" }), 50, SCALE)!.includes(`stroke="#9ca3af"`));
  });

  it("colors the dot via severityColor/severityOf for valid basis", () => {
    const svg = sparklineIconSvg(spark(), 10, SCALE)!; // min basis -> severity 0 -> green
    assert.ok(svg.includes(`fill="hsl(130, 85%, 55%)"`), svg);
  });

  it("uses a grey #808080 dot for null/0/NaN basis", () => {
    for (const basis of [null, 0, NaN]) {
      const svg = sparklineIconSvg(spark(), basis, SCALE)!;
      assert.ok(svg.includes(`fill="#808080"`), `basis=${String(basis)}: ${svg}`);
    }
  });

  it("trendArrow maps above→▲, below→▼, neutral→•", () => {
    assert.equal(trendArrow("above"), "▲");
    assert.equal(trendArrow("below"), "▼");
    assert.equal(trendArrow("neutral"), "•");
  });
});

describe("sparkline — null tolerance", () => {
  it("returns null for null/undefined spark or fewer than 2 points", () => {
    assert.equal(sparklineIconSvg(null, 50, SCALE), null);
    assert.equal(sparklineIconSvg(undefined, 50, SCALE), null);
    assert.equal(sparklineIconSvg(spark({ points: [] }), 50, SCALE), null);
    assert.equal(sparklineIconSvg(spark({ points: [{ x: 1, y: 2 }] }), 50, SCALE), null);
  });
});

describe("sparkline — description suffix", () => {
  it("renders arrow + pct only (lo/hi lives in the tooltip, not the row)", () => {
    assert.equal(
      sparklineDescriptionSuffix(spark({ minMwh: 8.88, maxMwh: 51.26 }), { pct: 47, direction: "above" }),
      " · ▲47%",
    );
    assert.equal(sparklineDescriptionSuffix(spark({ minMwh: null, maxMwh: null }), { pct: 47, direction: "above" }), " · ▲47%");
  });

  it('returns "" when trend is null (spark alone adds nothing to the row)', () => {
    assert.equal(sparklineDescriptionSuffix(spark({ minMwh: 8.88, maxMwh: 51.26 }), null), "");
    assert.equal(sparklineDescriptionSuffix(spark({ minMwh: null, maxMwh: null }), null), "");
  });

  it('returns "" for null/undefined spark ALWAYS (the old-cache gate)', () => {
    assert.equal(sparklineDescriptionSuffix(null, { pct: 47, direction: "above" }), "");
    assert.equal(sparklineDescriptionSuffix(undefined, { pct: 47, direction: "above" }), "");
  });

  it('maps inline trend direction to "—"', () => {
    assert.equal(sparklineDescriptionSuffix(spark(), { pct: 1, direction: "inline" }), " · —1%");
  });
});

describe("sparkline — card chart (tooltip)", () => {
  // Hand-computed from the card spec: source 100x30 coords, refline y = round2(refY),
  // polyline stroke-width 1.5, emphasis circle on the LAST point r=1.2 in trend color.
  it("pins the complete card SVG string", () => {
    // Input: points (0,3)/(100,27), refY 15, direction below -> #34d399.
    // Last point (100,27) -> circle cx=100 cy=27.
    const svg = sparklineCardSvg(spark({ refY: 15, direction: "below" }));
    assert.equal(
      svg,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 30" preserveAspectRatio="none">` +
        `<line x1="0" y1="15" x2="100" y2="15" stroke="#9ca3af" stroke-width="1" stroke-dasharray="2,2" opacity="0.6"/>` +
        `<polyline fill="none" stroke="#34d399" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" points="0,3 100,27"/>` +
        `<circle cx="100" cy="27" r="1.2" fill="#34d399"/>` +
        `</svg>`,
    );
  });

  it("returns null for null/undefined spark or fewer than 2 finite points", () => {
    assert.equal(sparklineCardSvg(null), null);
    assert.equal(sparklineCardSvg(undefined), null);
    assert.equal(sparklineCardSvg(spark({ points: [] })), null);
    assert.equal(sparklineCardSvg(spark({ points: [{ x: 1, y: 2 }] })), null);
  });

  it("puts the emphasis circle on the LAST point in trend color", () => {
    const svg = sparklineCardSvg(spark({ direction: "above", refY: null }))!;
    const circles = svg.match(/<circle/g) ?? [];
    assert.equal(circles.length, 1);
    assert.ok(svg.includes(`<circle cx="100" cy="27" r="1.2" fill="#fb7185"/>`), svg);
  });

  it("maps direction to polyline color and omits the refline when refY is not finite", () => {
    const rose = sparklineCardSvg(spark({ direction: "above", refY: null }))!;
    assert.ok(rose.includes(`stroke="#fb7185"`), rose);
    assert.ok(!rose.includes("<line"), rose);
    const grey = sparklineCardSvg(spark({ direction: "neutral", refY: NaN }))!;
    assert.ok(grey.includes(`stroke="#9ca3af"`), grey);
    assert.ok(!grey.includes("<line"), grey);
  });
});

describe("sparkline — serialization", () => {
  it("JSON round-trips a quote with sparkline losslessly", () => {
    const quote: ModelQuote = {
      displayName: "M",
      slug: "m",
      isPreview: false,
      contextBand: null,
      cachePct: null,
      rightNowMwh: 10,
      typicalMwh: 9,
      trend: { pct: 47, direction: "above" },
      sparkline: spark(),
      bands: [],
      capturedAt: "2026-09-04T00:00:00.000Z",
    };
    const clone = JSON.parse(JSON.stringify(quote)) as ModelQuote;
    assert.deepEqual(clone, quote);
  });
});

describe("sparkline — full deterministic SVG strings (AD-4 contract)", () => {
  // Expected strings below are computed BY HAND from the AD-4 rules
  // (px = round2(x*0.16), py = round2(2 + y*0.4), refline y = round2(2 + 0.4*refY)),
  // not copied from implementation output.

  it("pins the complete SVG with finite refY and severity-colored dot", () => {
    // Input: points (0,3)/(100,27), refY 15, direction below, basis 10 on SCALE([10,100,1000]).
    // px: 0*0.16=0, 100*0.16=16. py: 2+3*0.4=3.2, 2+27*0.4=12.8. refline y: 2+15*0.4=8.
    // Dot: basis 10 = scale min -> severityOf = 0 -> severityColor(0) = "hsl(130, 85%, 55%)".
    const svg = sparklineIconSvg(spark({ refY: 15, direction: "below" }), 10, SCALE);
    assert.equal(
      svg,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">` +
        `<line x1="0" y1="8" x2="16" y2="8" stroke="#9ca3af" stroke-width="0.5" stroke-dasharray="1,1" opacity="0.6"/>` +
        `<polyline fill="none" stroke="#34d399" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" points="0,3.2 16,12.8"/>` +
        `<circle cx="2.5" cy="13.5" r="1.5" fill="hsl(130, 85%, 55%)"/>` +
        `</svg>`,
    );
  });

  it("pins the complete SVG with refY null and null basis (grey dot)", () => {
    // Input: points (0,3)/(100,27), refY null (no refline), direction above, basis null -> dot #808080.
    const svg = sparklineIconSvg(spark({ refY: null, direction: "above" }), null, SCALE);
    assert.equal(
      svg,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">` +
        `<polyline fill="none" stroke="#fb7185" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" points="0,3.2 16,12.8"/>` +
        `<circle cx="2.5" cy="13.5" r="1.5" fill="#808080"/>` +
        `</svg>`,
    );
  });
});
