import { parse, HTMLElement } from "node-html-parser";
import { BandEnergy, BandKey, BAND_KEYS, ModelQuote, Snapshot, ParseError, TrendInfo, Sparkline48h, SparklineDirection, SparklinePoint } from "./types";
import { toSlug } from "./registry";
import { normalizeMwh } from "./energy";

/*
 * Parser probes tables by thead content, not class hashes.
 * Table A: thead contains "48h trend" and "Right now"
 * Table B: thead contains "256k" (size grid)
 * Join on slug; every cell null-safe; 0 tables/0 rows -> ParseError.
 */

function cleanText(el: HTMLElement | null | undefined): string {
  if (!el) return "";
  return el.text.trim();
}

function findTables(root: HTMLElement): { board: HTMLElement | null; grid: HTMLElement | null } {
  const tables = root.querySelectorAll("table");
  let board: HTMLElement | null = null;
  let grid: HTMLElement | null = null;

  for (const t of tables) {
    const thead = t.querySelector("thead");
    let headerText = "";
    if (thead) {
      headerText = thead.text.toLowerCase();
    } else {
      // fallback: first row text
      const firstTr = t.querySelector("tr");
      if (firstTr) headerText = firstTr.text.toLowerCase();
    }

    const isBoard = headerText.includes("48h trend") || (headerText.includes("right now") && headerText.includes("7-day"));
    const isGrid = headerText.includes("256k") && headerText.includes("0") && headerText.includes("model");

    if (isBoard && !board) board = t;
    else if (isGrid && !grid) grid = t;
  }

  // Heuristic fallback: if probes failed but there are exactly 2 tables, assume order board then grid
  if (!board && !grid && tables.length === 2) {
    board = tables[0];
    grid = tables[1];
  }

  return { board, grid };
}

function parseTrend(ariaLabel: string | null | undefined): TrendInfo | null {
  if (!ariaLabel) return null;
  const m = ariaLabel.match(/(\d+)%\s*(in line|above|below)/i);
  if (!m) return null;
  const pct = parseInt(m[1], 10);
  const dirRaw = m[2].toLowerCase();
  let direction: TrendInfo["direction"];
  if (dirRaw.includes("in line")) direction = "inline";
  else if (dirRaw.includes("above")) direction = "above";
  else if (dirRaw.includes("below")) direction = "below";
  else return null;
  return { pct, direction };
}

function parseCachePct(tdText: string): number | null {
  const m = tdText.match(/(\d+)%\s*cache/i);
  return m ? parseInt(m[1], 10) : null;
}

function parseContextBand(tdTextSmall: string | null): string | null {
  if (!tdTextSmall) return null;
  const t = tdTextSmall.trim();
  if (!t) return null;
  // context band looks like "16k–64k" or "1k–4k" — just return first token before any span
  // The div.text-[10px] contains e.g. "16k–64k · 88% cache" — first part is the band
  // We normalize dashes
  const first = t.split("·")[0].trim().split(/\s+/)[0];
  if (!first) return null;
  // normalize en-dash/em-dash to hyphen for storage? Keep as-is but normalized
  return first.replace(/\u2013/g, "-").replace(/\u2014/g, "-");
}

function isPreviewCell(cell: HTMLElement): boolean {
  // Prefer the semantic title: anchor whose title contains "is in preview"
  const anchors = cell.querySelectorAll("a[title]");
  for (const a of anchors) {
    const t = a.getAttribute("title") ?? "";
    if (t.toLowerCase().includes("is in preview")) return true;
  }
  // Fallback: class hash probe
  return !!cell.querySelector("a[class*='bg-amber']") || cell.innerHTML.includes("bg-amber");
}

function extractSparkline(td: HTMLElement): Sparkline48h | null {
  const svg = td.querySelector("svg");
  if (!svg) return null;
  const polyline = svg.querySelector("polyline[points]");
  if (!polyline) return null;
  const rawPoints = polyline.getAttribute("points") ?? "";
  const points: SparklinePoint[] = [];
  for (const token of rawPoints.split(/\s+/)) {
    if (!token) continue; // trailing space in fixture yields an empty token
    const m = token.match(/^(-?[\d.]+),(-?[\d.]+)$/);
    if (!m) continue; // garbage tokens skipped
    const x = parseFloat(m[1]);
    const y = parseFloat(m[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push({ x, y });
  }
  if (points.length < 2) return null;

  let refY: number | null = null;
  const line = svg.querySelector("line");
  if (line) {
    const y1 = parseFloat(line.getAttribute("y1") ?? "");
    if (Number.isFinite(y1)) refY = y1;
  }

  const svgClass = svg.getAttribute("class") ?? "";
  let direction: SparklineDirection = "neutral";
  if (/\btext-emerald-500\b/.test(svgClass)) direction = "below";
  else if (/\btext-rose-500\b/.test(svgClass)) direction = "above";

  let maxMwh: number | null = null;
  let minMwh: number | null = null;
  const labelDiv = td.querySelector("div.flex.flex-col");
  if (labelDiv) {
    const spans = labelDiv.querySelectorAll("span");
    if (spans.length >= 2) {
      // Top span = max, bottom span = min; BOTH required else both stay null.
      maxMwh = normalizeMwh(cleanText(spans[0]));
      minMwh = normalizeMwh(cleanText(spans[1]));
    }
  }

  return { points, refY, direction, maxMwh, minMwh };
}

function extractBoardRows(board: HTMLElement): Map<string, Partial<ModelQuote>> {
  const tbody = board.querySelector("tbody");
  const container = tbody ?? board;
  let rows = container.querySelectorAll("tr");
  // If theadless fallback: first row was header, so drop it if we fell back via tr detection
  const thead = board.querySelector("thead");
  if (!thead && rows.length > 0) {
    // first row looked like header -> drop it
    const firstText = rows[0].text.toLowerCase();
    if (firstText.includes("model") && firstText.includes("right now")) {
      rows = rows.slice(1) as unknown as HTMLElement[];
    }
  } else if (thead) {
    // normal: tbody rows exclude thead; but query on tbody already excludes it.
    // If we queried board directly (no tbody), first row is header - but we used tbody so it's fine.
  }

  const map = new Map<string, Partial<ModelQuote>>();

  for (const row of rows) {
    const cells = row.querySelectorAll("td");
    if (cells.length < 2) continue;
    // name = td[0] div.font-medium[title] @title else text
    const firstCell = cells[0];
    const nameEl = firstCell.querySelector("div.font-medium[title]") ?? firstCell.querySelector("div[title]");
    let displayName = "";
    if (nameEl) {
      const titleAttr = nameEl.getAttribute("title");
      displayName = (titleAttr ?? cleanText(nameEl)).trim();
    } else {
      // fallback: first div text
      const fallback = firstCell.querySelector("div");
      displayName = cleanText(fallback ?? firstCell);
    }
    if (!displayName) continue;

    const isPreview = isPreviewCell(firstCell);

    // contextBand + cachePct
    // context band is in div.text-[10px].font-mono-data
    let contextBand: string | null = null;
    let cachePct: number | null = null;
    const smallDiv = firstCell.querySelector("div.text-\\[10px\\]") ?? firstCell.querySelector("div.font-mono-data");
    if (smallDiv) {
      contextBand = parseContextBand(cleanText(smallDiv));
      cachePct = parseCachePct(cleanText(smallDiv));
    } else {
      // fallback: parse from cell text directly
      const cellText = cleanText(firstCell);
      cachePct = parseCachePct(cellText);
      // try to find band pattern like "16k–64k"
      const bandM = cellText.match(/(\d+k?[–-]\d+k?)/);
      if (bandM) contextBand = bandM[1].replace(/\u2013/g, "-").replace(/\u2014/g, "-");
    }

    // rightNow = td[1] span.num  ; typical = td[2] span.num
    let rightNowMwh: number | null = null;
    let typicalMwh: number | null = null;
    if (cells.length >= 2) {
      const rnSpan = cells[1].querySelector("span.num") ?? cells[1].querySelector("span");
      const rnText = rnSpan ? cleanText(rnSpan) : cleanText(cells[1]);
      rightNowMwh = normalizeMwh(rnText);
    }
    if (cells.length >= 3) {
      const typSpan = cells[2].querySelector("span.num") ?? cells[2].querySelector("span");
      const typText = typSpan ? cleanText(typSpan) : cleanText(cells[2]);
      typicalMwh = normalizeMwh(typText);
    }

    // trend = td[3] div[role=img] @aria-label
    let trend: TrendInfo | null = null;
    if (cells.length >= 4) {
      const trendDiv = cells[3].querySelector("div[role='img']") ?? cells[3].querySelector("div[aria-label]") ?? cells[3].querySelector("[aria-label]");
      const aria = trendDiv?.getAttribute("aria-label") ?? null;
      trend = parseTrend(aria ?? undefined);
      if (!trend) {
        // fallback: parse from cell text if aria missing
        const tText = cleanText(cells[3]);
        const m = tText.match(/(\d+)%\s*(in line|above|below)/i);
        if (m) {
          const dirRaw = m[2].toLowerCase();
          const dir = dirRaw.includes("in line") ? "inline" : dirRaw.includes("above") ? "above" : "below";
          trend = { pct: parseInt(m[1], 10), direction: dir as TrendInfo["direction"] };
        }
      }
    }

    const slug = toSlug(displayName);

    let sparkline: Sparkline48h | null = null;
    if (cells.length >= 5) sparkline = extractSparkline(cells[4]);

    map.set(slug, {
      displayName,
      slug,
      isPreview,
      contextBand,
      cachePct,
      rightNowMwh,
      typicalMwh,
      trend,
      sparkline,
    });
  }

  return map;
}

function extractGridRows(grid: HTMLElement): Map<string, BandEnergy[]> {
  const tbody = grid.querySelector("tbody");
  const container = tbody ?? grid;
  let rows = container.querySelectorAll("tr");
  const thead = grid.querySelector("thead");
  if (!thead && rows.length > 0) {
    const firstText = rows[0].text.toLowerCase();
    if (firstText.includes("model") && firstText.includes("256k")) {
      rows = rows.slice(1) as unknown as HTMLElement[];
    }
  }

  const map = new Map<string, BandEnergy[]>();

  for (const row of rows) {
    const cells = row.querySelectorAll("td");
    if (cells.length < 1) continue;
    // name = cells[0] div.num text — but preview rows contain an <a>Preview</a> badge inside the same div.
    // Reading div.num.text yields "DeepSeek V4-ProPreview" -> wrong slug and failed join.
    // Strip badge anchors before reading, or take the first text node.
    const firstCell = cells[0];
    let displayName = "";
    const nameDiv = firstCell.querySelector("div.num");
    if (nameDiv) {
      // Preview rows: <div class="num">DeepSeek V4-Pro<a>Preview</a></div> -> div.num.text is "DeepSeek V4-ProPreview".
      // Strip the badge anchor text without relying on cloneNode (not in HTMLElement typings).
      const anchor = nameDiv.querySelector("a");
      let raw = cleanText(nameDiv);
      if (anchor) {
        const anchorText = cleanText(anchor);
        if (raw.endsWith(anchorText) && anchorText.length > 0) {
          raw = raw.slice(0, -anchorText.length).trim();
        } else {
          // fallback: regex strip trailing Preview (live badge is always "Preview")
          raw = raw.replace(/\s*Preview\s*$/, "").trim();
        }
      }
      displayName = raw;
    } else {
      const anchor = firstCell.querySelector("a");
      let raw = cleanText(firstCell);
      if (anchor) {
        const anchorText = cleanText(anchor);
        if (raw.endsWith(anchorText) && anchorText.length > 0) {
          raw = raw.slice(0, -anchorText.length).trim();
        } else {
          raw = raw.replace(/\s*Preview\s*$/, "").trim();
        }
      }
      displayName = raw;
    }
    if (!displayName) continue;
    const slug = toSlug(displayName);

    const bands: BandEnergy[] = [];
    // cells[1..7] correspond to BAND_KEYS
    for (let i = 0; i < BAND_KEYS.length; i++) {
      const idx = 1 + i;
      if (idx >= cells.length) {
        bands.push({ band: BAND_KEYS[i], mwh: null, sharePct: null });
        continue;
      }
      const cell = cells[idx];
      // Check for gathering / mdash null
      const cellHtml = cell.innerHTML;
      const cellText = cleanText(cell);
      const isGathering = cellHtml.includes("Gathering data") || cellText.includes("—") && !cellText.match(/mWh|Wh|kWh/i);
      // Actually mdash entity decoded to — ; check if mwh absent
      let mwh: number | null = null;
      let sharePct: number | null = null;

      if (isGathering) {
        mwh = null;
      } else {
        const numDiv = cell.querySelector("div.num");
        const energyText = numDiv ? cleanText(numDiv) : cellText.split("\n")[0];
        // If text is just mdash
        if (energyText.trim() === "—" || energyText.trim() === "-" || energyText.trim() === "–" || energyText.trim() === "") {
          mwh = null;
        } else {
          mwh = normalizeMwh(energyText);
        }
      }

      // share = div.text-[10px].num text like "2.2% of reqs"
      const shareDiv = cell.querySelector("div.text-\\[10px\\]") ?? cell.querySelector("div.num + div");
      let shareText = shareDiv ? cleanText(shareDiv) : "";
      if (!shareText) {
        // fallback: second line after mwh
        const shareM = cellText.match(/([\d.]+)%\s*of reqs/i);
        if (shareM) shareText = shareM[0];
      }
      const shareM = shareText.match(/([\d.]+)%/);
      if (shareM) sharePct = parseFloat(shareM[1]);

      bands.push({ band: BAND_KEYS[i], mwh, sharePct });
    }
    map.set(slug, bands);
  }

  return map;
}

export function parseSnapshot(html: string, sourceUrl: string, fetchedAt?: string): Snapshot {
  const root = parse(html);

  const { board, grid } = findTables(root);
  if (!board || !grid) {
    throw new ParseError("Could not find required tables (board and grid)");
  }

  const boardMap = extractBoardRows(board);
  const gridMap = extractGridRows(grid);

  if (boardMap.size === 0) {
    throw new ParseError("No model rows found in board table");
  }

  const quotes: ModelQuote[] = [];
  const at = fetchedAt ?? new Date().toISOString();

  for (const [slug, partial] of boardMap) {
    const bands = gridMap.get(slug) ?? BAND_KEYS.map((b) => ({ band: b, mwh: null, sharePct: null }));
    const quote: ModelQuote = {
      displayName: partial.displayName!,
      slug,
      isPreview: partial.isPreview ?? false,
      contextBand: partial.contextBand ?? null,
      cachePct: partial.cachePct ?? null,
      rightNowMwh: partial.rightNowMwh ?? null,
      typicalMwh: partial.typicalMwh ?? null,
      trend: partial.trend ?? null,
      sparkline: partial.sparkline ?? null,
      bands,
      capturedAt: at,
    };
    quotes.push(quote);
  }

  // Include any grid-only models that had no board row (shouldn't happen, but join safety)
  // Per spec: join on slug, board is authoritative; we don't add extras silently.

  quotes.sort((a, b) => a.displayName.localeCompare(b.displayName));

  return {
    quotes,
    fetchedAt: at,
    sourceUrl,
  };
}
