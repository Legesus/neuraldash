/**
 * Parser for the Neuralwatt portal /models CATALOG page
 * (https://portal.neuralwatt.com/models).
 *
 * The page renders one family card per model family as an
 * `<article data-family ...>` element carrying machine-readable data
 * attributes — the portal's own client JS reads exactly
 * `querySelectorAll('[data-family]')` and `el.dataset.price`, which is the
 * contract this parser follows. Cards publish STANDARD prices only:
 *   - data-price is USD per 1K INPUT tokens (exact; per-million = * 1000);
 *   - the pricing footer's spans/title carry the display-rounded output and
 *     cached-input values ("Output: $Y/M", "Cached input: $X/M tokens ...").
 *
 * The doc is a PRICING fallback and nothing else: cards NEVER establish flex
 * membership and NEVER supply multipliers — callers join card prices onto ids
 * that are already members via other documents.
 *
 * Robustness notes:
 *  - Attributes wrap across lines AND every card carries the live markup
 *    defect `data-price="0.00014"data-energy="..."` (missing space between
 *    attributes). A DOM parser (node-html-parser) is REQUIRED: regex over the
 *    raw HTML would misparse the attribute join.
 *  - Model ids come ONLY from `a[data-model-id]` elements (variant rows plus
 *    primary/details links, deduped). Enroll hrefs drop punctuation from
 *    preview slugs and are never used as identity.
 */
import { parse, HTMLElement } from "node-html-parser";

export interface FlexCard {
  /** Union of a[data-model-id] within the card, deduped, order-preserving. */
  readonly ids: readonly string[];
  /** data-family (the card's document family grouping). */
  readonly family: string | null;
  /**
   * data-name (the card's per-model display label). DIFFERS from family on
   * the cards where it matters — family can carry the publisher's grouping
   * label while name carries the proper model label, and one card's family
   * is the raw id while its name is the proper label. Optional so cached
   * docs parsed by the old parser keep loading unchanged.
   */
  readonly name?: string | null;
  /** data-price * 1000 — exact input USD per 1M tokens. */
  readonly inputPerMillion: number | null;
  /** Footer "Output: $X/M" span — 2dp display-rounded. */
  readonly outputPerMillion: number | null;
  /** Footer title "Cached input: $X/M ..." — 2dp display-rounded, nullable. */
  readonly cachedInputPerMillion: number | null;
}

export interface FlexCardsDoc {
  readonly cards: readonly FlexCard[];
}

function cleanAttr(card: HTMLElement, name: string): string | null {
  const v = (card.getAttribute(name) ?? "").trim();
  return v === "" ? null : v;
}

/**
 * Kill binary float noise on the per-1K -> per-million conversion so card
 * prices compare/sort/render exactly like the /v1/models values (widest
 * published precision is 5 decimals). Local copy on purpose: importing the
 * catalog's helper would create a runtime import cycle (the catalog imports
 * this module's types).
 */
function normalizePrice(x: number): number {
  return Number(x.toFixed(6));
}

/** data-price is USD per 1K input tokens; per-million = * 1000 (exact). */
function priceAttrPerMillion(card: HTMLElement): number | null {
  const raw = cleanAttr(card, "data-price");
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return normalizePrice(n * 1000);
}

/** The pricing footer's output span; the stats-tile label is bare ("Output", no colon/$), so this is unique in the card. */
const OUTPUT_SPAN = /^Output:\s*\$([0-9]+(?:\.[0-9]+)?)\/M$/;

function outputSpanPerMillion(card: HTMLElement): number | null {
  for (const span of card.querySelectorAll("span")) {
    const m = span.text.trim().match(OUTPUT_SPAN);
    if (m) {
      const n = Number(m[1]);
      return Number.isFinite(n) && n >= 0 ? n : null;
    }
  }
  return null;
}

/** Cached-input title prefix — display-rounded, and nullable on the live page. */
const CACHED_TITLE = /^Cached input:\s*\$([0-9]+(?:\.[0-9]+)?)\/M/;

function cachedTitlePerMillion(card: HTMLElement): number | null {
  for (const el of card.querySelectorAll("[title]")) {
    const m = (el.getAttribute("title") ?? "").trim().match(CACHED_TITLE);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  }
  return null;
}

/** Union of a[data-model-id] in the card, deduped, order-preserving. */
function cardIds(card: HTMLElement): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const a of card.querySelectorAll("a[data-model-id]")) {
    const id = (a.getAttribute("data-model-id") ?? "").trim();
    if (id === "" || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * HTML -> typed doc, or null when the page has no valid pricing cards
 * (malformed/changed portal). Callers treat null as keep-last-known.
 * Card-level defects skip THAT card only; the rest of the doc survives.
 */
export function parseFlexCatalogCards(html: string): FlexCardsDoc | null {
  if (typeof html !== "string" || html.trim() === "") return null;
  let root: HTMLElement;
  try {
    root = parse(html);
  } catch {
    return null;
  }

  const cards: FlexCard[] = [];
  for (const el of root.querySelectorAll("article[data-family]")) {
    const input = priceAttrPerMillion(el);
    const output = outputSpanPerMillion(el);
    const ids = cardIds(el);
    // A card without joinable ids or without BOTH published prices cannot
    // price anything — skip the card, keep the doc.
    if (ids.length === 0 || input == null || output == null) continue;
    cards.push({
      ids,
      family: cleanAttr(el, "data-family"),
      name: cleanAttr(el, "data-name"),
      inputPerMillion: input,
      outputPerMillion: output,
      cachedInputPerMillion: cachedTitlePerMillion(el),
    });
  }
  if (cards.length === 0) return null;
  return { cards };
}

/** Card holding this id (ids are the join keys), or null. First match wins. */
export function flexCardById(doc: FlexCardsDoc | null, id: string): FlexCard | null {
  // Runtime-defensive: the doc may come from a re-read cache file, never trusted.
  if (!doc || !Array.isArray(doc.cards)) return null;
  for (const card of doc.cards) {
    if (!card || !Array.isArray(card.ids)) continue;
    if (card.ids.includes(id)) return card;
  }
  return null;
}
