import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parsePerfMetrics } from "../src/core/perfMetrics";
import { ParseError } from "../src/core/types";

function perfRow(opts: {
  slug: string;
  family?: string;
  lane?: string;
  marker?: string;
  td1: string;
  td2: string;
  td3: string;
}): string {
  const laneAttr = opts.lane ? ` data-perf-lane="${opts.lane}"` : "";
  const cell0 = opts.lane
    ? `<div>${opts.slug}</div><div>${opts.marker ?? ""}</div>`
    : `<div title="${opts.slug}"><a href="/models/${opts.slug}">Standard</a></div>`;
  return (
    `<tr data-family-row="${opts.family ?? opts.slug}"${laneAttr}>` +
    `<td>${cell0}</td>` +
    `<td>${opts.td1}</td>` +
    `<td>${opts.td2}</td>` +
    `<td>${opts.td3}</td>` +
    `</tr>`
  );
}

const FLEX_MARKER = `<span title="Wait for spare capacity for an energy discount.">Flex tier</span><span data-perf-invocation>service_tier="flex"</span>`;

describe("perfMetrics.parsePerfMetrics", () => {
  it("parses standard, speed, and flex rows with ms/s conversion and no fabricated flex throughput", () => {
    const html = `<html><body><table><tbody>
      ${perfRow({
        slug: "alpha-flash",
        td1: "538 ms &middot; 2.19 s p50 &middot; p95",
        td2: "228 &middot; 448 tok/s &middot; p50 &middot; p95",
        td3: "98% 7d, typical size",
      })}
      ${perfRow({
        slug: "alpha-flash",
        lane: "alpha-flash",
        marker: FLEX_MARKER,
        td1: "6.04 s &middot; 60.0 s Dispatch wait &middot; p50 &middot; p95",
        td2: "",
        td3: "",
      })}
      ${perfRow({
        slug: "alpha-flash-speed",
        lane: "alpha-flash-speed",
        marker: `<span data-perf-invocation>alpha-flash-speed</span>`,
        td1: "492 ms &middot; 1.27 s p50 &middot; p95",
        td2: "559 &middot; 874 tok/s &middot; p50 &middot; p95",
        td3: "98% 7d, typical size",
      })}
    </tbody></table></body></html>`;

    const doc = parsePerfMetrics(html);
    assert.deepEqual(doc.standard["alpha-flash"], {
      slug: "alpha-flash",
      firstTokenMs: { p50: 538, p95: 2190 },
      throughputToks: { p50: 228, p95: 448 },
      cacheHitPct: 98,
      throughputSparkline: null,
    });
    assert.deepEqual(doc.standard["alpha-flash-speed"], {
      slug: "alpha-flash-speed",
      firstTokenMs: { p50: 492, p95: 1270 },
      throughputToks: { p50: 559, p95: 874 },
      cacheHitPct: 98,
      throughputSparkline: null,
    });
    assert.deepEqual(doc.flex["alpha-flash"], {
      slug: "alpha-flash",
      firstTokenMs: null,
      throughputToks: null,
      cacheHitPct: null,
      flexDispatchWaitMs: { p50: 6040, p95: 60000 },
      flexHoldBars: null,
    });
  });

  it("stores null for 'not reported' or empty metrics without fabricating", () => {
    const html = `<html><body><table><tbody>
      ${perfRow({
        slug: "beta-fast",
        td1: "not reported",
        td2: "192 &middot; 207 tok/s &middot; p50 &middot; p95",
        td3: "49% 7d, typical size",
      })}
      ${perfRow({
        slug: "gamma-empty",
        td1: "—",
        td2: "",
        td3: "not reported",
      })}
    </tbody></table></body></html>`;

    const doc = parsePerfMetrics(html);
    assert.deepEqual(doc.standard["beta-fast"], {
      slug: "beta-fast",
      firstTokenMs: null,
      throughputToks: { p50: 192, p95: 207 },
      cacheHitPct: 49,
      throughputSparkline: null,
    });
    assert.deepEqual(doc.standard["gamma-empty"], {
      slug: "gamma-empty",
      firstTokenMs: null,
      throughputToks: null,
      cacheHitPct: null,
      throughputSparkline: null,
    });
  });

  it("fails loudly with ParseError on empty, lane-less, or malformed metric shapes", () => {
    assert.throws(() => parsePerfMetrics(""), ParseError);
    assert.throws(() => parsePerfMetrics("<html><body><p>err</p></body></html>"), ParseError);
    const badLatency = `<html><body><table><tbody>${perfRow({
      slug: "bad-model",
      td1: "weird-unparseable-latency",
      td2: "100 · 200 tok/s",
      td3: "50%",
    })}</tbody></table></body></html>`;
    assert.throws(() => parsePerfMetrics(badLatency), ParseError);
    const badThroughput = `<html><body><table><tbody>${perfRow({
      slug: "bad-tok",
      td1: "500 ms · 1.0 s",
      td2: "garbage tok/s",
      td3: "50%",
    })}</tbody></table></body></html>`;
    assert.throws(() => parsePerfMetrics(badThroughput), ParseError);
  });

  it("parses td[4] throughput line sparkline and flex hold bar graph", () => {
    const lineTd4 =
      `<div data-perf-trend="line"><svg viewBox="0 0 136 32">` +
      `<line x1="0" y1="20" x2="136" y2="20" />` +
      `<path d="M1.4,18L50,12L100,8L134,5" class="nw-perf-row-p50" />` +
      `</svg><span class="nw-perf-row-labels"><span>403</span><span>206</span></span></div>`;
    const barsTd4 =
      `<div data-perf-trend="bars"><svg viewBox="0 0 136 32">` +
      `<rect x="10" y="20" width="1.8" height="9" />` +
      `<rect x="60" y="3" width="1.8" height="26" />` +
      `</svg><span class="nw-perf-row-labels"><span>60.0 s</span><span>0 s</span></span></div>`;
    const html = `<html><body><table><tbody>
      <tr data-family-row="alpha">
        <td><div title="alpha-flash">Standard</div></td>
        <td>500 ms · 1.2 s</td>
        <td>200 · 300 tok/s</td>
        <td>95%</td>
        <td>${lineTd4}</td>
      </tr>
      <tr data-family-row="alpha" data-perf-lane="alpha-flash">
        <td><div>alpha-flash</div><div>${FLEX_MARKER}</div></td>
        <td>4.0 s · 20.0 s Dispatch wait</td>
        <td></td>
        <td></td>
        <td>${barsTd4}</td>
      </tr>
    </tbody></table></body></html>`;

    const doc = parsePerfMetrics(html);
    assert.deepEqual(doc.standard["alpha-flash"]?.throughputSparkline, {
      points: [
        { x: 1.4, y: 18 },
        { x: 50, y: 12 },
        { x: 100, y: 8 },
        { x: 134, y: 5 },
      ],
      refY: 20,
      maxToks: 403,
      minToks: 206,
    });
    assert.deepEqual(doc.flex["alpha-flash"]?.flexHoldBars, {
      bars: [
        { x: 10, height: 9 },
        { x: 60, height: 26 },
      ],
      maxLabel: "60.0 s",
      minLabel: "0 s",
    });
  });

  it("extracts tracking alias pointers from data-family-header rows", () => {
    const html = `<table>
      <tr data-family-header="Alpha Flash">
        <td colspan="5">
          <span>Alpha Flash</span>
          <span data-family-pointers><a href="/models/alias-flash">alias-flash</a> points here</span>
        </td>
      </tr>
      ${perfRow({ slug: "alpha-flash", family: "Alpha Flash", td1: "200 ms &middot; 500 ms", td2: "120 &middot; 90 tok/s", td3: "50%" })}
      ${perfRow({ slug: "alpha-flash", family: "Alpha Flash", lane: "alpha-flash", marker: FLEX_MARKER, td1: "4.0 s &middot; 20.0 s Dispatch wait", td2: "", td3: "" })}
    </table>`;
    const doc = parsePerfMetrics(html);
    assert.deepEqual(doc.aliases, { "alias-flash": "alpha-flash" });
  });
});
