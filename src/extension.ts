import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { BoardTreeProvider } from "./ui/treeProvider";
import { StatusBarController } from "./ui/statusBar";
import { pickBestValueQuickPick, pickMyModel } from "./ui/quickPicks";
import { CacheManager, createVsCodeStorage } from "./core/cache";
import { NeuralwattProvider } from "./providers/neuralwattProvider";
import { Controller } from "./controller";
import { rankQuotes, bestValueSlug } from "./core/ranking";
import { mergedScores, resolveBundledScoresPath } from "./core/scores";
import { NEURALWATT_URL } from "./providers/neuralwattProvider";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new NeuralwattProvider();

  const storagePath = context.globalStorageUri.fsPath;
  const fsImpl = {
    readFile: (p: string, enc: string) => fs.promises.readFile(p, enc as BufferEncoding) as Promise<string>,
    writeFile: (p: string, data: string) => fs.promises.writeFile(p, data, "utf8") as Promise<void>,
    mkdir: (p: string, opts: { recursive: boolean }) => fs.promises.mkdir(p, opts) as Promise<void>,
  };
  const storage = createVsCodeStorage(storagePath, fsImpl as never);
  const cache = new CacheManager(storage);

  const tree = new BoardTreeProvider(context);
  const treeView = vscode.window.createTreeView("neuralwatt.board", {
    treeDataProvider: tree,
    showCollapseAll: false,
  });

  const statusBar = new StatusBarController();
  context.subscriptions.push(treeView, statusBar as unknown as vscode.Disposable);

  const controller = new Controller(context, provider, cache, tree, statusBar, treeView, context.extensionPath);
  context.subscriptions.push({ dispose: () => controller.dispose() });
  void controller.activate();

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
  );
}

export function deactivate(): void {}
