/**
 * Pure PNG sparkline rasterizer: dependency-free 48h trend chart encoder.
 * ZERO vscode imports — fully unit-testable under plain node:test.
 *
 * Why PNG: the chart panel WebviewPanel renders `data:image/png;base64`
 * images (proven path). This module replicates the `sparklineCardSvg`
 * semantics (100x30 source geometry, dotted refline, trend polyline,
 * last-point emphasis dot) as raster bytes.
 *
 * Only Node built-in used: `node:zlib` for the IDAT deflate stream.
 * `Buffer` is a global (same convention as src/core/rowView.ts).
 * Extension-host-safe: pure arithmetic + Buffer + zlib, no canvas/sharp/native.
 */
import { deflateSync } from "node:zlib";
import type { Sparkline48h } from "./types";
import { TREND_COLORS } from "./sparkline";

/** Display slot the chart-panel img uses (matches buildSparklineImgTag panel attrs). */
export const SPARKLINE_PNG_DISPLAY_W = 200;
export const SPARKLINE_PNG_DISPLAY_H = 52;

/** Source geometry — MUST match sparklineCardSvg's 100x30 viewBox. */
const SRC_W = 100;
const SRC_H = 30;

/** Rendering options. Scale multiplies the display slot for the backing store. */
export interface SparklinePngOptions {
  /**
   * Backing-store multiplier over the 200x52 display slot. Default 2
   * (400x104 backing): crisp on hidpi, same non-uniform stretch as the
   * SVG's preserveAspectRatio="none".
   */
  scale?: number;
}

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** Src-over blend of (r,g,b,a 0..255) onto pixel (x,y) of an RGBA buffer. */
function blendPixel(buf: Buffer, w: number, h: number, x: number, y: number, r: number, g: number, b: number, a: number): void {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 4;
  if (a >= 255) {
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = 255;
    return;
  }
  if (a <= 0) return;
  const sa = a / 255;
  const da = buf[i + 3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) {
    buf[i] = buf[i + 1] = buf[i + 2] = buf[i + 3] = 0;
    return;
  }
  buf[i] = Math.round((r * sa + buf[i] * da * (1 - sa)) / outA);
  buf[i + 1] = Math.round((g * sa + buf[i + 1] * da * (1 - sa)) / outA);
  buf[i + 2] = Math.round((b * sa + buf[i + 2] * da * (1 - sa)) / outA);
  buf[i + 3] = Math.round(outA * 255);
}

/** Filled disc with a 0.5px analytic anti-aliased edge; alpha = 0..255 peak. */
function fillDisc(buf: Buffer, w: number, h: number, cx: number, cy: number, radius: number, r: number, g: number, b: number, alpha: number): void {
  const rOut = radius + 0.5;
  const x0 = Math.floor(cx - rOut);
  const x1 = Math.ceil(cx + rOut);
  const y0 = Math.floor(cy - rOut);
  const y1 = Math.ceil(cy + rOut);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.sqrt((x + 0.5 - cx) * (x + 0.5 - cx) + (y + 0.5 - cy) * (y + 0.5 - cy));
      if (d >= rOut) continue;
      const coverage = Math.min(1, Math.max(0, rOut - d));
      blendPixel(buf, w, h, x, y, r, g, b, Math.round(alpha * coverage));
    }
  }
}

/** Opaque thick segment, drawn by stamping discs along its length (round joins). */
function strokeSegment(
  buf: Buffer, w: number, h: number,
  x0: number, y0: number, x1: number, y1: number,
  radius: number, r: number, g: number, b: number,
): void {
  const len = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
  const steps = Math.max(1, Math.ceil(len / 0.4));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    fillDisc(buf, w, h, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, r, g, b, 255);
  }
}

/** Dotted horizontal line: `on`px on / `off`px off, `thick`px tall, AA top/bottom. */
function dottedHLine(
  buf: Buffer, w: number, h: number,
  yCenter: number, colorHex: string, alpha: number,
  on: number, off: number, thick: number,
): void {
  const [r, g, b] = hexToRgb(colorHex);
  const period = on + off;
  for (let x = 0; x < w; x++) {
    if (x % period >= on) continue;
    const top = yCenter - thick / 2;
    const yA = Math.floor(top);
    const yB = Math.floor(yCenter + thick / 2);
    for (let y = yA; y <= yB; y++) {
      const lo = Math.max(y, top);
      const hi = Math.min(y + 1, top + thick);
      const cov = Math.max(0, hi - lo);
      if (cov <= 0) continue;
      blendPixel(buf, w, h, x, y, r, g, b, Math.round(alpha * cov));
    }
  }
}

// ---- PNG encoding (8-bit RGBA, non-interlaced) ----

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(typeAscii: string, data: Buffer): Buffer {
  const type = Buffer.from(typeAscii, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])), 0);
  return Buffer.concat([len, type, data, crc]);
}

/** Encode a raw RGBA buffer as a minimal PNG (signature + IHDR + IDAT + IEND). */
export function encodePngRgba(w: number, h: number, rgba: Buffer): Buffer {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None)
    rgba.subarray(y * stride, (y + 1) * stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // filter set 0
  ihdr[12] = 0; // non-interlaced
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Rasterize a 48h sparkline to PNG bytes for the chart panel.
 * Null gate mirrors sparklineCardSvg: absent spark, <2 points, or any
 * non-finite coordinate → null.
 */
export function sparklineToPngBytes(spark: Sparkline48h | null | undefined, opts?: SparklinePngOptions): Buffer | null {
  if (!spark || !Array.isArray(spark.points) || spark.points.length < 2) return null;
  for (const p of spark.points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  }

  // Non-finite or non-positive scale would produce invalid dimensions or
  // allocation errors — fall back to the default (production uses it anyway).
  const requested = opts?.scale ?? 2;
  const scale = Number.isFinite(requested) && requested > 0 ? requested : 2;
  const w = Math.round(SPARKLINE_PNG_DISPLAY_W * scale);
  const h = Math.round(SPARKLINE_PNG_DISPLAY_H * scale);
  const sx = w / SRC_W;
  const sy = h / SRC_H;

  // Transparent background: the VS Code hover surface shows through, so the
  // chart blends into both dark and light themes with no bounding box.
  const buf = Buffer.alloc(w * h * 4, 0);

  // 1. Dotted refline (mirrors the SVG's dasharray 2,2 in source units).
  if (spark.refY != null && Number.isFinite(spark.refY)) {
    dottedHLine(buf, w, h, spark.refY * sy, "#9ca3af", Math.round(255 * 0.6), 4 * scale, 4 * scale, 1.5 * scale);
  }

  // 2. Trend polyline. The stroke is deliberately heavier than the SVG's
  // 1.5-unit hairline: at 30-tall source geometry a hairline is sub-pixel
  // when rasterized, so ~2.5 display px keeps it legible at tooltip size.
  const colorHex = TREND_COLORS[spark.direction] ?? TREND_COLORS.neutral;
  const [lr, lg, lb] = hexToRgb(colorHex);
  const px = spark.points.map((p) => ({ x: p.x * sx, y: p.y * sy }));
  for (let i = 0; i + 1 < px.length; i++) {
    strokeSegment(buf, w, h, px[i].x, px[i].y, px[i + 1].x, px[i + 1].y, 1.25 * scale, lr, lg, lb);
  }

  // 3. Last-point emphasis dot ("now"), in trend color.
  const last = px[px.length - 1];
  fillDisc(buf, w, h, last.x, last.y, 2 * scale, lr, lg, lb, 255);

  return encodePngRgba(w, h, buf);
}
