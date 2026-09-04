import * as vscode from "vscode";
import type { DataProvider, Snapshot, PreferredBand, SortOrder } from "./core/types";
import { CacheManager } from "./core/cache";
import { BoardTreeProvider } from "./ui/treeProvider";
import { StatusBarController } from "./ui/statusBar";
import { rankQuotes, bestValueSlug } from "./core/ranking";
import { mergedScores, resolveBundledScoresPath } from "./core/scores";
import { loadModelsRegistry, flexTiers, resolveBundledRegistryPath } from "./core/flex";
import type { RegistryModel } from "./core/flex";
import { transformModelsDevRegistry } from "./core/registryTransform";
import type { RegistryDataProvider } from "./providers/modelsDevProvider";
import { NEURALWATT_URL } from "./providers/neuralwattProvider";

export class Controller {
  private timer: NodeJS.Timeout | null = null;
  private backoffMin = 20;
  private pollMin = 20;
  private isFetching = false;
  private registryCache: import("./core/flex").ModelsRegistry | null = null;
  private registrySource = "";
  private registryFetching = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly provider: DataProvider,
    private readonly registryProvider: RegistryDataProvider,
    private readonly cache: CacheManager,
    private readonly tree: BoardTreeProvider,
    private readonly statusBar: StatusBarController,
    private readonly treeView: vscode.TreeView<vscode.TreeItem>,
    private readonly extensionRoot: string,
  ) {}

  async activate(): Promise<void> {
    this.pollMin = this.readPollInterval();

    // Load registry once (bundled fallback; live refresh follows per cycle)
    const registryPath = resolveBundledRegistryPath(this.extensionRoot);
    this.registryCache = loadModelsRegistry(registryPath);
    this.registrySource = this.registryCache ? `bundled registry (${this.registryCache.generatedAt})` : "";

    // stale-first render
    const cached = await this.cache.load();
    if (cached.snapshot) {
      this.render(cached.snapshot);
    } else {
      this.tree.setMessage("Loading board…");
      this.tree.refresh();
    }

    // immediate fetch
    void this.fetchAndRender();

    // schedule poll
    this.schedule(this.pollMin);

    // config watchers
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("neuraldash.pollIntervalMinutes")) {
          this.pollMin = this.readPollInterval();
          this.backoffMin = this.pollMin; // reset backoff
          this.schedule(this.pollMin);
        }
        if (
          e.affectsConfiguration("neuraldash.tariffPerKWh") ||
          e.affectsConfiguration("neuraldash.preferredBand") ||
          e.affectsConfiguration("neuraldash.scoresOverridePath") ||
          e.affectsConfiguration("neuraldash.colorScale") ||
          e.affectsConfiguration("neuraldash.showFlexTiers")
        ) {
          // re-render from cached snapshot
          void this.rerenderFromCache();
        }
        if (e.affectsConfiguration("neuraldash.myModel")) {
          void this.rerenderFromCache();
        }
      }),
    );
  }

  private readPollInterval(): number {
    const v = vscode.workspace.getConfiguration("neuraldash").get<number>("pollIntervalMinutes", 20);
    return Math.max(5, Math.floor(v));
  }

  private readTariff(): number {
    return vscode.workspace.getConfiguration("neuraldash").get<number>("tariffPerKWh", 10);
  }

  private readPreferredBand(): PreferredBand {
    return vscode.workspace.getConfiguration("neuraldash").get<PreferredBand>("preferredBand", "typical");
  }

  private async rerenderFromCache(): Promise<void> {
    const cached = await this.cache.load();
    if (cached.snapshot) this.render(cached.snapshot);
  }

  private render(snapshot: Snapshot): void {
    const tariff = this.readTariff();
    const preferred = this.readPreferredBand();
    const bundledPath = resolveBundledScoresPath(this.extensionRoot);
    const overridePath = vscode.workspace.getConfiguration("neuraldash").get<string>("scoresOverridePath", "");
    const table = mergedScores(bundledPath, overridePath);
    const valued = rankQuotes(snapshot.quotes, table, tariff, preferred);
    const best = bestValueSlug(valued);

    // Flex tiers per render: board slugs set
    const showFlex = vscode.workspace.getConfiguration("neuraldash").get<boolean>("showFlexTiers", true);
    const flexList: RegistryModel[] = showFlex
      ? flexTiers(this.registryCache, new Set(snapshot.quotes.map((q) => q.slug)))
      : [];

    this.tree.setData(snapshot, valued, best, tariff, flexList, this.registrySource);
    const myModel = vscode.workspace.getConfiguration("neuraldash").get<string>("myModel", "");
    this.statusBar.update(myModel, valued);
  }

  private schedule(minutes: number): void {
    if (this.timer) clearTimeout(this.timer);
    const ms = minutes * 60_000;
    this.timer = setTimeout(() => {
      void this.fetchAndRender();
    }, ms);
  }

  async manualRefresh(): Promise<void> {
    this.backoffMin = this.pollMin;
    await this.fetchAndRender();
  }

  private async fetchAndRender(): Promise<void> {
    if (this.isFetching) return;
    this.isFetching = true;
    try {
      // Registry refresh rides the board cycle but never blocks it.
      void this.refreshRegistry();
      const cached = await this.cache.load();
      const etag = cached.etag;
      const result = await this.provider.fetchSnapshot(etag);

      if (result.notModified) {
        // 304
        await this.cache.saveNotModified();
        const fresh = await this.cache.load();
        if (fresh.snapshot) this.render(fresh.snapshot);
        this.backoffMin = this.pollMin;
        this.tree.setMessage(null);
        this.treeView.message = undefined;
        this.schedule(this.pollMin);
        return;
      }

      if (result.status === "ok" && result.snapshot) {
        const etagOut = result.etag ?? null;
        const etagToSave = etagOut ?? etag ?? null;
        await this.cache.saveSnapshot(result.snapshot, etagToSave);
        this.render(result.snapshot);
        this.backoffMin = this.pollMin;
        this.tree.setMessage(null);
        this.treeView.message = undefined;
        this.schedule(this.pollMin);
        return;
      }

      // blocked / error -> stale + message + backoff
      const detail = result.detail ?? "Unknown error";
      const isBlocked = result.status === "blocked";
      const msg = isBlocked ? `Blocked (${detail}) — showing cached data` : `Fetch failed (${detail}) — showing cached data`;
      this.treeView.message = msg;
      this.tree.setMessage(msg);
      // keep stale render
      const stale = await this.cache.load();
      if (stale.snapshot) this.render(stale.snapshot);
      else this.tree.refresh();

      this.backoffMin = Math.min(120, this.backoffMin * 2);
      this.schedule(this.backoffMin);
    } finally {
      this.isFetching = false;
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  /**
   * Live registry refresh — fire-and-forget from fetchAndRender.
   * Silent on all failures (never touches treeView.message, backoff, or
   * scheduling); keeps last-known registry on any non-ok outcome.
   */
  private async refreshRegistry(): Promise<void> {
    if (this.registryFetching) return;
    this.registryFetching = true;
    try {
      // P1: no etag persistence yet (full 200 each cycle); P2 adds 304 handling.
      const result = await this.registryProvider.fetchRegistry(null);
      if (result.status === "ok") {
        const transformed = transformModelsDevRegistry(result.json);
        // Transform-null: keep last-known, persist NOTHING (self-heal next cycle).
        if (!transformed) return;
        const fetchedAt = new Date().toISOString();
        this.registryCache = transformed;
        this.registrySource = `models.dev api.json (live, fetched ${fetchedAt})`;
        await this.rerenderFlexFromCache();
      }
      // notModified (no etag sent yet) / blocked / error -> silent no-op
    } finally {
      this.registryFetching = false;
    }
  }

  /**
   * Re-render the flex section from the board cache so a late-arriving live
   * registry updates the view without disturbing board state.
   */
  private async rerenderFlexFromCache(): Promise<void> {
    try {
      const cached = await this.cache.load();
      if (cached.snapshot) this.render(cached.snapshot);
    } catch {
      // render path already null-safe; never let the registry break the board
    }
  }
}
