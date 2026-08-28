import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeSeverityScale, severityOf, severityColor, basisToSvgUri } from "../src/core/color";

function close(a: number, b: number, eps = 1e-9) {
  assert.ok(Math.abs(a - b) < eps, `${a} ~ ${b}`);
}

describe("color.severityColor", () => {
  it("exact hsl strings at s=0/0.5/1", () => {
    assert.equal(severityColor(0), "hsl(130, 85%, 55%)");
    assert.equal(severityColor(0.5), "hsl(60, 45%, 55%)");
    assert.equal(severityColor(1), "hsl(0, 85%, 55%)");
  });
  it("hue 95 at s=0.25", () => {
    assert.equal(severityColor(0.25), "hsl(95, 65%, 55%)");
  });
  it("saturation 45 mid / 85 extremes", () => {
    assert.match(severityColor(0.5), /45%/);
    assert.match(severityColor(0), /85%/);
    assert.match(severityColor(1), /85%/);
  });
});

describe("color.severityOf", () => {
  it("monotone over [21,198,1870] with geometric mean -> 0.5", () => {
    const bases = [21, 198, 1870];
    const scale = computeSeverityScale(bases);
    // monotone
    const s21 = severityOf(21, scale);
    const s198 = severityOf(198, scale);
    const s1870 = severityOf(1870, scale);
    assert.ok(s21 < s198 && s198 < s1870, `monotone ${s21} < ${s198} < ${s1870}`);
    close(s21, 0);
    close(s1870, 1);
    // geometric mean of min and max => 0.5 in log space
    const geo = Math.sqrt(21 * 1870);
    const sGeo = severityOf(geo, scale);
    close(sGeo, 0.5, 1e-9);
  });
  it("clamping outside range", () => {
    const scale = computeSeverityScale([10, 100]);
    close(severityOf(1, scale), 0);
    close(severityOf(1000, scale), 1);
  });
  it("single distinct basis -> 0.5", () => {
    const scale = computeSeverityScale([42]);
    close(severityOf(42, scale), 0.5);
  });
  it("equal bases -> 0.5", () => {
    const scale = computeSeverityScale([50, 50, 50]);
    close(severityOf(50, scale), 0.5);
  });
  it("null/0/NaN -> grey handling (basisToSvgUri) and degenerate 0.5", () => {
    const scale = computeSeverityScale([10, 100]);
    close(severityOf(null, scale), 0.5);
    close(severityOf(0, scale), 0.5);
    close(severityOf(NaN, scale), 0.5);
    close(severityOf(Infinity, scale), 0.5);
    const grey = basisToSvgUri(null, scale);
    assert.ok(grey.includes("#808080"), `grey null ${grey}`);
    assert.ok(basisToSvgUri(0, scale).includes("#808080"));
    assert.ok(basisToSvgUri(NaN, scale).includes("#808080"));
  });
  it("computeSeverityScale ignores null/<=0/non-finite", () => {
    const scale = computeSeverityScale([null, 0, -5, NaN, Infinity, 10, 100]);
    assert.equal(scale.count, 2);
    close(scale.lnMin, Math.log(10));
    close(scale.lnMax, Math.log(100));
  });
  it("basisToSvgUri tints valid basis with hsl", () => {
    const scale = computeSeverityScale([10, 100]);
    const svgCheap = basisToSvgUri(10, scale);
    const svgExp = basisToSvgUri(100, scale);
    assert.ok(svgCheap.includes("hsl(130"), `cheap green ${svgCheap}`);
    assert.ok(svgExp.includes("hsl(0"), `expensive red ${svgExp}`);
    assert.ok(svgCheap.includes('viewBox="0 0 16 16"'));
  });
});
