import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Sparkline48h } from "../src/core/types";
import { basisToSvgUri, computeSeverityScale } from "../src/core/color";
import { sparklineIconSvg } from "../src/core/sparkline";
import { modelRowDescription, sparklineTooltipRow, rowIconSvg, tooltipFooter, resolveSlugArg, resolveModelRefArg, buildModelTooltipMd, buildSparklineImgTag, encodeCommandArg } from "../src/core/rowView";

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

  it("sparklineTooltipRow renders colored text + range + Open-chart link, never an <img>", () => {
    const s = spark({ direction: "below", minMwh: 8.88, maxMwh: 51.26 });
    const arg = encodeURIComponent(JSON.stringify({ slug: "kimi-k3" }));
    const expected =
      `| 48h trend | ` +
      `<span style="color:#34d399;">▼ below avg</span> · lo 8.88 mWh – hi 51.26 mWh` +
      ` · [Open 48h chart](command:neuraldash.openModelChart?${arg}) |`;
    assert.equal(sparklineTooltipRow(s, "kimi-k3"), expected);
    // Encoded arg must be table-safe: no raw `|`, parens, quotes, `#`, or newlines.
    assert.ok(!arg.includes("|") && !arg.includes("(") && !arg.includes(")") && !arg.includes('"') && !arg.includes("#"), "encoded chart arg must be hazard-free");
    assert.ok(!arg.includes("\n") && !arg.includes("\r"), "encoded chart arg must contain no newlines");
    // Arg round-trips back to the slug the panel looks up.
    assert.equal((JSON.parse(decodeURIComponent(arg)) as { slug: string }).slug, "kimi-k3");
    // Sticky hover needs at least one `](` marker in the tooltip (footer provides more).
    assert.ok(sparklineTooltipRow(s, "kimi-k3")!.includes("]("), "chart link keeps the sticky-hover marker");
  });

  it("sparklineTooltipRow omits the range when labels are missing (text + link still shown)", () => {
    const s = spark({ direction: "neutral", minMwh: null, maxMwh: null });
    const row = sparklineTooltipRow(s, "kimi-k3")!;
    assert.ok(!row.includes("<img"), "no chart image in the hover path");
    assert.ok(row.startsWith(`| 48h trend | <span style="color:#9ca3af;">• in line with avg</span>`), row);
    assert.ok(row.includes("command:neuraldash.openModelChart?"), "chart link present");
  });

  it("sparklineTooltipRow keeps the text row without a link when slug is absent", () => {
    for (const slug of [null, undefined, ""]) {
      const row = sparklineTooltipRow(spark(), slug)!;
      assert.ok(!row.includes("<img"), "no chart image in the hover path");
      assert.ok(row.includes("below avg"), "colored text still rendered");
      assert.ok(!row.includes("command:neuraldash.openModelChart"), "no chart link without a slug");
      assert.ok(row.startsWith("| 48h trend | ") && row.endsWith(" |"), "valid table row");
    }
  });

  it("sparklineTooltipRow keeps text + link even when the spark is unusable (panel stays honest)", () => {
    // Single-point spark: no PNG/SVG can render, but the text row + link are
    // still useful — the panel shows the honest no-data message on open.
    const bad = spark({ points: [{ x: 1, y: 2 }] });
    const row = sparklineTooltipRow(bad, "kimi-k3")!;
    assert.ok(!row.includes("<img"), "no chart image in the hover path");
    assert.ok(row.includes("below avg"), "colored text still rendered");
    assert.ok(row.includes("command:neuraldash.openModelChart?"), "link present; panel reports no-data honestly");
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

describe("rowView — buildModelTooltipMd (debugTooltip extraction)", () => {
  function valued(over?: Record<string, unknown>) {
    const { quote: quoteOver, ...restOver } = over ?? {};
    return {
      quote: {
        displayName: "Kimi K3",
        slug: "kimi-k3",
        isPreview: false,
        contextBand: null,
        cachePct: null,
        rightNowMwh: 22.31,
        typicalMwh: 20.0,
        trend: null,
        sparkline: spark(),
        bands: [],
        capturedAt: "2026-09-04T00:00:00Z",
        ...((quoteOver as Record<string, unknown>) ?? {}),
      },
      basisMwh: 20.0,
      score: null,
      value: null,
      costPer1kUsd: null,
      descriptionMwh: 22.31,
      ...restOver,
    } as never;
  }

  it("builds the exact tooltip markdown: text trend row + Open-chart link, no <img>", () => {
    const md = buildModelTooltipMd(valued(), { fetchedAt: "2026-09-04T00:00:00Z", isBest: false, pricingUrl: "https://portal.neuralwatt.com/energy-pricing", tariff: 10 });
    assert.ok(!md.includes("<img"), "hover tooltip must never embed an image");
    assert.ok(md.includes("| 48h trend | "), "trend row present");
    assert.ok(md.includes("[Open 48h chart](command:neuraldash.openModelChart?"), "chart link present");
    const arg = md.match(/command:neuraldash\.openModelChart\?([^)]+)\)/)![1];
    assert.equal((JSON.parse(decodeURIComponent(arg)) as { slug: string }).slug, "kimi-k3", "chart arg resolves to the row slug");
    assert.ok(md.includes("slug: kimi-k3"), "header slug present");
    assert.ok(md.includes("command:neuraldash.copySlug"), "sticky-hover footer present");
  });

  it("buildModelTooltipMd omits the trend row without spark, keeps footer sticky", () => {
    const md = buildModelTooltipMd(valued({ quote: { sparkline: null } }), { fetchedAt: null, isBest: false, pricingUrl: "https://portal.neuralwatt.com/energy-pricing", tariff: 10 });
    assert.ok(!md.includes("48h trend"), "no trend row without spark data");
    assert.ok(md.includes("command:neuraldash.copySlug"), "footer keeps the hover sticky");
  });

  it("buildSparklineImgTag builds the PNG img tag from spark data, null when unusable", () => {
    const tag = buildSparklineImgTag(spark());
    assert.ok(tag?.startsWith(`<img src="data:image/png;base64,`), tag?.slice(0, 60));
    assert.ok(tag?.includes(`width="200" height="52">`), "display attrs pinned");
    // The tag now powers the chart panel — the hover tooltip embeds no image.
    assert.ok(!sparklineTooltipRow(spark(), "kimi-k3")!.includes("<img"), "tooltip row must not embed the tag");
    assert.equal(buildSparklineImgTag(null), null);
    assert.equal(buildSparklineImgTag(undefined), null);
    assert.equal(buildSparklineImgTag(spark({ points: [{ x: 0, y: 3 }] })), null);
  });

  it("buildSparklineImgTag honors the display-size param (chart panel: 400x104)", () => {
    const tag = buildSparklineImgTag(spark(), { w: 400, h: 104 });
    assert.ok(tag?.includes(`width="400" height="104">`), tag?.slice(0, 120));
    assert.ok(tag?.startsWith(`<img src="data:image/png;base64,`), "PNG form unchanged");
  });
});

describe("rowView — trusted-tooltip HTML injection guards", () => {
  // The tooltip MarkdownString is TRUSTED (isTrusted=true for command links),
  // so any raw `<` in model-derived fields would become real HTML in the hover.
  function valued(over?: Record<string, unknown>) {
    const { quote: quoteOver, ...restOver } = over ?? {};
    return {
      quote: {
        displayName: "Kimi K3",
        slug: "kimi-k3",
        isPreview: false,
        contextBand: null,
        cachePct: null,
        rightNowMwh: 22.31,
        typicalMwh: 20.0,
        trend: null,
        sparkline: null,
        bands: [],
        capturedAt: "2026-09-04T00:00:00Z",
        ...((quoteOver as Record<string, unknown>) ?? {}),
      },
      basisMwh: 20.0,
      score: null,
      value: null,
      costPer1kUsd: null,
      descriptionMwh: 22.31,
      ...restOver,
    } as never;
  }

  it("hostile displayName cannot inject raw HTML into the trusted tooltip", () => {
    const md = buildModelTooltipMd(valued({ quote: { displayName: `<img src=x onerror=1>` } }), { fetchedAt: null, isBest: false, pricingUrl: "https://portal.neuralwatt.com/energy-pricing", tariff: 10 });
    assert.ok(!md.includes("<img"), "raw <img must never survive into md.value");
    assert.ok(md.includes("&lt;img src=x onerror=1&gt;"), "name renders as literal text via entities");
    const md2 = buildModelTooltipMd(valued({ quote: { displayName: "<script>alert(1)</script>", slug: "<script>" } }), { fetchedAt: null, isBest: false, pricingUrl: "https://portal.neuralwatt.com/energy-pricing", tariff: 10 });
    assert.ok(!md2.includes("<script>"), "raw <script> must never survive into md.value");
  });

  it("encodeCommandArg force-encodes parentheses (markdown link delimiters)", () => {
    const hostile = 'x)y|z#"w(';
    const arg = encodeCommandArg({ slug: hostile });
    for (const ch of ["(", ")", "|", '"', "#"]) {
      assert.ok(!arg.includes(ch), `encoded arg must not contain raw ${ch}`);
    }
    assert.equal((JSON.parse(decodeURIComponent(arg)) as { slug: string }).slug, hostile, "arg round-trips to the slug");
    // The chart link built with the hostile slug stays a single valid link.
    const row = sparklineTooltipRow(spark(), hostile)!;
    assert.equal(row.match(/command:neuraldash\.openModelChart\?[^)]+\)/g)?.length, 1, "exactly one link, closed once");
    assert.ok(row.includes("%28") && row.includes("%29"), "parens appear percent-encoded");
  });
});

describe("rowView — resolveModelRefArg (openModelChart shapes)", () => {
  it("accepts slug-object, TreeItem id, plain string, and array shapes", () => {
    assert.equal(resolveModelRefArg({ slug: "a" }), "a");
    assert.equal(resolveModelRefArg({ id: "b" }), "b");
    assert.equal(resolveModelRefArg("c"), "c");
    assert.equal(resolveModelRefArg(["d"]), "d");
  });

  it("prefers the slug shape when both slug and id are present", () => {
    assert.equal(resolveModelRefArg({ slug: "a", id: "b" }), "a");
  });

  it("rejects empty/missing shapes", () => {
    assert.equal(resolveModelRefArg({}), null);
    assert.equal(resolveModelRefArg(null), null);
    assert.equal(resolveModelRefArg(undefined), null);
    assert.equal(resolveModelRefArg({ id: 42 }), null);
    assert.equal(resolveModelRefArg({ id: "" }), null);
    assert.equal(resolveModelRefArg(""), null);
  });
});

describe("manifest — openModelChart command shape", () => {
  it("declares the command, activation event, and model-only context menus", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require("../../package.json");
    assert.ok((pkg.activationEvents as string[]).includes("onCommand:neuraldash.openModelChart"), "activation event");
    const cmd = (pkg.contributes.commands as { command: string }[]).find((c) => c.command === "neuraldash.openModelChart");
    assert.ok(cmd, "command registered");
    const menus = pkg.contributes.menus["view/item/context"] as { command: string; when: string }[];
    const chartMenus = menus.filter((m) => m.command === "neuraldash.openModelChart");
    assert.equal(chartMenus.length, 2, "inline + navigation entries");
    for (const m of chartMenus) {
      assert.ok(m.when.includes("view == neuralwatt.board"), "board view gate");
      assert.ok(m.when.includes("viewItem == model"), "model viewItem gate");
      assert.ok(!m.when.includes("flex.model"), "flex rows excluded");
    }
  });
});
