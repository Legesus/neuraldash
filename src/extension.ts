import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { BoardTreeProvider } from "./ui/treeProvider";
import { StatusBarController } from "./ui/statusBar";
import { pickBestValueQuickPick, pickMyModel } from "./ui/quickPicks";
import { CacheManager, createVsCodeStorage } from "./core/cache";
import { RegistryCacheManager } from "./core/registryCache";
import type { RegistryCacheData } from "./core/registryCache";
import { NeuralwattProvider } from "./providers/neuralwattProvider";
import { ModelsDevRegistryProvider } from "./providers/modelsDevProvider";
import { Controller } from "./controller";
import { rankQuotes, bestValueSlug } from "./core/ranking";
import { mergedScores, resolveBundledScoresPath } from "./core/scores";
import { resolveSlugArg, buildModelTooltipMd, resolveModelRefArg } from "./core/rowView";
import { findModelBySlug, buildModelChartHtml } from "./core/chartPanel";
import { NEURALWATT_URL } from "./providers/neuralwattProvider";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new NeuralwattProvider();
  const registryProvider = new ModelsDevRegistryProvider();

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

  const tree = new BoardTreeProvider(context);
  const treeView = vscode.window.createTreeView("neuralwatt.board", {
    treeDataProvider: tree,
    showCollapseAll: false,
  });

  const statusBar = new StatusBarController();
  context.subscriptions.push(treeView, statusBar as unknown as vscode.Disposable);

  const controller = new Controller(context, provider, registryProvider, cache, registryStore, tree, statusBar, treeView, context.extensionPath);
  context.subscriptions.push({ dispose: () => controller.dispose() });
  void controller.activate();

  // Single reused chart panel (proven debug-panel rendering path): reopening
  // another model swaps title + content in place; dispose clears the ref.
  // No serializer — content is trivially regenerable; an open panel does NOT
  // live-update on board refresh (reopen to refresh).
  let chartPanel: vscode.WebviewPanel | undefined;
  const showModelChart = (slug: string): void => {
    const board = tree.getBoardData();
    const v = findModelBySlug(board.valued, slug);
    if (!v) {
      void vscode.window.showInformationMessage(`No board data for "${slug}" — refresh first`);
      return;
    }
    const title = `48h Trend — ${v.quote.displayName}`;
    const html = buildModelChartHtml(v, {
      fetchedAt: board.snapshot ? board.snapshot.fetchedAt : null,
      tariff: board.tariff,
    });
    if (!chartPanel) {
      chartPanel = vscode.window.createWebviewPanel("neuraldash.modelChart", title, vscode.ViewColumn.Beside, { enableScripts: false });
      chartPanel.onDidDispose(() => {
        chartPanel = undefined;
      }, null, context.subscriptions);
    } else {
      chartPanel.title = title;
      chartPanel.reveal(vscode.ViewColumn.Beside);
    }
    chartPanel.webview.html = html;
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
      const table = mergedScores(bundledPath, overridePath);
      const valued = rankQuotes(cached.snapshot.quotes, table, tariff, preferred);
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
      const table = mergedScores(bundledPath, overridePath);
      const valued = rankQuotes(cached.snapshot.quotes, table, tariff, preferred);
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
