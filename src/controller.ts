import * as vscode from "vscode";
import type { DataProvider, Snapshot, PreferredBand, SortOrder } from "./core/types";
import { CacheManager } from "./core/cache";
import { BoardTreeProvider } from "./ui/treeProvider";
import { StatusBarController } from "./ui/statusBar";
import { rankQuotes, bestValueSlug } from "./core/ranking";
import { mergedScores, resolveBundledScoresPath } from "./core/scores";
import { NEURALWATT_URL } from "./providers/neuralwattProvider";

export class Controller {
  private timer: NodeJS.Timeout | null = null;
  private backoffMin = 20;
  private pollMin = 20;
  private isFetching = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly provider: DataProvider,
    private readonly cache: CacheManager,
    private readonly tree: BoardTreeProvider,
    private readonly statusBar: StatusBarController,
    private readonly treeView: vscode.TreeView<vscode.TreeItem>,
    private readonly extensionRoot: string,
  ) {}

  async activate(): Promise<void> {
    this.pollMin = this.readPollInterval();

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
          e.affectsConfiguration("neuraldash.scoresOverridePath")
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
    this.tree.setData(snapshot, valued, best, tariff);
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
}
