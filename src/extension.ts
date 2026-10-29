import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { BoardTreeProvider } from "./ui/treeProvider";
import { StatusBarController } from "./ui/statusBar";
import { pickBestValueQuickPick, pickMyModel } from "./ui/quickPicks";
import { CacheManager, createVsCodeStorage } from "./core/cache";
import { RegistryCacheManager } from "./core/registryCache";
import type { RegistryCacheData } from "./core/registryCache";
import { FlexCatalogCacheManager } from "./core/flexCatalogCache";
import type { FlexCatalogCacheData } from "./core/flexCatalogCache";
import { NeuralwattProvider } from "./providers/neuralwattProvider";
import { ModelsDevRegistryProvider } from "./providers/modelsDevProvider";
import { NeuralwattModelsProvider } from "./providers/neuralwattModelsProvider";
import { Controller } from "./controller";
import { rankQuotes, bestValueSlug } from "./core/ranking";
import { applyDisplayNames } from "./core/displayNames";
import { mergedScores, resolveBundledScoresPath } from "./core/scores";
import { eciScoreTable } from "./core/eciScores";
import { resolveSlugArg, buildModelTooltipMd, resolveModelRefArg } from "./core/rowView";
import { ChartViewProvider, CHART_VIEW_ID } from "./ui/chartView";
import { NEURALWATT_URL } from "./providers/neuralwattProvider";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new NeuralwattProvider();
  const registryProvider = new ModelsDevRegistryProvider();
  const flexProvider = new NeuralwattModelsProvider();

  const storagePath = context.globalStorageUri.fsPath;
  const fsImpl = {
    readFile: (p: string, enc: string) => fs.promises.readFile(p, enc as BufferEncoding) as Promise<string>,
    writeFile: (p: string, data: string) => fs.promises.writeFile(p, data, "utf8") as Promise<void>,
    mkdir: (p: string, opts: { recursive: boolean }) => fs.promises.mkdir(p, opts) as Promise<void>,
  };
  const storage = createVsCodeStorage(storagePath, fsImpl as never);
  const cache = new CacheManager(storage);
  const registryStorage = createVsCodeStorage<RegistryCacheData>(storagePath, fsImpl as never, "registry-cache.json");
  const registryStore = new RegistryCacheManager(registryStorage);
  const flexStorage = createVsCodeStorage<FlexCatalogCacheData>(storagePath, fsImpl as never, "flex-catalog-cache.json");
  const flexStore = new FlexCatalogCacheManager(flexStorage);

  const tree = new BoardTreeProvider(context);
  const treeView = vscode.window.createTreeView("neuralwatt.board", {
    treeDataProvider: tree,
    showCollapseAll: false,
  });

  const statusBar = new StatusBarController();
  context.subscriptions.push(treeView, statusBar as unknown as vscode.Disposable);

  const controller = new Controller(context, provider, registryProvider, flexProvider, cache, registryStore, flexStore, tree, statusBar, treeView, context.extensionPath);
  context.subscriptions.push({ dispose: () => controller.dispose() });
  void controller.activate();

  const chartView = new ChartViewProvider(tree);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(CHART_VIEW_ID, chartView));
  const showModelChart = (slug: string): void => {
    void chartView.show(slug);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("neuraldash.refresh", async () => {
      await controller.manualRefresh();
    }),
    vscode.commands.registerCommand("neuraldash.sortByEnergy", () => {
      tree.setSortOrder("energy");
    }),
    vscode.commands.registerCommand("neuraldash.sortByValue", () => {
      tree.setSortOrder("value");
    }),
    vscode.commands.registerCommand("neuraldash.sortByName", () => {
      tree.setSortOrder("name");
    }),
    vscode.commands.registerCommand("neuraldash.pickBestValue", async () => {
      const cached = await cache.load();
      if (!cached.snapshot) {
        void vscode.window.showInformationMessage("No board data yet.");
        return;
      }
      const tariff = vscode.workspace.getConfiguration("neuraldash").get<number>("tariffPerKWh", 10);
      const preferred = vscode.workspace.getConfiguration("neuraldash").get<string>("preferredBand", "typical") as never;
      const bundledPath = resolveBundledScoresPath(context.extensionPath);
      const overridePath = vscode.workspace.getConfiguration("neuraldash").get<string>("scoresOverridePath", "");
      const table = mergedScores(bundledPath, overridePath, eciScoreTable(cached.snapshot.quotes, controller.getEciDoc()));
      const valued = applyDisplayNames(rankQuotes(cached.snapshot.quotes, table, tariff, preferred), controller.boardDisplayNames());
      await pickBestValueQuickPick(valued);
    }),
    vscode.commands.registerCommand("neuraldash.setMyModel", async () => {
      const cached = await cache.load();
      if (!cached.snapshot) {
        void vscode.window.showInformationMessage("No board data yet.");
        return;
      }
      const tariff = vscode.workspace.getConfiguration("neuraldash").get<number>("tariffPerKWh", 10);
      const preferred = vscode.workspace.getConfiguration("neuraldash").get<string>("preferredBand", "typical") as never;
      const bundledPath = resolveBundledScoresPath(context.extensionPath);
      const overridePath = vscode.workspace.getConfiguration("neuraldash").get<string>("scoresOverridePath", "");
      const table = mergedScores(bundledPath, overridePath, eciScoreTable(cached.snapshot.quotes, controller.getEciDoc()));
      const valued = applyDisplayNames(rankQuotes(cached.snapshot.quotes, table, tariff, preferred), controller.boardDisplayNames());
      const chosen = await pickMyModel(valued);
      if (chosen !== undefined) {
        await vscode.workspace.getConfiguration("neuraldash").update("myModel", chosen, vscode.ConfigurationTarget.Global);
      }
    }),
    vscode.commands.registerCommand("neuraldash.openPricingPage", async () => {
      await vscode.env.openExternal(vscode.Uri.parse(NEURALWATT_URL));
    }),
    vscode.commands.registerCommand("neuraldash.debugTooltip", async () => {
      // Diagnostic: capture the EXACT tooltip markdown string (md.value) the
      // tree assigns to a hover. OutputChannel-only: the hover is text-only by
      // design (hover image rendering proved unreliable), so no image is
      // expected here — `contains <img` is a regression tripwire (expect false).
      const board = tree.getBoardData();
      if (!board.snapshot || board.valued.length === 0) {
        void vscode.window.showInformationMessage("No board data — refresh first");
        return;
      }
      const v = board.valued[0]!;
      const md = buildModelTooltipMd(
        v,
        {
          fetchedAt: board.snapshot.fetchedAt,
          isBest: board.bestSlug != null && v.quote.slug === board.bestSlug,
          pricingUrl: NEURALWATT_URL,
          tariff: board.tariff,
        },
      );
      const channel = vscode.window.createOutputChannel("NeuralDash Debug");
      channel.appendLine(`row: ${v.quote.displayName} (slug: ${v.quote.slug})`);
      channel.appendLine(`tooltip length: ${md.length}`);
      channel.appendLine(`contains <img (expect false — hover is text-only): ${md.includes("<img")}`);
      channel.appendLine("--- full tooltip markdown ---");
      channel.appendLine(md);
      channel.show();
    }),
    vscode.commands.registerCommand("neuraldash.debugFlex", async () => {
      // Diagnostic: per-row evidence for the derived flex catalog — which
      // fetched document established membership, which document priced the
      // row (with exact values), the multiplier + ladder rung, preview status
      // and a report-only cross-check against the board's preview markers.
      const dump = await controller.flexDiagnostics();
      if (!dump) {
        void vscode.window.showInformationMessage("No flex data — refresh first");
        return;
      }
      const channel = vscode.window.createOutputChannel("NeuralDash Debug");
      channel.appendLine(dump);
      channel.show();
    }),
    vscode.commands.registerCommand("neuraldash.copySlug", async (arg: unknown) => {
      const slug = resolveSlugArg(arg);
      if (!slug) {
        void vscode.window.showInformationMessage("Copy Slug: use from a board row tooltip");
        return;
      }
      await vscode.env.clipboard.writeText(slug);
      vscode.window.setStatusBarMessage(`Copied slug: ${slug}`, 2000);
    }),
    vscode.commands.registerCommand("neuraldash.openModelChart", async (arg: unknown) => {
      const slug = resolveModelRefArg(arg);
      if (!slug) {
        // Palette/CLI-style invocation: pick from models with sparkline data.
        const board = tree.getBoardData();
        const items = board.valued
          .filter((v) => v.quote.sparkline)
          .map((v) => ({ label: v.quote.displayName, description: v.quote.slug, slug: v.quote.slug }));
        if (items.length === 0) {
          void vscode.window.showInformationMessage("No board data yet — refresh first");
          return;
        }
        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: "Select a model to open its 48h trend chart",
        });
        if (picked) showModelChart(picked.slug);
        return;
      }
      showModelChart(slug);
    }),
  );
}

export function deactivate(): void {}
