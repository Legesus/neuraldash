import * as vscode from "vscode";
import { buildChartPlaceholderHtml, buildModelChartHtml, findModelBySlug } from "../core/chartPanel";
import type { BoardTreeProvider } from "./treeProvider";

export const CHART_VIEW_ID = "neuraldash.chart";

export class ChartViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private slug: string | null = null;

  constructor(private readonly tree: BoardTreeProvider) {
    tree.onDidChangeTreeData(() => this.render());
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: false };
    view.onDidDispose(() => {
      this.view = undefined;
    });
    this.render();
  }

  async show(slug: string): Promise<void> {
    this.slug = slug;
    if (this.view) {
      this.view.show(true);
      this.render();
    } else {
      await vscode.commands.executeCommand(`${CHART_VIEW_ID}.focus`);
    }
  }

  private render(): void {
    if (!this.view) return;
    const board = this.tree.getBoardData();
    const v = this.slug ? findModelBySlug(board.valued, this.slug) : null;
    if (!v) {
      this.view.description = undefined;
      this.view.webview.html = buildChartPlaceholderHtml(
        this.slug ? `No board data for "${this.slug}" yet. Refresh the board.` : "Click a model in the board to see its 48h trend.",
      );
      return;
    }
    this.view.description = v.quote.displayName;
    this.view.webview.html = buildModelChartHtml(v, {
      fetchedAt: board.snapshot ? board.snapshot.fetchedAt : null,
      tariff: board.tariff,
      sourceUrl: board.snapshot ? board.snapshot.sourceUrl : null,
      compact: true,
    });
  }
}
