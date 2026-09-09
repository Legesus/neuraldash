import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import type { Sparkline48h } from "../src/core/types";
import { TREND_COLORS } from "../src/core/sparkline";
import { encodePngRgba, sparklineToPngBytes } from "../src/core/sparklinePng";

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

function hexRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** Concatenate all IDAT payloads and inflate to the raw scanline buffer. */
function inflateIdat(png: Buffer): { w: number; h: number; raw: Buffer } {
  assert.equal(png.readUInt32BE(16), 400, "expected width 400");
  assert.equal(png.readUInt32BE(20), 104, "expected height 104");
  let off = 8;
  const parts: Buffer[] = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.subarray(off + 4, off + 8).toString("ascii");
    if (type === "IDAT") parts.push(png.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  assert.ok(parts.length > 0, "PNG must contain IDAT");
  return { w: 400, h: 104, raw: inflateSync(Buffer.concat(parts)) };
}

function pixel(raw: Buffer, w: number, x: number, y: number): [number, number, number, number] {
  const stride = w * 4 + 1;
  const i = y * stride + 1 + x * 4;
  return [raw[i], raw[i + 1], raw[i + 2], raw[i + 3]];
}

describe("sparklinePng — file structure", () => {
  it("emits the PNG signature + IHDR 400x104 depth-8 RGBA non-interlaced", () => {
    const png = sparklineToPngBytes(spark())!;
    assert.ok(png, "expected non-null PNG");
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
    assert.equal(png.readUInt32BE(16), 400, "width");
    assert.equal(png.readUInt32BE(20), 104, "height");
    assert.equal(png[24], 8, "bit depth");
    assert.equal(png[25], 6, "color type RGBA");
    assert.equal(png[26], 0, "deflate");
    assert.equal(png[27], 0, "filter set");
    assert.equal(png[28], 0, "non-interlaced");
  });

  it("inflated IDAT has the exact filter-0 scanline byte length", () => {
    const png = sparklineToPngBytes(spark())!;
    const { w, h, raw } = inflateIdat(png);
    assert.equal(raw.length, (w * 4 + 1) * h);
  });

  it("ends with an empty IEND chunk", () => {
    const png = sparklineToPngBytes(spark())!;
    assert.equal(png.subarray(png.length - 8, png.length - 4).toString("ascii"), "IEND");
    assert.equal(png.readUInt32BE(png.length - 12), 0, "IEND length");
  });
});

describe("sparklinePng — pixel content", () => {
  it("paints the last-point center in the exact trend color (below/emerald)", () => {
    // Last point (96,27) maps to display-px (384, 27*104/30) — in-bounds so
    // the disc center lands exactly on the sampled pixel.
    const png = sparklineToPngBytes(spark({ points: [{ x: 0, y: 3 }, { x: 96, y: 27 }], direction: "below" }))!;
    const { w, raw } = inflateIdat(png);
    const lx = Math.round(96 * 4);
    const ly = Math.round(27 * (104 / 30));
    const [er, eg, eb] = hexRgb(TREND_COLORS.below);
    assert.deepEqual(pixel(raw, w, lx, ly), [er, eg, eb, 255]);
  });

  it("leaves the corner pixel fully transparent", () => {
    const png = sparklineToPngBytes(spark())!;
    const { w, raw } = inflateIdat(png);
    assert.deepEqual(pixel(raw, w, 0, 0), [0, 0, 0, 0]);
  });
});

describe("sparklinePng — null gate (mirrors sparklineCardSvg)", () => {
  it("returns null for null, undefined, <2 points, and non-finite coords", () => {
    assert.equal(sparklineToPngBytes(null), null);
    assert.equal(sparklineToPngBytes(undefined), null);
    assert.equal(sparklineToPngBytes(spark({ points: [{ x: 1, y: 2 }] })), null);
    assert.equal(sparklineToPngBytes(spark({ points: [] })), null);
    assert.equal(sparklineToPngBytes(spark({ points: [{ x: NaN, y: 2 }, { x: 100, y: 27 }] })), null);
    assert.equal(
      sparklineToPngBytes(spark({ points: [{ x: 0, y: 3 }, { x: 100, y: Infinity }] })),
      null,
    );
  });

  it("accepts a null refY (refline skipped, chart still rendered)", () => {
    assert.ok(sparklineToPngBytes(spark({ refY: null }))!.length > 0);
  });

  it("treats scale 0, negative, NaN, and Infinity as the default (byte-identical)", () => {
    const def = sparklineToPngBytes(spark())!;
    for (const scale of [0, -1, NaN, Infinity, -Infinity]) {
      assert.deepEqual(sparklineToPngBytes(spark(), { scale }), def, `scale ${String(scale)}`);
    }
  });

  it("still honors a valid custom scale", () => {
    const png = sparklineToPngBytes(spark(), { scale: 1 })!;
    assert.equal(png.readUInt32BE(16), 200, "width");
    assert.equal(png.readUInt32BE(20), 52, "height");
  });
});

describe("sparklinePng — direction smoke + size cap", () => {
  it("produces distinct non-empty buffers per direction", () => {
    const bufs = (["below", "above", "neutral"] as const).map((d) => sparklineToPngBytes(spark({ direction: d }))!);
    for (const b of bufs) assert.ok(b.length > 100, "expected a real PNG payload");
    assert.notDeepEqual(bufs[0], bufs[1]);
    assert.notDeepEqual(bufs[1], bufs[2]);
    assert.notDeepEqual(bufs[0], bufs[2]);
  });

  it("47-point PNG base64 stays under the 8KB tooltip budget", () => {
    // Realistic dense sparkline: 47 points across the full 100x30 range.
    const points = Array.from({ length: 47 }, (_, i) => ({
      x: (i * 100) / 46,
      y: 15 + 10 * Math.sin(i * 0.7) + (i % 3) - 1,
    }));
    const png = sparklineToPngBytes(spark({ points, refY: 15, direction: "above" }))!;
    const b64 = png.toString("base64");
    assert.ok(b64.length < 8192, `47-pt base64 ${b64.length} chars exceeds 8KB budget`);
  });
});

describe("sparklinePng — encodePngRgba unit check", () => {
  it("round-trips a 2x1 buffer through signature + inflate", () => {
    const rgba = Buffer.from([255, 0, 0, 255, 0, 0, 0, 0]);
    const png = encodePngRgba(2, 1, rgba);
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(png.readUInt32BE(16), 2);
    assert.equal(png.readUInt32BE(20), 1);
    let off = 8;
    const parts: Buffer[] = [];
    while (off < png.length) {
      const len = png.readUInt32BE(off);
      const type = png.subarray(off + 4, off + 8).toString("ascii");
      if (type === "IDAT") parts.push(png.subarray(off + 8, off + 8 + len));
      off += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(parts));
    assert.equal(raw.length, (2 * 4 + 1) * 1);
    assert.equal(raw[0], 0, "filter byte 0");
    assert.deepEqual([...raw.subarray(1, 5)], [255, 0, 0, 255]);
    assert.deepEqual([...raw.subarray(5, 9)], [0, 0, 0, 0]);
  });
});
