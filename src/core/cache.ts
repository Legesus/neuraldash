import type { CacheData, Snapshot } from "./types";

export const CACHE_VERSION = 1;

/** Minimal storage contract so core stays vscode-free. */
export interface CacheStorage {
  read(): Promise<CacheData | null>;
  write(data: CacheData): Promise<void>;
}

export function emptyCache(): CacheData {
  return {
    version: CACHE_VERSION,
    snapshot: null,
    etag: null,
    lastSuccessAt: null,
    lastCheckedAt: null,
  };
}

export class CacheManager {
  constructor(private readonly storage: CacheStorage) {}

  async load(): Promise<CacheData> {
    try {
      const data = await this.storage.read();
      if (!data || data.version !== CACHE_VERSION) return emptyCache();
      return data;
    } catch {
      return emptyCache();
    }
  }

  async saveSnapshot(snapshot: Snapshot, etag: string | null): Promise<CacheData> {
    const now = new Date().toISOString();
    const data: CacheData = {
      version: CACHE_VERSION,
      snapshot,
      etag,
      lastSuccessAt: now,
      lastCheckedAt: now,
    };
    await this.storage.write(data);
    return data;
  }

  async markChecked(etag: string | null, snapshot: Snapshot | null): Promise<CacheData> {
    const current = await this.load();
    const next: CacheData = {
      ...current,
      version: CACHE_VERSION,
      etag: etag ?? current.etag,
      snapshot: snapshot ?? current.snapshot,
      lastCheckedAt: new Date().toISOString(),
    };
    await this.storage.write(next);
    return next;
  }

  async saveNotModified(): Promise<CacheData> {
    const current = await this.load();
    const next: CacheData = {
      ...current,
      version: CACHE_VERSION,
      lastCheckedAt: new Date().toISOString(),
    };
    await this.storage.write(next);
    return next;
  }
}

/** VS Code-backed storage adapter shape (structural, not imported). */
export function createVsCodeStorage(
  globalStorageUriFsPath: string,
  fsImpl: { readFile(p: string, enc: string): Promise<string>; writeFile(p: string, data: string): Promise<void>; mkdir(p: string, opts: { recursive: boolean }): Promise<void> },
  fileName = "cache.json",
): CacheStorage {
  const path = globalStorageUriFsPath + "/" + fileName;
  return {
    async read(): Promise<CacheData | null> {
      try {
        const raw = await fsImpl.readFile(path, "utf8");
        const parsed = JSON.parse(raw) as CacheData;
        return parsed;
      } catch {
        return null;
      }
    },
    async write(data: CacheData): Promise<void> {
      const dir = globalStorageUriFsPath;
      try {
        await fsImpl.mkdir(dir, { recursive: true });
      } catch {
        // ignore
      }
      await fsImpl.writeFile(path, JSON.stringify(data, null, 2));
    },
  };
}
