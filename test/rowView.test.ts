import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Sparkline48h } from "../src/core/types";
import { basisToSvgUri, computeSeverityScale } from "../src/core/color";
import { sparklineCardSvg, sparklineIconSvg } from "../src/core/sparkline";
import { modelRowDescription, sparklineTooltipRow, rowIconSvg, tooltipFooter, resolveSlugArg } from "../src/core/rowView";

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

describe("rowView — OLD-CACHE CONTRACT (sparkline absent)", () => {
  it("modelRowDescription returns exactly the legacy string for undefined AND null spark", () => {
    // Legacy shape: `${formatMwh(mwh)} · $${cost.toFixed(2)}/1k`. cost for 22.31 mWh @ tariff 10 = 0.2231 -> "0.22".
    for (const sparkline of [undefined, null]) {
      assert.equal(modelRowDescription(22.31, 0.2231, sparkline, { pct: 47, direction: "above" }), "22.31 mWh · $0.22/1k");
    }
  });

  it("modelRowDescription returns '-' when mwh is null and no spark suffix exists", () => {
    for (const sparkline of [undefined, null]) {
      assert.equal(modelRowDescription(null, null, sparkline, { pct: 47, direction: "above" }), "-");
      assert.equal(modelRowDescription(null, null, sparkline, null), "-");
    }
  });

  it("sparklineTooltipRow returns null for undefined AND null spark", () => {
    assert.equal(sparklineTooltipRow(undefined), null);
    assert.equal(sparklineTooltipRow(null), null);
  });

  it("rowIconSvg returns EXACTLY basisToSvgUri output when spark is absent", () => {
    for (const sparkline of [undefined, null]) {
      assert.equal(rowIconSvg(sparkline, 100, SCALE), basisToSvgUri(100, SCALE));
      assert.equal(rowIconSvg(sparkline, null, SCALE), basisToSvgUri(null, SCALE));
    }
  });
});

describe("rowView — sparkline present", () => {
  it("modelRowDescription appends arrow + pct only (no lo/hi)", () => {
    assert.equal(
      modelRowDescription(22.31, 0.2231, spark(), { pct: 47, direction: "above" }),
      "22.31 mWh · $0.22/1k · ▲47%",
    );
  });

  it("modelRowDescription uses the trimmed suffix when mwh is null", () => {
    assert.equal(modelRowDescription(null, null, spark(), { pct: 47, direction: "above" }), "· ▲47%");
  });

  it("modelRowDescription adds nothing when trend is null", () => {
    assert.equal(modelRowDescription(22.31, 0.2231, spark(), null), "22.31 mWh · $0.22/1k");
    assert.equal(modelRowDescription(null, null, spark(), null), "-");
  });

  it("sparklineTooltipRow prepends the chart image, then colored text with lo–hi range", () => {
    const s = spark({ direction: "below", minMwh: 8.88, maxMwh: 51.26 });
    const card = sparklineCardSvg(s)!;
    const uri = `data:image/svg+xml;base64,${Buffer.from(card, "utf8").toString("base64")}`;
    const expected =
      `| 48h trend | <img src="${uri}" width="200" height="52"><br>` +
      `<span style="color:#34d399">▼ below avg</span> · lo 8.88 mWh – hi 51.26 mWh |`;
    assert.equal(sparklineTooltipRow(s), expected);
    // Base64 alphabet is table-safe by construction: no raw `|`, `"`, `#`, or newlines.
    const payload = uri.slice("data:image/svg+xml;base64,".length);
    assert.ok(!payload.includes("|"), "chart URI must contain no raw pipe");
    assert.ok(!payload.includes('"'), "chart URI must contain no raw double quote");
    assert.ok(!payload.includes("#"), "chart URI must contain no raw hash");
    assert.ok(!payload.includes("\n") && !payload.includes("\r"), "chart URI must contain no raw newlines");
    // Regression guard: the non-standard `;utf8` form must never come back.
    assert.ok(uri.startsWith("data:image/svg+xml;base64,"), "chart URI must use the base64 form");
  });

  it("sparklineTooltipRow omits the range when labels are missing (chart still shown)", () => {
    const s = spark({ direction: "neutral", minMwh: null, maxMwh: null });
    const row = sparklineTooltipRow(s)!;
    assert.ok(row.startsWith(`| 48h trend | <img src="data:image/svg+xml;base64,`), row);
    assert.ok(row.endsWith(`<span style="color:#9ca3af">• in line with avg</span> |`), row);
  });

  it("rowIconSvg returns the sparkline SVG when the spark is usable", () => {
    const s = spark({ direction: "above" });
    assert.equal(rowIconSvg(s, 100, SCALE), sparklineIconSvg(s, 100, SCALE));
  });

  it("rowIconSvg falls back to basisToSvgUri when the spark is unusable", () => {
    const bad = spark({ points: [{ x: 1, y: 2 }] });
    assert.equal(rowIconSvg(bad, 100, SCALE), basisToSvgUri(100, SCALE));
  });
});

describe("rowView — legacy icon bytes (basisToSvgUri reference)", () => {
  it("pins the exact legacy zap SVG for a known basis", () => {
    // basis 10 = scale min -> severityOf 0 -> "hsl(130, 85%, 55%)".
    assert.equal(
      basisToSvgUri(10, SCALE),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="hsl(130, 85%, 55%)" d="M9.5 1 3.5 9.2h3.4L6 15l6.5-8.2H9.1L9.5 1z"/></svg>`,
    );
    // grey fallback for null basis — the old-cache icon for rows without data.
    assert.ok(basisToSvgUri(null, SCALE).includes(`fill="#808080"`));
  });
});

describe("rowView — tooltip footer (sticky hover)", () => {
  it("pins the exact two-link footer markdown for a sample URL + slug", () => {
    const arg = encodeURIComponent(JSON.stringify({ slug: "deepseek-v4-flash" }));
    assert.equal(
      tooltipFooter("https://portal.neuralwatt.com/energy-pricing", "deepseek-v4-flash"),
      `\n\n[Copy Slug](command:neuraldash.copySlug?${arg}) · [Open Pricing Page ↗](<https://portal.neuralwatt.com/energy-pricing>)`,
    );
  });

  it("renders only the pricing link when slug is absent", () => {
    for (const slug of [null, undefined, ""]) {
      assert.equal(
        tooltipFooter("https://portal.neuralwatt.com/energy-pricing", slug),
        `\n\n[Open Pricing Page ↗](<https://portal.neuralwatt.com/energy-pricing>)`,
      );
    }
  });

  it("contains the `](` link markers and a blank-line separator", () => {
    const footer = tooltipFooter("https://example.com/pricing", "model-a");
    assert.ok(footer.includes("]("), "footer must contain the sticky-hover link marker");
    assert.ok(footer.startsWith("\n\n"), "footer must start with a blank line separating it from the table");
  });

  it("encoded command arg contains no raw hazardous chars", () => {
    const footer = tooltipFooter("https://example.com/pricing", "model-a");
    assert.ok(!footer.includes("|"), "footer markdown must contain no raw pipe");
    const arg = footer.match(/command:neuraldash\.copySlug\?([^)]+)\)/)![1];
    assert.ok(!arg.includes("|") && !arg.includes('"') && !arg.includes("#"), "encoded arg must be hazard-free");
  });
});

describe("rowView — resolveSlugArg branches", () => {
  it("accepts a plain string", () => {
    assert.equal(resolveSlugArg("deepseek-v4-flash"), "deepseek-v4-flash");
  });

  it("accepts an array whose first element is a string", () => {
    assert.equal(resolveSlugArg(["kimi-k3", "extra"]), "kimi-k3");
  });

  it("rejects an array with a non-string first element", () => {
    assert.equal(resolveSlugArg([42, "kimi-k3"] as unknown), null);
    assert.equal(resolveSlugArg([] as unknown), null);
  });

  it("accepts an object with a string slug property", () => {
    assert.equal(resolveSlugArg({ slug: "qwen-3.8-27b" }), "qwen-3.8-27b");
  });

  it("rejects an object without a string slug", () => {
    assert.equal(resolveSlugArg({}), null);
    assert.equal(resolveSlugArg({ slug: 42 }), null);
  });

  it("rejects null, undefined, and numbers", () => {
    assert.equal(resolveSlugArg(null), null);
    assert.equal(resolveSlugArg(undefined), null);
    assert.equal(resolveSlugArg(42), null);
  });

  it("rejects empty-string slugs (no empty clipboard + fake confirmation)", () => {
    assert.equal(resolveSlugArg(""), null);
    assert.equal(resolveSlugArg([""]), null);
    assert.equal(resolveSlugArg({ slug: "" }), null);
  });
});
