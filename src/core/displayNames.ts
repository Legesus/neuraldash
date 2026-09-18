/**
 * Board display-name enrichment.
 *
 * The board page currently serves raw model ids in the name cell's title
 * attribute, so parsed board quotes arrive with the id in BOTH displayName
 * and slug. This module re-attaches the publisher's proper display name by
 * joining the THREE documents the flex pipeline already fetches — no new
 * fetches, no curated name table, no casing heuristics:
 *
 *   rung 1 — /v1/models entries: exact entry id -> metadata display_name;
 *   rung 2 — models registry: exact RECORD KEY -> model name;
 *   rung 3 — /models family cards: every listed card id -> card data-name
 *            (falling back to the card family for docs parsed before the
 *            parser captured data-name).
 *
 * First writer wins, so rung 1 outranks rung 2 outranks rung 3. All joins are
 * exact-key on the sources' native keys; this module adds no normalization.
 * Ids with no name in any rung get no entry and callers keep the scraped title.
 *
 * Pure, vscode-free. Zero model literals by construction: every string below
 * flows from the caller-supplied documents.
 */
import type { NeuralwattModelsDoc } from "./flexCatalog";
import type { ModelsRegistry } from "./flex";
import type { FlexCardsDoc } from "./flexCatalogCards";
import type { ValuedQuote } from "./types";

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

/** Non-empty trimmed string, or null. Cached docs are re-read JSON — never trusted. */
function cleanName(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const t = x.trim();
  return t === "" ? null : t;
}

/** First-writer-wins insert: blank keys and blank names never create an entry. */
function setIfAbsent(out: Map<string, string>, key: unknown, name: unknown): void {
  if (typeof key !== "string" || key === "") return;
  if (out.has(key)) return;
  const clean = cleanName(name);
  if (clean == null) return;
  out.set(key, clean);
}

/**
 * Join the three already-fetched documents into id -> display-name.
 * Corrupt/partial inputs degrade to an empty map or a graceful subset —
 * never a throw (same keep-last-known posture as the flex parsers).
 */
export function buildDisplayNameMap(
  v1: NeuralwattModelsDoc | null,
  registry: ModelsRegistry | null,
  cards: FlexCardsDoc | null,
): ReadonlyMap<string, string> {
  const out = new Map<string, string>();

  // Rung 1: exact entry id -> metadata display_name.
  const v1Data = (v1 as { data?: unknown } | null)?.data;
  if (Array.isArray(v1Data)) {
    for (const entry of v1Data) {
      if (!isRecord(entry)) continue;
      const meta = isRecord(entry["metadata"]) ? (entry["metadata"] as Record<string, unknown>) : null;
      setIfAbsent(out, entry["id"], meta?.["display_name"]);
    }
  }

  // Rung 2: exact registry RECORD KEY -> model name.
  const regModels = (registry as { models?: unknown } | null)?.models;
  if (isRecord(regModels)) {
    for (const [key, model] of Object.entries(regModels)) {
      if (!isRecord(model)) continue;
      setIfAbsent(out, key, model["name"]);
    }
  }

  // Rung 3: every listed card id -> card data-name (family fallback).
  const cardList = (cards as { cards?: unknown } | null)?.cards;
  if (Array.isArray(cardList)) {
    for (const card of cardList) {
      if (!isRecord(card)) continue;
      const ids = card["ids"];
      if (!Array.isArray(ids)) continue;
      const label = cleanName(card["name"]) ?? cleanName(card["family"]);
      if (label == null) continue;
      for (const id of ids) setIfAbsent(out, id, label);
    }
  }

  return out;
}

/**
 * Override displayName on the rows the map covers, NON-mutating: rows with
 * no entry pass through by reference; overridden rows are shallow clones
 * ({...v, quote: {...v.quote, displayName}}) so cached snapshots are never
 * touched. quote.slug is identical on every row.
 */
export function applyDisplayNames(
  valued: readonly ValuedQuote[],
  names: ReadonlyMap<string, string>,
): ValuedQuote[] {
  return valued.map((v) => {
    const name = names.get(v.quote.slug);
    if (name === undefined) return v;
    return { ...v, quote: { ...v.quote, displayName: name } };
  });
}
