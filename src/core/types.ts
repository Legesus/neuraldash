export type BandKey =
  | "0-256"
  | "256-1k"
  | "1k-4k"
  | "4k-16k"
  | "16k-64k"
  | "64k-256k"
  | "256k-1M";

export interface BandEnergy {
  band: BandKey;
  mwh: number | null;
  sharePct: number | null;
}

export interface TrendInfo {
  pct: number;
  direction: "inline" | "above" | "below";
}

export type SparklineDirection = "below" | "above" | "neutral";

export interface SparklinePoint {
  x: number;
  y: number;
}

export interface Sparkline48h {
  /** Polyline points in source 100x30 viewBox coords, oldest→latest. */
  points: SparklinePoint[];
  /** Dotted reference line y1 in source coords, null when absent/unparseable. */
  refY: number | null;
  /** svg class semantics: emerald=below avg, rose=above, moss/colorless=neutral. */
  direction: SparklineDirection;
  /** Top label via normalizeMwh (max), null when labels absent. */
  maxMwh: number | null;
  /** Bottom label via normalizeMwh (min), null when labels absent. */
  minMwh: number | null;
}

export interface ModelQuote {
  displayName: string;
  slug: string;
  isPreview: boolean;
  contextBand: string | null;
  cachePct: number | null;
  rightNowMwh: number | null;
  typicalMwh: number | null;
  trend: TrendInfo | null;
  // Optional (not required) so pre-existing ModelQuote literals keep compiling;
  // old-cache JSON lacks the field entirely (undefined). Consumers truthy-check.
  sparkline?: Sparkline48h | null;
  bands: BandEnergy[];
  capturedAt: string;
}

export interface Snapshot {
  quotes: ModelQuote[];
  fetchedAt: string;
  sourceUrl: string;
}

export type ProviderStatus = "ok" | "blocked" | "error";

export interface ProviderResult {
  status: ProviderStatus;
  snapshot: Snapshot | null;
  detail?: string;
  notModified?: boolean;
  etag?: string | null;
}

export interface DataProvider {
  id: string;
  sourceUrl: string;
  fetchSnapshot(etag?: string | null): Promise<ProviderResult>;
}

export interface ScoreEntry {
  performanceScore: number;
  source: string;
  asOf: string;
}

export interface ScoreTable {
  version: number;
  scores: Record<string, ScoreEntry>;
}

export interface ValuedQuote {
  quote: ModelQuote;
  basisMwh: number | null;
  score: ScoreEntry | null;
  value: number | null;
  costPer1kUsd: number | null;
  descriptionMwh: number | null;
}

export interface CacheData {
  version: number;
  snapshot: Snapshot | null;
  etag: string | null;
  lastSuccessAt: string | null;
  lastCheckedAt: string | null;
}

export type SortOrder = "energy" | "value" | "name";

export type PreferredBand = "typical" | "auto" | BandKey;

export const BAND_KEYS: BandKey[] = [
  "0-256",
  "256-1k",
  "1k-4k",
  "4k-16k",
  "16k-64k",
  "64k-256k",
  "256k-1M",
];

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}
