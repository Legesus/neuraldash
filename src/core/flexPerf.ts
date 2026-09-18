/**
 * Parser for the Neuralwatt portal energy-pricing PERFORMANCE view
 * (https://portal.neuralwatt.com/energy-pricing?view=performance).
 *
 * Zero curated constants: flex-lane membership (the flex service-tier marker),
 * family grouping (data-family-row) and preview status (the amber chip) are
 * all read off the fetched document. The typed doc keeps ONLY identity and
 * classification fields — volatility (energy figures, metric states, dispatch
 * waits, trend data, raw-slug speed invocations) is dropped at parse time and
 * never persisted.
 *
 * Scope note: the page contains a SECOND model table ("Average energy per
 * request") that repeats the preview chips with NO lane/family data
 * attributes. Every probe is scoped to the metrics table(s) that own the lane
 * rows, so the second table cannot leak into membership or preview status.
 * (The board parser in parse.ts must NOT be repointed here: its table probes
 * match this page's metrics table.)
 */
import { parse, HTMLElement } from "node-html-parser";

export interface FlexPerfLane {
  /** data-perf-lane value — the BASE model slug served by this lane. */
  readonly slug: string;
  /** data-family-row value (document family grouping). */
  readonly family: string | null;
  /** Row carries the flex service-tier marker (not merely a lane row). */
  readonly flex: boolean;
  /** The model this row belongs to carries a preview chip on this page. */
  readonly preview: boolean;
}

export interface FlexPerfDoc {
  readonly lanes: readonly FlexPerfLane[];
}

function cleanAttr(row: HTMLElement, name: string): string | null {
  const v = (row.getAttribute(name) ?? "").trim();
  return v === "" ? null : v;
}

/**
 * Flex marker. Primary (semantic): the invocation cell states the served
 * service tier (`service_tier="flex"`; HTML entities decode before matching).
 * Speed lanes publish the raw slug there instead and carry no flex tag.
 * Fallback: the flex tier tag's explanatory title.
 */
function hasFlexMarker(row: HTMLElement): boolean {
  for (const inv of row.querySelectorAll("[data-perf-invocation]")) {
    const t = inv.text.replace(/\s+/g, "").toLowerCase();
    if (t.includes('service_tier="flex"')) return true;
  }
  for (const tagged of row.querySelectorAll("span[title]")) {
    const title = (tagged.getAttribute("title") ?? "").toLowerCase();
    if (title.includes("wait for spare capacity")) return true;
  }
  return false;
}

/** Preview chip probe — parse.ts isPreviewCell conventions, cell-scoped. */
function hasPreviewChip(row: HTMLElement): boolean {
  const cell = row.querySelector("td") ?? row;
  for (const a of cell.querySelectorAll("a[title]")) {
    if ((a.getAttribute("title") ?? "").toLowerCase().includes("is in preview")) return true;
  }
  return cell.innerHTML.includes("bg-amber") || cell.innerHTML.includes("rounded-full");
}

/**
 * Model slug of a metrics-table row: the lane attribute when present, else
 * the row's first-cell div title (Standard sibling rows identify the model
 * that way). Display names contain whitespace and are rejected — only slugs
 * are accepted.
 */
function rowModelSlug(row: HTMLElement): string | null {
  const lane = cleanAttr(row, "data-perf-lane");
  if (lane) return lane;
  const div = (row.querySelector("td") ?? row).querySelector("div[title]");
  const title = (div?.getAttribute("title") ?? "").trim();
  if (!title || /\s/.test(title)) return null;
  return title;
}

/**
 * HTML -> typed doc, or null when the page has no scoped lane rows
 * (malformed/changed portal). Callers treat null as keep-last-known.
 */
export function parseFlexPerfView(html: string): FlexPerfDoc | null {
  if (typeof html !== "string" || html.trim() === "") return null;
  let root: HTMLElement;
  try {
    root = parse(html);
  } catch {
    return null;
  }

  const laneRows = root.querySelectorAll("tr[data-perf-lane]");
  if (laneRows.length === 0) return null;

  // Scope every probe to the metrics table(s) that own lane rows; the second
  // "Average energy per request" table never contains a lane row.
  const tables = new Set<HTMLElement>();
  for (const row of laneRows) {
    const t = row.closest("table");
    tables.add(t ?? root);
  }

  const previewSlugs = new Set<string>();
  for (const table of tables) {
    for (const row of table.querySelectorAll("tr[data-perf-lane], tr[data-family-row]")) {
      const slug = rowModelSlug(row);
      if (slug && hasPreviewChip(row)) previewSlugs.add(slug);
    }
  }

  const lanes: FlexPerfLane[] = [];
  const seen = new Set<string>();
  for (const row of laneRows) {
    const slug = rowModelSlug(row);
    if (!slug || seen.has(slug)) continue; // dedupe: first wins
    seen.add(slug);
    lanes.push({
      slug,
      family: cleanAttr(row, "data-family-row"),
      flex: hasFlexMarker(row),
      preview: previewSlugs.has(slug),
    });
  }
  if (lanes.length === 0) return null;
  return { lanes };
}
