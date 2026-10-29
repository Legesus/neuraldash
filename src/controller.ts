import * as vscode from "vscode";
import type { DataProvider, Snapshot, PreferredBand, SortOrder } from "./core/types";
import { CacheManager } from "./core/cache";
import { BoardTreeProvider } from "./ui/treeProvider";
import { StatusBarController } from "./ui/statusBar";
import { rankQuotes, bestValueSlug } from "./core/ranking";
import { mergedScores, resolveBundledScoresPath } from "./core/scores";
import { loadModelsRegistry, resolveBundledRegistryPath } from "./core/flex";
import { transformModelsDevRegistry } from "./core/registryTransform";
import { RegistryCacheManager } from "./core/registryCache";
import { buildFlexCatalog, harvestDocMultiplier, parseNeuralwattModels } from "./core/flexCatalog";
import type { FlexEntry, FlexSources, NeuralwattModelsDoc } from "./core/flexCatalog";
import { buildFlexDiagnostics } from "./core/flexDiagnostics";
import { parseFlexPerfView } from "./core/flexPerf";
import type { FlexPerfDoc } from "./core/flexPerf";
import { parseFlexCatalogCards } from "./core/flexCatalogCards";
import type { FlexCardsDoc } from "./core/flexCatalogCards";
import { buildDisplayNameMap, applyDisplayNames } from "./core/displayNames";
import { FlexCatalogCacheManager } from "./core/flexCatalogCache";
import { eciScoreTable, isEciDoc } from "./core/eciScores";
import type { EciDoc } from "./core/eciScores";
import { fetchEpochEci } from "./providers/epochProvider";
import type { RegistryDataProvider } from "./providers/modelsDevProvider";
import type { NeuralwattModelsProvider } from "./providers/neuralwattModelsProvider";
import { NEURALWATT_URL } from "./providers/neuralwattProvider";

const ECI_STATE_KEY = "neuraldash.eciDoc";
const ECI_REFRESH_MS = 24 * 60 * 60 * 1000;

export class Controller {
  private timer: NodeJS.Timeout | null = null;
  private backoffMin = 20;
  private pollMin = 20;
  private isFetching = false;
  private registryCache: import("./core/flex").ModelsRegistry | null = null;
  private registrySource = "";
  private registryFetching = false;
  private flexV1DocCache: NeuralwattModelsDoc | null = null;
  private flexV1FetchedAt: string | null = null;
  private flexV1Hash: string | null = null;
  private flexPerfDocCache: FlexPerfDoc | null = null;
  private flexPerfFetchedAt: string | null = null;
  private flexPerfHash: string | null = null;
  private flexCardsDocCache: FlexCardsDoc | null = null;
  private flexCardsFetchedAt: string | null = null;
  private flexCardsHash: string | null = null;
  private flexFetching = false;
  private eciDoc: EciDoc | null = null;
  private eciFetching = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly provider: DataProvider,
    private readonly registryProvider: RegistryDataProvider,
    private readonly flexProvider: NeuralwattModelsProvider,
    private readonly cache: CacheManager,
    private readonly registryStore: RegistryCacheManager,
    private readonly flexStore: FlexCatalogCacheManager,
    private readonly tree: BoardTreeProvider,
    private readonly statusBar: StatusBarController,
    private readonly treeView: vscode.TreeView<vscode.TreeItem>,
    private readonly extensionRoot: string,
  ) {}

  async activate(): Promise<void> {
    this.pollMin = this.readPollInterval();

    // Load registry: bundled fallback first, then cached live wins (stale-first)
    const registryPath = resolveBundledRegistryPath(this.extensionRoot);
    this.registryCache = loadModelsRegistry(registryPath);
    this.registrySource = this.registryCache ? `bundled registry (${this.registryCache.generatedAt})` : "";
    try {
      const stored = await this.registryStore.load();
      if (stored.registry) {
        this.registryCache = stored.registry;
        this.registrySource = `models.dev api.json (cached ${stored.lastSuccessAt ?? stored.lastCheckedAt ?? ""})`;
      }
    } catch {
      // corrupt/unreadable registry cache -> bundled fallback stays
    }

    // Load flex catalog: cached docs only (no bundled fallback — the fetched
    // /v1/models + perf-view + /models-cards documents are authoritative and
    // refreshed below).
    try {
      const storedFlex = await this.flexStore.load();
      if (storedFlex.v1.doc) {
        this.flexV1DocCache = storedFlex.v1.doc;
        this.flexV1FetchedAt = storedFlex.v1.lastSuccessAt;
        this.flexV1Hash = storedFlex.v1.contentHash;
      }
      if (storedFlex.perf.doc) {
        this.flexPerfDocCache = storedFlex.perf.doc;
        this.flexPerfFetchedAt = storedFlex.perf.lastSuccessAt;
        this.flexPerfHash = storedFlex.perf.contentHash;
      }
      if (storedFlex.cards.doc) {
        this.flexCardsDocCache = storedFlex.cards.doc;
        this.flexCardsFetchedAt = storedFlex.cards.lastSuccessAt;
        this.flexCardsHash = storedFlex.cards.contentHash;
      }
    } catch {
      // corrupt/unreadable flex cache -> empty flex section until first fetch
    }

    const storedEci = this.context.globalState.get<unknown>(ECI_STATE_KEY);
    if (isEciDoc(storedEci)) this.eciDoc = storedEci;

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
    const table = mergedScores(bundledPath, overridePath, eciScoreTable(snapshot.quotes, this.eciDoc));
    const valued = rankQuotes(snapshot.quotes, table, tariff, preferred);
    const best = bestValueSlug(valued);

    // Board display names: re-attach the publisher's proper label (the board
    // page serves raw ids) by joining the three already-fetched flex docs.
    // Non-mutating — the cached snapshot keeps the scraped titles.
    const enriched = applyDisplayNames(
      valued,
      buildDisplayNameMap(this.flexV1DocCache, this.registryCache, this.flexCardsDocCache),
    );

    // Flex catalog per render: document membership + registry enrichment + board slugs
    const showFlex = vscode.workspace.getConfiguration("neuraldash").get<boolean>("showFlexTiers", true);
    const flexList: FlexEntry[] = showFlex
      ? buildFlexCatalog(this.flexV1DocCache, this.flexPerfDocCache, this.flexCardsDocCache, this.registryCache, new Set(snapshot.quotes.map((q) => q.slug)))
      : [];

    this.tree.setData(snapshot, enriched, best, tariff, flexList, this.registrySource, this.flexSources());
    const myModel = vscode.workspace.getConfiguration("neuraldash").get<string>("myModel", "");
    this.statusBar.update(myModel, enriched);
  }

  /**
   * Current board id -> display-name map, built from the in-memory fetched
   * docs (render parity). The quick-pick commands re-rank from cache
   * independently of render(), so they wrap their own rankQuotes output with
   * this instead of consuming tree state.
   */
  boardDisplayNames(): ReadonlyMap<string, string> {
    return buildDisplayNameMap(this.flexV1DocCache, this.registryCache, this.flexCardsDocCache);
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
      // Registry + flex catalog refreshes ride the board cycle but never block it.
      void this.refreshRegistry();
      void this.refreshFlexCatalog();
      void this.refreshBenchmarks();
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
      let etag: string | null = null;
      try {
        etag = (await this.registryStore.load()).etag;
      } catch {
        etag = null;
      }
      const result = await this.registryProvider.fetchRegistry(etag);
      if (result.status === "ok") {
        const transformed = transformModelsDevRegistry(result.json);
        // Transform-null: keep last-known, persist NOTHING (self-heal next cycle).
        if (!transformed) return;
        const fetchedAt = new Date().toISOString();
        this.registryCache = transformed;
        this.registrySource = `models.dev api.json (live, fetched ${fetchedAt})`;
        try {
          await this.registryStore.saveRegistry(transformed, result.etag);
        } catch {
          // persistence is best-effort; in-memory registry already applied
        }
        await this.rerenderFlexFromCache();
      } else if (result.status === "notModified") {
        try {
          await this.registryStore.saveNotModified();
        } catch {
          // best-effort
        }
      }
      // blocked / error -> silent no-op
    } catch {
      // Silent: a fire-and-forget refresh must never surface as an unhandled
      // rejection and must never touch treeView.message, backoff, or scheduling.
    } finally {
      this.registryFetching = false;
    }
  }

  /**
   * Evidence dump for `neuraldash.debugFlex`: per-row membership + pricing
   * provenance built from the SAME inputs as render() (never a separate code
   * path). Null when no flex document has ever been fetched.
   */
  async flexDiagnostics(): Promise<string | null> {
    if (!this.flexV1DocCache && !this.flexPerfDocCache && !this.flexCardsDocCache) return null;
    const cached = await this.cache.load();
    const quotes = cached.snapshot?.quotes ?? [];
    const boardSlugs = new Set(quotes.map((q) => q.slug));
    const entries = buildFlexCatalog(this.flexV1DocCache, this.flexPerfDocCache, this.flexCardsDocCache, this.registryCache, boardSlugs);
    return buildFlexDiagnostics({
      entries,
      sources: this.flexSources(),
      v1Hash: this.flexV1Hash,
      perfHash: this.flexPerfHash,
      cardsHash: this.flexCardsHash,
      harvest: harvestDocMultiplier(this.flexV1DocCache),
      boardPreviewSlugs: new Set(quotes.filter((q) => q.isPreview).map((q) => q.slug)),
      boardSlugs,
    });
  }

  /** Document refs for tooltip Source lines / diagnostics. */
  private flexSources(): FlexSources {
    return {
      v1: this.flexV1DocCache ? { url: this.flexProvider.sourceUrl, fetchedAt: this.flexV1FetchedAt } : null,
      perf: this.flexPerfDocCache ? { url: this.flexProvider.perfUrl, fetchedAt: this.flexPerfFetchedAt } : null,
      cards: this.flexCardsDocCache ? { url: this.flexProvider.modelsPageUrl, fetchedAt: this.flexCardsFetchedAt } : null,
    };
  }

  /**
   * Live triple-document refresh (v1 JSON + perf-view HTML + /models cards
   * HTML) — fire-and-forget from fetchAndRender. Mirrors refreshRegistry's
   * guarantees: ONE re-entrancy guard, silent on all failures (never touches
   * treeView.message, backoff, or scheduling); per-document independent
   * handling — content-hash-equal is a no-op, a parse-null keeps last-known
   * and persists NOTHING (self-heal next cycle), a parsed ok updates memory +
   * the cache slot. The view re-renders only when a document actually
   * changed; otherwise lastCheckedAt is touched.
   */
  private async refreshBenchmarks(): Promise<void> {
    if (this.eciFetching) return;
    const lastAt = this.eciDoc ? Date.parse(this.eciDoc.fetchedAt) : NaN;
    if (Number.isFinite(lastAt) && Date.now() - lastAt < ECI_REFRESH_MS) return;
    this.eciFetching = true;
    try {
      const result = await fetchEpochEci(this.eciDoc?.contentHash ?? null);
      if (result.status === "ok") {
        this.eciDoc = result.doc;
      } else if (result.status === "notModified" && this.eciDoc) {
        this.eciDoc = { ...this.eciDoc, fetchedAt: new Date().toISOString() };
      } else {
        return;
      }
      await this.context.globalState.update(ECI_STATE_KEY, this.eciDoc);
      await this.rerenderFromCache();
    } catch {
      // best-effort: scores stay at last-known
    } finally {
      this.eciFetching = false;
    }
  }

  getEciDoc(): EciDoc | null {
    return this.eciDoc;
  }

  private async refreshFlexCatalog(): Promise<void> {
    if (this.flexFetching) return;
    this.flexFetching = true;
    try {
      const stored = await this.flexStore.load();
      let changed = false;

      const v1Result = await this.flexProvider.fetchModels(stored.v1.contentHash);
      if (v1Result.status === "ok") {
        const parsed = parseNeuralwattModels(v1Result.json);
        if (parsed) {
          this.flexV1DocCache = parsed;
          this.flexV1FetchedAt = new Date().toISOString();
          this.flexV1Hash = v1Result.contentHash;
          try {
            await this.flexStore.saveV1(parsed, v1Result.contentHash);
          } catch {
            // persistence is best-effort; in-memory doc already applied
          }
          changed = true;
        }
      }

      const perfResult = await this.flexProvider.fetchPerformanceView(stored.perf.contentHash);
      if (perfResult.status === "ok") {
        const parsed = parseFlexPerfView(perfResult.html);
        if (parsed) {
          this.flexPerfDocCache = parsed;
          this.flexPerfFetchedAt = new Date().toISOString();
          this.flexPerfHash = perfResult.contentHash;
          try {
            await this.flexStore.savePerf(parsed, perfResult.contentHash);
          } catch {
            // persistence is best-effort; in-memory doc already applied
          }
          changed = true;
        }
      }

      const cardsResult = await this.flexProvider.fetchModelsCards(stored.cards.contentHash);
      if (cardsResult.status === "ok") {
        const parsed = parseFlexCatalogCards(cardsResult.html);
        if (parsed) {
          this.flexCardsDocCache = parsed;
          this.flexCardsFetchedAt = new Date().toISOString();
          this.flexCardsHash = cardsResult.contentHash;
          try {
            await this.flexStore.saveCards(parsed, cardsResult.contentHash);
          } catch {
            // persistence is best-effort; in-memory doc already applied
          }
          changed = true;
        }
      }

      if (changed) {
        await this.rerenderFlexFromCache();
      } else {
        try {
          await this.flexStore.touchChecked();
        } catch {
          // best-effort
        }
      }
      // blocked / error / notModified -> silent no-op
    } catch {
      // Silent: a fire-and-forget refresh must never surface as an unhandled
      // rejection and must never touch treeView.message, backoff, or scheduling.
    } finally {
      this.flexFetching = false;
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
