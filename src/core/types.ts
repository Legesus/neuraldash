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

export interface ModelQuote {
  displayName: string;
  slug: string;
  isPreview: boolean;
  contextBand: string | null;
  cachePct: number | null;
  rightNowMwh: number | null;
  typicalMwh: number | null;
  trend: TrendInfo | null;
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
