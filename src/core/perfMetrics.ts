import { parse, HTMLElement } from "node-html-parser";
import { ParseError } from "./types";
import type { SparklinePoint } from "./types";

export interface P50P95 {
  p50: number;
  p95: number;
}

export interface ThroughputSparkline {
  points: SparklinePoint[];
  refY: number | null;
  minToks: number | null;
  maxToks: number | null;
}

export interface FlexHoldBars {
  /** SVG rect x (0..136) and height (0..29). */
  bars: { x: number; height: number }[];
  minLabel: string | null;
  maxLabel: string | null;
}

export interface ModelPerfMetrics {
  slug: string;
  firstTokenMs: P50P95 | null;
  throughputToks: P50P95 | null;
  cacheHitPct: number | null;
  throughputSparkline?: ThroughputSparkline | null;
  flexDispatchWaitMs?: P50P95 | null;
  flexHoldBars?: FlexHoldBars | null;
}

export interface PerfMetricsDoc {
  standard: Record<string, ModelPerfMetrics>;
  flex: Record<string, ModelPerfMetrics>;
  /** Alias slug (e.g. from data-family-pointers) -> backend model slug. */
  aliases?: Record<string, string>;
}

function cleanCellText(td: HTMLElement | undefined): string {
  if (!td) return "";
  return td.text.replace(/\s+/g, " ").trim();
}

function isMissingCell(text: string): boolean {
  if (!text) return true;
  const lower = text.toLowerCase();
  return lower === "-" || lower === "\u2014" || lower === "n/a" || lower.includes("not reported");
}

function toMs(numStr: string, unit: string): number {
  const val = parseFloat(numStr);
  if (!Number.isFinite(val)) return NaN;
  return unit.toLowerCase() === "s" ? Math.round(val * 1000) : Math.round(val);
}

function parseLatencyPair(text: string, label: string): P50P95 | null {
  if (isMissingCell(text)) return null;
  const m = text.match(/([\d.]+)\s*(ms|s)\s*[·\u00b7]\s*([\d.]+)\s*(ms|s)/i);
  if (!m) throw new ParseError(`Malformed ${label} cell: "${text}"`);
  const p50 = toMs(m[1]!, m[2]!);
  const p95 = toMs(m[3]!, m[4]!);
  if (!Number.isFinite(p50) || !Number.isFinite(p95)) {
    throw new ParseError(`Non-finite ${label} values: "${text}"`);
  }
  return { p50, p95 };
}

function parseThroughputPair(text: string): P50P95 | null {
  if (isMissingCell(text)) return null;
  const m = text.match(/([\d.]+)\s*[·\u00b7]\s*([\d.]+)\s*tok\/s/i);
  if (!m) throw new ParseError(`Malformed throughput cell: "${text}"`);
  const p50 = parseFloat(m[1]!);
  const p95 = parseFloat(m[2]!);
  if (!Number.isFinite(p50) || !Number.isFinite(p95)) {
    throw new ParseError(`Non-finite throughput values: "${text}"`);
  }
  return { p50, p95 };
}

function parseCacheHitPct(text: string): number | null {
  if (isMissingCell(text)) return null;
  const m = text.match(/(\d+(?:\.\d+)?)%/);
  if (!m) return null;
  const val = parseFloat(m[1]!);
  return Number.isFinite(val) ? val : null;
}

function isFlexRow(row: HTMLElement, td1Text: string): boolean {
  for (const inv of row.querySelectorAll("[data-perf-invocation]")) {
    if (inv.text.replace(/\s+/g, "").toLowerCase().includes('service_tier="flex"')) return true;
  }
  for (const tagged of row.querySelectorAll("span[title]")) {
    if ((tagged.getAttribute("title") ?? "").toLowerCase().includes("wait for spare capacity")) return true;
  }
  return td1Text.toLowerCase().includes("dispatch wait");
}

function parseThroughputSparkline(td: HTMLElement | undefined): ThroughputSparkline | null {
  if (!td) return null;
  const pathEl = td.querySelector("[data-perf-trend='line'] svg path[d]") ?? td.querySelector("svg path.nw-perf-row-p50[d]");
  if (!pathEl) return null;
  const d = pathEl.getAttribute("d") ?? "";
  const points: SparklinePoint[] = [];
  for (const m of d.matchAll(/[ML]\s*(-?[\d.]+)[,\s]+(-?[\d.]+)/gi)) {
    const x = parseFloat(m[1]!);
    const y = parseFloat(m[2]!);
    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
  }
  if (points.length < 2) return null;
  const refLine = td.querySelector("svg line");
  const refRaw = parseFloat(refLine?.getAttribute("y1") ?? "");
  const refY = Number.isFinite(refRaw) ? refRaw : null;
  const labels = td.querySelectorAll(".nw-perf-row-labels span").map((s) => s.text.trim());
  const maxRaw = labels[0] ? parseFloat(labels[0]) : NaN;
  const minRaw = labels[1] ? parseFloat(labels[1]) : NaN;
  return {
    points,
    refY,
    maxToks: Number.isFinite(maxRaw) ? maxRaw : null,
    minToks: Number.isFinite(minRaw) ? minRaw : null,
  };
}

function parseFlexHoldBars(td: HTMLElement | undefined): FlexHoldBars | null {
  if (!td) return null;
  const holder = td.querySelector("[data-perf-trend='bars'] svg");
  if (!holder) return null;
  const bars: { x: number; height: number }[] = [];
  for (const rect of holder.querySelectorAll("rect")) {
    const x = parseFloat(rect.getAttribute("x") ?? "");
    const height = parseFloat(rect.getAttribute("height") ?? "");
    if (Number.isFinite(x) && Number.isFinite(height)) bars.push({ x, height });
  }
  if (bars.length === 0) return null;
  const labels = td.querySelectorAll(".nw-perf-row-labels span").map((s) => s.text.trim());
  return {
    bars,
    maxLabel: labels[0] || null,
    minLabel: labels[1] || null,
  };
}

function extractSlug(row: HTMLElement): string | null {
  const lane = (row.getAttribute("data-perf-lane") ?? "").trim();
  if (lane) return lane;
  const div = (row.querySelector("td") ?? row).querySelector("div[title]");
  const title = (div?.getAttribute("title") ?? "").trim();
  if (title && !/\s/.test(title)) return title;
  const href = row.querySelector("a[href^='/models/']")?.getAttribute("href") ?? "";
  const slug = href.replace(/^\/models\//, "").trim();
  return slug && !/\s/.test(slug) ? slug : null;
}

/**
 * Parse performance metrics (firstTokenMs, throughputToks, cacheHitPct,
 * flexDispatchWaitMs) from `?view=performance` HTML. Fails loudly with
 * ParseError on empty/lane-less documents or unexpected metric cell shapes.
 */
export function parsePerfMetrics(html: string): PerfMetricsDoc {
  if (typeof html !== "string" || html.trim() === "") {
    throw new ParseError("Empty performance view HTML");
  }
  const root = parse(html);
  const rows = root.querySelectorAll("tr[data-family-row]");
  if (rows.length === 0) {
    throw new ParseError("No metrics rows found in performance view HTML");
  }

  const standard: Record<string, ModelPerfMetrics> = {};
  const flex: Record<string, ModelPerfMetrics> = {};
  const familyToSlug: Record<string, string> = {};
  const familyFallbackSlug: Record<string, string> = {};

  const pendingAliases: { aliasSlug: string; family: string }[] = [];
  for (const header of root.querySelectorAll("tr[data-family-header]")) {
    const family = (header.getAttribute("data-family-header") ?? "").trim();
    const ptr = header.querySelector("[data-family-pointers]");
    if (!family || !ptr) continue;
    for (const a of ptr.querySelectorAll("a")) {
      const hrefSlug = (a.getAttribute("href") ?? "").replace(/^\/models\//, "").trim();
      const textSlug = a.text.trim();
      const aliasSlug = textSlug && !/\s/.test(textSlug) ? textSlug : hrefSlug && !/\s/.test(hrefSlug) ? hrefSlug : "";
      if (aliasSlug) pendingAliases.push({ aliasSlug, family });
    }
  }

  for (const row of rows) {
    const slug = extractSlug(row);
    if (!slug) continue;
    const family = (row.getAttribute("data-family-row") ?? "").trim();
    if (family && !familyFallbackSlug[family]) familyFallbackSlug[family] = slug;
    const tds = row.querySelectorAll("td");
    const td1 = cleanCellText(tds[1]);
    const td2 = cleanCellText(tds[2]);
    const td3 = cleanCellText(tds[3]);

    if (isFlexRow(row, td1)) {
      if (!flex[slug]) {
        flex[slug] = {
          slug,
          firstTokenMs: null,
          throughputToks: null,
          cacheHitPct: null,
          flexDispatchWaitMs: parseLatencyPair(td1, "dispatch wait"),
          flexHoldBars: parseFlexHoldBars(tds[4]),
        };
      }
      continue;
    }

    if (family && !familyToSlug[family]) familyToSlug[family] = slug;
    if (!standard[slug]) {
      standard[slug] = {
        slug,
        firstTokenMs: parseLatencyPair(td1, "first token"),
        throughputToks: parseThroughputPair(td2),
        cacheHitPct: parseCacheHitPct(td3),
        throughputSparkline: parseThroughputSparkline(tds[4]),
      };
    }
  }

  if (Object.keys(standard).length === 0 && Object.keys(flex).length === 0) {
    throw new ParseError("No parseable model metrics in performance view HTML");
  }

  const aliases: Record<string, string> = {};
  for (const { aliasSlug, family } of pendingAliases) {
    const target = familyToSlug[family] ?? familyFallbackSlug[family];
    if (target && target !== aliasSlug) aliases[aliasSlug] = target;
  }
  return Object.keys(aliases).length > 0 ? { standard, flex, aliases } : { standard, flex };
}

export function isPerfMetricsDoc(x: unknown): x is PerfMetricsDoc {
  if (!x || typeof x !== "object") return false;
  const obj = x as Record<string, unknown>;
  return typeof obj.standard === "object" && obj.standard !== null && typeof obj.flex === "object" && obj.flex !== null;
}
