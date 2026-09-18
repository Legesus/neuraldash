/**
 * Flex catalog persistence (flex-catalog-cache.json), schema v2.
 * vscode-free: the storage contract is structural (mirror of RegistryStorage).
 * One logical catalog, one file, one write path; per-document slots are
 * updated independently by the controller. Stores the PARSED documents only
 * (~23 KB v1 JSON + typed perf lanes + typed pricing cards) — raw HTML is
 * never persisted, and FlexEntry[] is derived per render (derivation needs
 * live board slugs + registry enrichment). Change detection is a SHA-256
 * content hash; the v1 API/portal send no usable validators.
 */
import type { NeuralwattModelsDoc } from "./flexCatalog";
import type { FlexPerfDoc } from "./flexPerf";
import type { FlexCardsDoc } from "./flexCatalogCards";

export const FLEX_CATALOG_CACHE_VERSION = 2;

/** Minimal storage contract so core stays vscode-free. */
export interface FlexCatalogStorage {
  read(): Promise<FlexCatalogCacheData | null>;
  write(data: FlexCatalogCacheData): Promise<void>;
}

export interface CachedFlexDoc<T> {
  doc: T | null;
  contentHash: string | null;
  lastSuccessAt: string | null;
}

export interface FlexCatalogCacheData {
  version: number;
  v1: CachedFlexDoc<NeuralwattModelsDoc>;
  perf: CachedFlexDoc<FlexPerfDoc>;
  /** Additive slot (schema v2 unchanged): absent in older v2 files -> empty on load. */
  cards: CachedFlexDoc<FlexCardsDoc>;
  lastCheckedAt: string | null;
}

export function emptyCachedFlexDoc<T>(): CachedFlexDoc<T> {
  return { doc: null, contentHash: null, lastSuccessAt: null };
}

export function emptyFlexCatalogCache(): FlexCatalogCacheData {
  return {
    version: FLEX_CATALOG_CACHE_VERSION,
    v1: emptyCachedFlexDoc(),
    perf: emptyCachedFlexDoc(),
    cards: emptyCachedFlexDoc(),
    lastCheckedAt: null,
  };
}

function normalizeSlot<T>(slot: unknown, valid: (doc: unknown) => boolean): CachedFlexDoc<T> {
  if (!slot || typeof slot !== "object") return emptyCachedFlexDoc<T>();
  const s = slot as { doc?: unknown; contentHash?: unknown; lastSuccessAt?: unknown };
  const doc = valid(s.doc) ? (s.doc as T) : null;
  // A hash never outlives its doc: without a baseline document the hash could
  // suppress the very fetch that repopulates it (stale-hash trap).
  return {
    doc,
    contentHash: doc !== null && typeof s.contentHash === "string" && s.contentHash !== "" ? s.contentHash : null,
    lastSuccessAt: doc !== null && typeof s.lastSuccessAt === "string" ? s.lastSuccessAt : null,
  };
}

function isModelsDocShape(doc: unknown): boolean {
  return !!doc && typeof doc === "object" && Array.isArray((doc as { data?: unknown }).data);
}

function isPerfDocShape(doc: unknown): boolean {
  return !!doc && typeof doc === "object" && Array.isArray((doc as { lanes?: unknown }).lanes);
}

function isCardsDocShape(doc: unknown): boolean {
  return !!doc && typeof doc === "object" && Array.isArray((doc as { cards?: unknown }).cards);
}

export class FlexCatalogCacheManager {
  constructor(private readonly storage: FlexCatalogStorage) {}

  /**
   * Version-guarded load; corrupt/wrong-version/empty -> emptyFlexCatalogCache().
   * An old (v1) cache is rejected wholesale -> one refetch cycle repopulates
   * the slots (sanctioned graceful migration). An old v2 file without the
   * additive cards slot loads fine: the slot materializes empty and the next
   * refresh cycle fetches it — no version bump, no invalidation of v1/perf.
   */
  async load(): Promise<FlexCatalogCacheData> {
    try {
      const data = await this.storage.read();
      if (!data || data.version !== FLEX_CATALOG_CACHE_VERSION) return emptyFlexCatalogCache();
      return {
        version: FLEX_CATALOG_CACHE_VERSION,
        v1: normalizeSlot(data.v1, isModelsDocShape),
        perf: normalizeSlot(data.perf, isPerfDocShape),
        cards: normalizeSlot((data as { cards?: unknown }).cards, isCardsDocShape),
        lastCheckedAt: typeof data.lastCheckedAt === "string" ? data.lastCheckedAt : null,
      };
    } catch {
      return emptyFlexCatalogCache();
    }
  }

  /** Persist a successfully fetched+parsed v1 doc (content hash verbatim). */
  async saveV1(doc: NeuralwattModelsDoc, contentHash: string | null): Promise<FlexCatalogCacheData> {
    const current = await this.load();
    const now = new Date().toISOString();
    const next: FlexCatalogCacheData = {
      ...current,
      version: FLEX_CATALOG_CACHE_VERSION,
      v1: { doc, contentHash, lastSuccessAt: now },
      lastCheckedAt: now,
    };
    await this.storage.write(next);
    return next;
  }

  /** Persist a successfully fetched+parsed perf doc (content hash verbatim). */
  async savePerf(doc: FlexPerfDoc, contentHash: string | null): Promise<FlexCatalogCacheData> {
    const current = await this.load();
    const now = new Date().toISOString();
    const next: FlexCatalogCacheData = {
      ...current,
      version: FLEX_CATALOG_CACHE_VERSION,
      perf: { doc, contentHash, lastSuccessAt: now },
      lastCheckedAt: now,
    };
    await this.storage.write(next);
    return next;
  }

  /** Persist a successfully fetched+parsed /models cards doc (content hash verbatim). */
  async saveCards(doc: FlexCardsDoc, contentHash: string | null): Promise<FlexCatalogCacheData> {
    const current = await this.load();
    const now = new Date().toISOString();
    const next: FlexCatalogCacheData = {
      ...current,
      version: FLEX_CATALOG_CACHE_VERSION,
      cards: { doc, contentHash, lastSuccessAt: now },
      lastCheckedAt: now,
    };
    await this.storage.write(next);
    return next;
  }

  /** Both documents content-unchanged: touch lastCheckedAt only. */
  async touchChecked(): Promise<FlexCatalogCacheData> {
    const current = await this.load();
    const next: FlexCatalogCacheData = {
      ...current,
      version: FLEX_CATALOG_CACHE_VERSION,
      lastCheckedAt: new Date().toISOString(),
    };
    await this.storage.write(next);
    return next;
  }
}
