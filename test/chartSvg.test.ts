import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Sparkline48h } from "../src/core/types";
import { TREND_COLORS } from "../src/core/sparkline";
import { TREND_WINDOW_HOURS, buildTrendChartSvg, formatHoursAgo, summarizeTrend, valueScale } from "../src/core/chartSvg";

function spark(over?: Partial<Sparkline48h>): Sparkline48h {
  return {
    points: [
      { x: 0, y: 0 },
      { x: 50, y: 15 },
      { x: 100, y: 30 },
    ],
    refY: 15,
    direction: "below",
    maxMwh: 20,
    minMwh: 10,
    ...over,
  };
}

function flat(over?: Partial<Sparkline48h>): Sparkline48h {
  return spark({
    points: [
      { x: 0, y: 15 },
      { x: 50, y: 15 },
      { x: 100, y: 15 },
    ],
    ...over,
  });
}

describe("chartSvg — valueScale", () => {
  it("returns null without minMwh/maxMwh, below 2 points, or when every x is equal", () => {
    assert.equal(valueScale(spark({ minMwh: null })), null);
    assert.equal(valueScale(spark({ maxMwh: null })), null);
    assert.equal(valueScale(spark({ minMwh: null, maxMwh: null })), null);
    assert.equal(valueScale(spark({ points: [] })), null);
    assert.equal(valueScale(spark({ points: [{ x: 10, y: 5 }] })), null);
    assert.equal(
      valueScale(
        spark({
          points: [
            { x: 10, y: 5 },
            { x: 10, y: 25 },
          ],
        }),
      ),
      null,
    );
  });

  it("maps the top y to maxMwh, the bottom y to minMwh, and the middle linearly", () => {
    const scale = valueScale(spark())!;
    assert.equal(scale(0), 20);
    assert.equal(scale(30), 10);
    assert.equal(scale(15), 15);
    assert.equal(scale(7.5), 17.5);
    assert.equal(scale(22.5), 12.5);

    const asymmetric = valueScale(spark({ minMwh: 4, maxMwh: 12 }))!;
    assert.equal(asymmetric(0), 12);
    assert.equal(asymmetric(30), 4);
    assert.equal(asymmetric(15), 8);
  });

  it("maps a flat line (all y equal) to the midpoint of min and max", () => {
    const scale = valueScale(flat())!;
    assert.equal(scale(15), 15);
    assert.equal(scale(0), 15);
    assert.equal(scale(30), 15);

    const asymmetric = valueScale(flat({ minMwh: 4, maxMwh: 12 }))!;
    assert.equal(asymmetric(15), 8);
  });
});

describe("chartSvg — summarizeTrend", () => {
  it("returns null for null, undefined, or unusable sparks", () => {
    assert.equal(summarizeTrend(null), null);
    assert.equal(summarizeTrend(undefined), null);
    assert.equal(summarizeTrend(spark({ points: [] })), null);
    assert.equal(summarizeTrend(spark({ points: [{ x: 0, y: 0 }] })), null);
    assert.equal(
      summarizeTrend(
        spark({
          points: [
            { x: 7, y: 0 },
            { x: 7, y: 30 },
          ],
        }),
      ),
      null,
    );
    assert.equal(summarizeTrend(spark({ minMwh: null })), null);
    assert.equal(summarizeTrend(spark({ maxMwh: null })), null);
  });

  it("pins the first sample at 48h ago and the last at 0h ago", () => {
    const summary = summarizeTrend(spark())!;
    assert.equal(TREND_WINDOW_HOURS, 48);
    assert.equal(summary.samples.length, 3);
    assert.equal(summary.samples[0]!.hoursAgo, 48);
    assert.equal(summary.samples[1]!.hoursAgo, 24);
    assert.equal(summary.samples[summary.samples.length - 1]!.hoursAgo, 0);
  });

  it("derives every sample mwh through the same y scale", () => {
    const summary = summarizeTrend(spark())!;
    assert.deepEqual(
      summary.samples.map((s) => s.mwh),
      [20, 15, 10],
    );
  });

  it("reports low and high samples with their own hoursAgo", () => {
    const summary = summarizeTrend(spark())!;
    assert.deepEqual(summary.high, { hoursAgo: 48, mwh: 20 });
    assert.deepEqual(summary.low, { hoursAgo: 0, mwh: 10 });

    const valley = summarizeTrend(
      spark({
        points: [
          { x: 0, y: 30 },
          { x: 50, y: 0 },
          { x: 100, y: 15 },
        ],
      }),
    )!;
    assert.deepEqual(valley.high, { hoursAgo: 24, mwh: 20 });
    assert.deepEqual(valley.low, { hoursAgo: 48, mwh: 10 });
  });

  it("takes the middle sample as the median for an odd count", () => {
    assert.equal(summarizeTrend(spark())!.median, 15);
  });

  it("averages the two middle samples as the median for an even count", () => {
    const even = summarizeTrend(
      spark({
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 15 },
          { x: 20, y: 24 },
          { x: 30, y: 30 },
        ],
      }),
    )!;
    assert.deepEqual(
      even.samples.map((s) => s.mwh),
      [20, 15, 12, 10],
    );
    assert.equal(even.median, 13.5);
  });

  it("derives avgMwh from refY through the same scale, null when refY is null", () => {
    assert.equal(summarizeTrend(spark({ refY: 15 }))!.avgMwh, 15);
    assert.equal(summarizeTrend(spark({ refY: 0 }))!.avgMwh, 20);
    assert.equal(summarizeTrend(spark({ refY: 30 }))!.avgMwh, 10);
    assert.equal(summarizeTrend(spark({ refY: null }))!.avgMwh, null);
  });
});

describe("chartSvg — formatHoursAgo", () => {
  it("renders zero and negative offsets as 'now'", () => {
    assert.equal(formatHoursAgo(0), "now");
    assert.equal(formatHoursAgo(-1), "now");
    assert.equal(formatHoursAgo(-12.5), "now");
  });

  it("rounds positive offsets and appends the hour suffix", () => {
    assert.equal(formatHoursAgo(12.4), "12h ago");
    assert.equal(formatHoursAgo(48), "48h ago");
  });
});

describe("chartSvg — buildTrendChartSvg", () => {
  it("returns null for null, undefined, or unusable sparks", () => {
    assert.equal(buildTrendChartSvg(null), null);
    assert.equal(buildTrendChartSvg(undefined), null);
    assert.equal(buildTrendChartSvg(spark({ points: [] })), null);
    assert.equal(buildTrendChartSvg(spark({ points: [{ x: 0, y: 0 }] })), null);
    assert.equal(
      buildTrendChartSvg(
        spark({
          points: [
            { x: 4, y: 0 },
            { x: 4, y: 30 },
          ],
        }),
      ),
      null,
    );
    assert.equal(buildTrendChartSvg(spark({ minMwh: null })), null);
    assert.equal(buildTrendChartSvg(spark({ maxMwh: null })), null);
  });

  it("starts with the trend-chart svg tag and defaults to a 720x240 viewBox", () => {
    const svg = buildTrendChartSvg(spark())!;
    assert.ok(svg.startsWith('<svg class="trend-chart"'), svg.slice(0, 80));
    assert.ok(svg.includes('viewBox="0 0 720 240"'), svg);
    assert.ok(svg.endsWith("</svg>"), svg);
  });

  it("honours a custom width and height in the viewBox", () => {
    const svg = buildTrendChartSvg(spark(), { width: 480, height: 200 })!;
    assert.ok(svg.includes('viewBox="0 0 480 200"'), svg);
    assert.ok(!svg.includes('viewBox="0 0 720 240"'), svg);
  });

  it("draws exactly one polyline with one coordinate pair per point", () => {
    const svg = buildTrendChartSvg(spark())!;
    assert.equal((svg.match(/<polyline/g) ?? []).length, 1);
    const points = /<polyline[^>]*points="([^"]*)"/.exec(svg)![1]!;
    assert.equal(points.split(" ").length, 3);

    const five = buildTrendChartSvg(
      spark({
        points: [
          { x: 0, y: 0 },
          { x: 25, y: 6 },
          { x: 50, y: 15 },
          { x: 75, y: 24 },
          { x: 100, y: 30 },
        ],
      }),
    )!;
    assert.equal(/<polyline[^>]*points="([^"]*)"/.exec(five)![1]!.split(" ").length, 5);
  });

  it("draws one titled pt circle per point", () => {
    const svg = buildTrendChartSvg(spark())!;
    const titled = svg.match(/<circle class="pt"[^>]*><title>[^<]*<\/title><\/circle>/g) ?? [];
    assert.equal(titled.length, 3);
    assert.equal((svg.match(/class="pt"/g) ?? []).length, 3);
  });

  it("labels the x axis with -48h -36h -24h -12h now", () => {
    const svg = buildTrendChartSvg(spark())!;
    for (const label of ["-48h", "-36h", "-24h", "-12h"]) {
      assert.ok(svg.includes(`>${label}</text>`), label);
    }
    assert.ok(svg.includes(">now</text>"), svg);
  });

  it("draws the 7d typical reference line and label only when typicalMwh is given", () => {
    const without = buildTrendChartSvg(spark())!;
    assert.ok(!without.includes("ref-typical"), without);
    assert.ok(!without.includes(">7d "), without);

    const withTypical = buildTrendChartSvg(spark(), { typicalMwh: 12 })!;
    assert.ok(withTypical.includes('class="ref-typical"'), withTypical);
    assert.ok(withTypical.includes('<text class="ref-typical-label"'), withTypical);
    assert.ok(withTypical.includes(">7d "), withTypical);
  });

  it("draws the 48h average reference line only when refY is non-null", () => {
    const withAvg = buildTrendChartSvg(spark())!;
    assert.ok(withAvg.includes('class="ref-avg"'), withAvg);
    assert.ok(withAvg.includes('<text class="ref-avg-label"'), withAvg);
    assert.ok(withAvg.includes(">48h avg "), withAvg);

    const withoutAvg = buildTrendChartSvg(spark({ refY: null }))!;
    assert.ok(!withoutAvg.includes("ref-avg"), withoutAvg);
    assert.ok(!withoutAvg.includes("48h avg"), withoutAvg);
  });

  it("labels hi and lo markers, and only hi when every value is equal", () => {
    const svg = buildTrendChartSvg(spark())!;
    assert.ok(svg.includes(">hi "), svg);
    assert.ok(svg.includes(">lo "), svg);
    assert.equal((svg.match(/class="marker"/g) ?? []).length, 2);

    const flatSvg = buildTrendChartSvg(flat())!;
    assert.ok(flatSvg.includes(">hi "), flatSvg);
    assert.ok(!flatSvg.includes(">lo "), flatSvg);
    assert.equal((flatSvg.match(/class="marker"/g) ?? []).length, 1);
  });

  it("draws the now circle on the last sample", () => {
    const svg = buildTrendChartSvg(spark())!;
    assert.equal((svg.match(/class="now"/g) ?? []).length, 1);
    const now = /<circle class="now" cx="([\d.-]+)" cy="([\d.-]+)"/.exec(svg)!;
    const pairs = /<polyline[^>]*points="([^"]*)"/.exec(svg)![1]!.split(" ");
    assert.equal(`${now[1]},${now[2]}`, pairs[pairs.length - 1]);
  });

  it("colors the line and points from TREND_COLORS for above, below and neutral", () => {
    for (const direction of ["above", "below", "neutral"] as const) {
      const svg = buildTrendChartSvg(spark({ direction }))!;
      assert.ok(svg.includes(`stroke="${TREND_COLORS[direction]}"`), `${direction}: ${svg}`);
      assert.ok(svg.includes(`fill="${TREND_COLORS[direction]}"`), `${direction}: ${svg}`);
    }
  });

  it("never emits scripts, NaN or Infinity, including on a flat line", () => {
    const cases = [
      buildTrendChartSvg(spark())!,
      buildTrendChartSvg(spark({ refY: null }))!,
      buildTrendChartSvg(spark(), { typicalMwh: 12 })!,
      buildTrendChartSvg(spark(), { typicalMwh: 12, width: 320, height: 120 })!,
      buildTrendChartSvg(flat())!,
      buildTrendChartSvg(flat(), { typicalMwh: 15 })!,
      buildTrendChartSvg(flat({ minMwh: 4, maxMwh: 12 }))!,
    ];
    for (const svg of cases) {
      assert.ok(!svg.includes("<script"), "no script tag");
      assert.ok(!svg.includes("NaN"), "no NaN");
      assert.ok(!svg.includes("Infinity"), "no Infinity");
    }
  });
});
