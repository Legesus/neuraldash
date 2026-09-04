/**
 * Transformed-registry persistence (registry-cache.json).
 * vscode-free: the storage contract is structural (mirror of CacheStorage).
 * Stores the compact TRANSFORMED ModelsRegistry (tens of KB), never raw api.json.
 */
import type { ModelsRegistry } from "./flex";

export const REGISTRY_CACHE_VERSION = 1;

/** Minimal storage contract so core stays vscode-free. */
export interface RegistryStorage {
  read(): Promise<RegistryCacheData | null>;
  write(data: RegistryCacheData): Promise<void>;
}

export interface RegistryCacheData {
  version: number;
  registry: ModelsRegistry | null;
  etag: string | null;
  lastSuccessAt: string | null;
  lastCheckedAt: string | null;
}

export function emptyRegistryCache(): RegistryCacheData {
  return {
    version: REGISTRY_CACHE_VERSION,
    registry: null,
    etag: null,
    lastSuccessAt: null,
    lastCheckedAt: null,
  };
}

export class RegistryCacheManager {
  constructor(private readonly storage: RegistryStorage) {}

  /** Version-guarded load; corrupt/wrong-version/empty -> emptyRegistryCache(). */
  async load(): Promise<RegistryCacheData> {
    try {
      const data = await this.storage.read();
      if (!data || data.version !== REGISTRY_CACHE_VERSION) return emptyRegistryCache();
      return data;
    } catch {
      return emptyRegistryCache();
    }
  }

  /** Persist a successfully fetched+transformed registry (etag stored VERBATIM). */
  async saveRegistry(registry: ModelsRegistry, etag: string | null): Promise<RegistryCacheData> {
    const now = new Date().toISOString();
    const data: RegistryCacheData = {
      version: REGISTRY_CACHE_VERSION,
      registry,
      etag,
      lastSuccessAt: now,
      lastCheckedAt: now,
    };
    await this.storage.write(data);
    return data;
  }

  /** 304: keep registry + etag, touch lastCheckedAt only. */
  async saveNotModified(): Promise<RegistryCacheData> {
    const current = await this.load();
    const next: RegistryCacheData = {
      ...current,
      version: REGISTRY_CACHE_VERSION,
      lastCheckedAt: new Date().toISOString(),
    };
    await this.storage.write(next);
    return next;
  }
}
