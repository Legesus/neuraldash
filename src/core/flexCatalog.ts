/**
 * Flex catalog — flex-tier membership, family grouping, preview status and
 * pricing provenance enumerated entirely from THREE fetched documents:
 *   - https://api.neuralwatt.com/v1/models (JSON: exact alias pricing,
 *     standard base pricing and published flex multipliers);
 *   - https://portal.neuralwatt.com/energy-pricing?view=performance (HTML:
 *     flex-lane membership, document families; parsed by flexPerf.ts);
 *   - https://portal.neuralwatt.com/models (HTML: family-card standard
 *     prices; parsed by flexCatalogCards.ts — a PRICING-ONLY fallback that
 *     never contributes membership and never supplies multipliers).
 * Pure, vscode-free. ZERO curated model lists and ZERO default multipliers:
 * every value below is read from a fetched document or absent (TBD + reason).
 *
 * Split mirrors the shipped pipelines: raw input -> typed doc via
 * parseNeuralwattModels (null on malformed -> caller keeps last-known), then
 * per-render derivation via buildFlexCatalog (docs + registry enrichment +
 * live board slugs). models.dev stays the metadata/pricing ENRICHMENT source;
 * it is never the membership source (stale registry-alias regression).
 */
import type { ModelsRegistry, RegistryModel } from "./flex";
import type { FlexPerfDoc, FlexPerfLane } from "./flexPerf";
import { flexCardById } from "./flexCatalogCards";
import type { FlexCardsDoc } from "./flexCatalogCards";

export type PricingProvenance = "v1-alias" | "models-dev" | "v1-derived" | "portal-card" | "tbd";

/** Which fetched document(s) establish a row's membership. */
export type MembershipProvenance = "v1-alias" | "perf-lane" | "both";

/** Ladder rung that supplied the multiplier (null = none available). */
export type MultiplierOrigin = "alias-own" | "family-sibling" | "doc-harvest" | null;

/** Reference to one fetched document (for Source lines / diagnostics). */
export interface DocRef {
  readonly url: string;
  readonly fetchedAt: string | null;
}

export interface FlexSources {
  readonly v1: DocRef | null;
  readonly perf: DocRef | null;
  readonly cards: DocRef | null;
}

export interface FlexEntry {
  /** /v1/models flex id, or synthetic "<laneSlug>-flex" (lane-only rows). */
  readonly slug: string;
  readonly baseSlug: string;
  /** API display_name > registry name > id. */
  readonly name: string;
  /** metadata.provider > owned_by > "neuralwatt". */
  readonly provider: string;
  /** perf-view document family > registry family > null. */
  readonly family: string | null;
  readonly context: number | null;
  readonly inputPerMillion: number | null;
  readonly outputPerMillion: number | null;
  readonly cacheReadPerMillion: number | null;
  readonly provenance: PricingProvenance;
  readonly membership: MembershipProvenance;
  /**
   * Flex discount multiplier READ from the v1 document (never a literal), when
   * one is resolvable. Priced alias rows carry it for display only — alias
   * prices are already discounted and are NEVER multiplied again.
   */
  readonly flexMultiplier?: number | null;
  readonly multiplierOrigin?: MultiplierOrigin;
  readonly preview: boolean;
  /** Why a "tbd" row has no published price (null when priced). */
  readonly tbdReason?: string | null;
  readonly description: string | null;
  readonly lastUpdated: string | null;
}

export interface NeuralwattModelEntry {
  readonly id: string;
  readonly owned_by?: string;
  readonly max_model_len?: number;
  readonly metadata?: {
    display_name?: string;
    description?: string;
    provider?: string;
    pricing?: {
      input_per_million?: number;
      output_per_million?: number;
      cached_input_per_million?: number;
      pricing_tbd?: boolean;
      service_tier?: string;
      flex_discount_multiplier?: number | null;
    };
  };
}

export interface NeuralwattModelsDoc {
  readonly data: readonly NeuralwattModelEntry[];
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function finiteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function finiteOrNull(x: unknown): number | null {
  return finiteNumber(x) ? x : null;
}

function stringOrNull(x: unknown): string | null {
  return typeof x === "string" && x !== "" ? x : null;
}

/**
 * Parsed /v1/models body -> typed doc, or null when malformed (non-object,
 * missing/non-array `data`, or a non-record entry). Callers treat null as
 * "keep last-known, persist nothing".
 */
export function parseNeuralwattModels(raw: unknown): NeuralwattModelsDoc | null {
  if (!isRecord(raw)) return null;
  const data = raw["data"];
  if (!Array.isArray(data)) return null;
  for (const entry of data) {
    if (!isRecord(entry)) return null;
  }
  return { data: data as readonly NeuralwattModelEntry[] };
}

/** Runtime-defensive reads: the doc is network input, never trusted. */
function entryId(e: NeuralwattModelEntry): string | null {
  return stringOrNull((e as { id?: unknown }).id);
}

function entryMeta(e: NeuralwattModelEntry): Record<string, unknown> | null {
  const md = (e as { metadata?: unknown }).metadata;
  return isRecord(md) ? md : null;
}

function entryPricing(e: NeuralwattModelEntry): Record<string, unknown> | null {
  const md = entryMeta(e);
  if (!md) return null;
  const p = md["pricing"];
  return isRecord(p) ? p : null;
}

interface RawPricing {
  input: number | null;
  output: number | null;
  cached: number | null;
  serviceTier: string | null;
  multiplier: number | null;
  displayName: string | null;
  provider: string | null;
  description: string | null;
  maxModelLen: number | null;
}

function readEntry(e: NeuralwattModelEntry): RawPricing {
  const p = entryPricing(e);
  const md = entryMeta(e);
  return {
    input: finiteOrNull(p?.["input_per_million"]),
    output: finiteOrNull(p?.["output_per_million"]),
    cached: finiteOrNull(p?.["cached_input_per_million"]),
    serviceTier: stringOrNull(p?.["service_tier"]),
    multiplier: finiteOrNull(p?.["flex_discount_multiplier"]),
    displayName: stringOrNull(md?.["display_name"]),
    provider: stringOrNull(md?.["provider"]),
    description: stringOrNull(md?.["description"]),
    maxModelLen: finiteOrNull((e as { max_model_len?: unknown }).max_model_len),
  };
}

/** Alias-id naming convention of the v1 document (never a curated list). */
function stripFlexSuffix(id: string): string {
  return id.endsWith("-flex") ? id.slice(0, -"-flex".length) : id;
}

/**
 * Kill binary float noise on derived products (a standard price times a sub-1
 * factor can land on a ...0002 tail) so derived prices compare/sort/render
 * exactly like the API's own values: prices are USD/1M and the widest
 * published precision is 5 decimals.
 */
function roundPrice(x: number): number {
  return Number(x.toFixed(6));
}

function registryHit(registry: ModelsRegistry | null, key: string): RegistryModel | null {
  return registry?.models?.[key] ?? null;
}

interface EntryCore {
  readonly slug: string;
  readonly baseSlug: string;
  readonly name: string;
  readonly provider: string;
  readonly family: string | null;
  readonly context: number | null;
  readonly description: string | null;
  readonly lastUpdated: string | null;
}

/**
 * Enrichment chain: API fields win, registry.models[slug] then
 * registry.models[baseSlug] fill the rest, then the /models card's data-name
 * (covers ids absent from BOTH catalogs, e.g. preview-only models). The
 * perf-view document family (when the member has a lane) beats the registry
 * family.
 */
function buildEntryCore(
  slug: string,
  baseSlug: string,
  api: NeuralwattModelEntry | null,
  registry: ModelsRegistry | null,
  fallbackId: string,
  perfFamily: string | null,
  cardName: string | null,
): EntryCore {
  const raw = api ? readEntry(api) : null;
  const regExact = registryHit(registry, slug);
  const regBase = registryHit(registry, baseSlug);
  // Exact aliases carry Neuralwatt's own "(flex)" display_name; every other
  // member (derived lanes, TBD previews) gets the marker appended so the label
  // itself shows flex membership.
  const baseName =
    raw?.displayName ?? stringOrNull(regExact?.name) ?? stringOrNull(regBase?.name) ?? stringOrNull(cardName) ?? fallbackId;
  const name = /\(flex\)/i.test(baseName) ? baseName : `${baseName} (flex)`;
  return {
    slug,
    baseSlug,
    name,
    provider: raw?.provider ?? (api ? stringOrNull((api as { owned_by?: unknown }).owned_by) : null) ?? "neuralwatt",
    family: stringOrNull(perfFamily) ?? stringOrNull(regExact?.family) ?? stringOrNull(regBase?.family) ?? null,
    context: raw?.maxModelLen ?? finiteOrNull(regExact?.context) ?? finiteOrNull(regBase?.context) ?? null,
    description: raw?.description ?? stringOrNull(regExact?.description) ?? stringOrNull(regBase?.description) ?? null,
    lastUpdated: stringOrNull(regExact?.last_updated) ?? stringOrNull(regBase?.last_updated) ?? null,
  };
}

/**
 * Doc-wide multiplier harvest: the distinct finite flex_discount_multiplier
 * values published by EVERY flex entry of the v1 document. A single distinct
 * value is unambiguous; zero or multiple values are not.
 */
export function harvestDocMultiplier(doc: NeuralwattModelsDoc | null): { distinct: number[]; value: number | null } {
  const rawData: unknown = doc ? (doc as { data?: unknown }).data : null;
  const data = Array.isArray(rawData) ? rawData.filter((e): e is NeuralwattModelEntry => isRecord(e)) : [];
  const distinct = new Set<number>();
  for (const e of data) {
    const id = entryId(e);
    if (!id) continue;
    const raw = readEntry(e);
    if (raw.serviceTier !== "flex" && !id.endsWith("-flex")) continue;
    if (raw.multiplier != null) distinct.add(raw.multiplier);
  }
  const values = [...distinct].sort((a, b) => a - b);
  return { distinct: values, value: values.length === 1 ? values[0]! : null };
}

interface MultiplierInfo {
  readonly value: number | null;
  readonly origin: MultiplierOrigin;
  readonly reason: string | null;
}

function distinctValues(values: readonly (number | null)[]): number[] {
  const out = new Set<number>();
  for (const v of values) if (v != null) out.add(v);
  return [...out].sort((a, b) => a - b);
}

/**
 * Multiplier ladder (document data only, no literals). Each rung yields a
 * value ONLY when unambiguous; otherwise the ladder falls through:
 *   1. alias-own      — the member's own v1 flex alias publishes one;
 *   2. family-sibling — every v1 flex alias whose base slug shares the
 *                       member's perf-view document family publishes the same
 *                       value (no family / no published siblings -> skip);
 *   3. doc-harvest    — the whole v1 doc publishes exactly one distinct value;
 *   4. else UNAVAILABLE -> caller renders TBD with this reason.
 */
function resolveMultiplier(
  baseSlug: string,
  ownAlias: NeuralwattModelEntry | null,
  aliases: readonly AliasRef[],
  familyOf: (baseSlug: string) => string | null,
): MultiplierInfo {
  // Rung 1: alias-own.
  const own = ownAlias ? readEntry(ownAlias).multiplier : null;
  if (own != null) return { value: own, origin: "alias-own", reason: null };

  // Rung 2: family-sibling.
  const family = familyOf(baseSlug);
  if (family != null) {
    const siblingValues = distinctValues(
      aliases.filter((a) => familyOf(a.baseSlug) === family).map((a) => readEntry(a.entry).multiplier),
    );
    if (siblingValues.length === 1) return { value: siblingValues[0]!, origin: "family-sibling", reason: null };
  }

  // Rung 3: doc-harvest.
  const docValues = distinctValues(aliases.map((a) => readEntry(a.entry).multiplier));
  if (docValues.length === 1) return { value: docValues[0]!, origin: "doc-harvest", reason: null };
  if (docValues.length === 0) {
    return { value: null, origin: null, reason: "multiplier unavailable: document publishes no flex multiplier" };
  }
  return { value: null, origin: null, reason: "multiplier unavailable: document multipliers disagree" };
}

interface AliasRef {
  readonly slug: string;
  readonly baseSlug: string;
  readonly entry: NeuralwattModelEntry;
}

/** Per-row pricing provenance chain: v1-alias > models-dev > v1-derived > portal-card > tbd. */
function resolvePricing(
  alias: NeuralwattModelEntry | null,
  baseSlug: string,
  byId: ReadonlyMap<string, NeuralwattModelEntry>,
  registry: ModelsRegistry | null,
  slug: string,
  mult: MultiplierInfo,
  cardsDoc: FlexCardsDoc | null,
): Pick<FlexEntry, "inputPerMillion" | "outputPerMillion" | "cacheReadPerMillion" | "provenance" | "tbdReason"> {
  const raw = alias ? readEntry(alias) : null;

  // 1. Exact alias pricing — used VERBATIM. Alias prices are already
  //    discounted by the publisher; the multiplier is NEVER re-applied.
  if (raw && raw.input != null && raw.output != null) {
    return {
      inputPerMillion: raw.input,
      outputPerMillion: raw.output,
      cacheReadPerMillion: raw.cached,
      provenance: "v1-alias",
      tbdReason: null,
    };
  }

  // 2. models.dev alias — display-price fallback position (unchanged).
  const reg = registryHit(registry, slug);
  const regIn = finiteOrNull(reg?.cost?.input);
  const regOut = finiteOrNull(reg?.cost?.output);
  if (regIn != null && regOut != null) {
    return {
      inputPerMillion: regIn,
      outputPerMillion: regOut,
      cacheReadPerMillion: finiteOrNull(reg?.cost?.cache_read),
      provenance: "models-dev",
      tbdReason: null,
    };
  }

  // 3. v1 standard base x documented multiplier.
  const baseEntry = byId.get(baseSlug) ?? null;
  const baseRaw = baseEntry ? readEntry(baseEntry) : null;
  if (baseRaw && baseRaw.input != null && baseRaw.output != null) {
    if (mult.value != null) {
      return {
        inputPerMillion: roundPrice(baseRaw.input * mult.value),
        outputPerMillion: roundPrice(baseRaw.output * mult.value),
        cacheReadPerMillion: baseRaw.cached != null ? roundPrice(baseRaw.cached * mult.value) : null,
        provenance: "v1-derived",
        tbdReason: null,
      };
    }
    return {
      inputPerMillion: null,
      outputPerMillion: null,
      cacheReadPerMillion: null,
      provenance: "tbd",
      tbdReason: mult.reason ?? "multiplier unavailable",
    };
  }

  // 3b. portal /models family card x ladder multiplier. Reached ONLY when the
  //     base v1 std entry/prices are absent (rung 3's mult-null tbd returned
  //     above and is never overridden by a card). Cards join by id onto
  //     members the other documents already established; card input is exact
  //     (data-price), output/cached are footer display values.
  const card = flexCardById(cardsDoc, baseSlug);
  if (card) {
    const cardIn = finiteOrNull(card.inputPerMillion);
    const cardOut = finiteOrNull(card.outputPerMillion);
    if (cardIn != null && cardOut != null) {
      if (mult.value != null) {
        const cardCached = finiteOrNull(card.cachedInputPerMillion);
        return {
          inputPerMillion: roundPrice(cardIn * mult.value),
          outputPerMillion: roundPrice(cardOut * mult.value),
          cacheReadPerMillion: cardCached != null ? roundPrice(cardCached * mult.value) : null,
          provenance: "portal-card",
          tbdReason: null,
        };
      }
      // A card never supplies the multiplier: TBD stands.
      return {
        inputPerMillion: null,
        outputPerMillion: null,
        cacheReadPerMillion: null,
        provenance: "tbd",
        tbdReason: mult.reason ?? "multiplier unavailable",
      };
    }
  }

  // 4. TBD — no published price anywhere; report exactly what is missing
  //    (naming the portal card too when a cards document was consulted).
  const cardSuffix = cardsDoc != null ? " and no portal /models card prices it" : "";
  return {
    inputPerMillion: null,
    outputPerMillion: null,
    cacheReadPerMillion: null,
    provenance: "tbd",
    tbdReason: !baseEntry
      ? `base standard entry absent from /v1/models${cardSuffix}`
      : `base standard prices unavailable in /v1/models${cardSuffix}`,
  };
}

function sortFlexEntries(list: FlexEntry[]): void {
  list.sort((a, b) => {
    const ai = a.inputPerMillion ?? Infinity;
    const bi = b.inputPerMillion ?? Infinity;
    if (ai !== bi) return ai - bi;
    return a.slug.localeCompare(b.slug);
  });
}

/**
 * Derive flex rows per render — membership is the UNION of two fetched
 * documents, with each row's evidence recorded:
 *   - v1 document flex entries (service_tier "flex" or an id ending "-flex");
 *   - perf-view lanes carrying the flex service-tier marker (speed lanes
 *     publish the raw slug and are excluded; lane existence alone is not
 *     membership evidence).
 * The /models cards doc is a PRICING-ONLY fallback: it never enters the
 * membership sets and never supplies multipliers — its prices attach only to
 * base slugs that are already members.
 * Own-slug exclusion: an exact board row for the row's slug wins.
 * Sort: input price asc, TBD last, slug tie-break.
 */
export function buildFlexCatalog(
  doc: NeuralwattModelsDoc | null,
  perfDoc: FlexPerfDoc | null,
  cardsDoc: FlexCardsDoc | null,
  registry: ModelsRegistry | null,
  boardSlugs: ReadonlySet<string>,
): FlexEntry[] {
  // The docs normally come from parse* but the CACHED path re-reads a JSON
  // file: tolerate a shape-corrupt doc (wrong data type / junk entries) by
  // degrading to an empty catalog instead of throwing.
  const rawData: unknown = doc ? (doc as { data?: unknown }).data : null;
  const data = Array.isArray(rawData) ? rawData.filter((e): e is NeuralwattModelEntry => isRecord(e)) : [];

  const byId = new Map<string, NeuralwattModelEntry>();
  for (const e of data) {
    const id = entryId(e);
    if (id) byId.set(id, e);
  }

  // v1 flex aliases, keyed by base slug (first wins).
  const aliases = new Map<string, AliasRef>();
  for (const e of data) {
    const id = entryId(e);
    if (!id) continue;
    const raw = readEntry(e);
    if (raw.serviceTier !== "flex" && !id.endsWith("-flex")) continue;
    const baseSlug = stripFlexSuffix(id);
    if (!aliases.has(baseSlug)) aliases.set(baseSlug, { slug: id, baseSlug, entry: e });
  }

  // Perf-view FLEX lanes, keyed by lane slug (= base slug; first wins).
  const lanes = new Map<string, FlexPerfLane>();
  for (const lane of perfDoc?.lanes ?? []) {
    if (!lane || typeof lane.slug !== "string" || lane.slug === "") continue;
    if (!lane.flex) continue;
    if (!lanes.has(lane.slug)) lanes.set(lane.slug, lane);
  }

  const aliasList = [...aliases.values()];
  const familyOf = (baseSlug: string): string | null => lanes.get(baseSlug)?.family ?? null;

  const baseSlugs = new Set<string>([...aliases.keys(), ...lanes.keys()]);
  const out: FlexEntry[] = [];

  for (const baseSlug of baseSlugs) {
    const alias = aliases.get(baseSlug) ?? null;
    const lane = lanes.get(baseSlug) ?? null;
    const slug = alias ? alias.slug : `${baseSlug}-flex`;
    if (boardSlugs.has(slug)) continue; // own-slug exclusion (exact board row wins)
    const membership: MembershipProvenance = alias && lane ? "both" : alias ? "v1-alias" : "perf-lane";
    const cardName = flexCardById(cardsDoc, baseSlug)?.name ?? null;
    const core = buildEntryCore(slug, baseSlug, alias?.entry ?? null, registry, alias?.slug ?? baseSlug, lane?.family ?? null, cardName);
    const mult = resolveMultiplier(baseSlug, alias?.entry ?? null, aliasList, familyOf);
    const pricing = resolvePricing(alias?.entry ?? null, baseSlug, byId, registry, slug, mult, cardsDoc);
    out.push({
      ...core,
      ...pricing,
      membership,
      flexMultiplier: mult.value,
      multiplierOrigin: mult.origin,
      preview: lane?.preview ?? false,
    });
  }

  sortFlexEntries(out);
  return out;
}

/**
 * Row description: "<$X in · $Y out /1M tok>" with a provenance suffix;
 * null prices render "pricing TBD" (+ " · preview"). Derived rows label the
 * multiplier value actually harvested from the document (never a literal).
 * The portal-card suffix distinguishes the weaker precision guarantees
 * (footer display-rounded output) from a v1-derived row at a glance.
 */
export function formatFlexEntryDescription(entry: FlexEntry): string {
  if (entry.inputPerMillion == null || entry.outputPerMillion == null) {
    return entry.preview ? "pricing TBD \u00b7 preview" : "pricing TBD";
  }
  const base = `$${entry.inputPerMillion.toFixed(2)} in \u00b7 $${entry.outputPerMillion.toFixed(2)} out /1M tok`;
  switch (entry.provenance) {
    case "models-dev":
      return `${base} \u00b7 models.dev`;
    case "v1-derived":
      return entry.flexMultiplier != null ? `${base} \u00b7 ${entry.flexMultiplier}\u00d7 derived` : `${base} \u00b7 derived`;
    case "portal-card":
      return entry.flexMultiplier != null
        ? `${base} \u00b7 ${entry.flexMultiplier}\u00d7 derived (portal card)`
        : `${base} \u00b7 derived (portal card)`;
    default:
      return base;
  }
}
