import * as vscode from "vscode";
import type { Snapshot, ValuedQuote, SortOrder } from "../core/types";
import { costPer1kUsd } from "../core/energy";

export class BoardTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private valued: ValuedQuote[] = [];
  private bestSlug: string | null = null;
  private snapshot: Snapshot | null = null;
  private tariff: number = 10;
  private sortOrder: SortOrder = "energy";
  private statusMessage: string | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {
    const saved = context.workspaceState.get<SortOrder>("sortOrder");
    if (saved === "value" || saved === "energy" || saved === "name") this.sortOrder = saved;
  }

  refresh(): void {
    this._onDidChange.fire();
  }

  setMessage(msg: string | null): void {
    this.statusMessage = msg;
  }

  setData(snapshot: Snapshot | null, valued: ValuedQuote[], bestSlug: string | null, tariff: number): void {
    this.snapshot = snapshot;
    this.valued = valued;
    this.bestSlug = bestSlug;
    this.tariff = tariff;
    this._onDidChange.fire();
  }

  setSortOrder(order: SortOrder): void {
    this.sortOrder = order;
    void this.context.workspaceState.update("sortOrder", order);
    this._onDidChange.fire();
  }

  getSortOrder(): SortOrder {
    return this.sortOrder;
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    if (!this.snapshot || this.valued.length === 0) {
      const item = new vscode.TreeItem(this.statusMessage ?? "No data yet — refresh to load.", vscode.TreeItemCollapsibleState.None);
      item.description = this.snapshot ? `${this.snapshot.quotes.length} models` : undefined;
      return [item];
    }
    const sorted = this.applySort(this.valued);
    return sorted.map((v) => this.toTreeItem(v));
  }

  private applySort(list: ValuedQuote[]): ValuedQuote[] {
    const arr = [...list];
    if (this.sortOrder === "energy") {
      arr.sort((a, b) => {
        const av = a.basisMwh, bv = b.basisMwh;
        if (av == null && bv == null) return a.quote.displayName.localeCompare(b.quote.displayName);
        if (av == null) return 1;
        if (bv == null) return -1;
        if (av !== bv) return av - bv;
        return a.quote.displayName.localeCompare(b.quote.displayName);
      });
    } else if (this.sortOrder === "value") {
      arr.sort((a, b) => {
        const av = a.value, bv = b.value;
        if (av == null && bv == null) {
          const am = a.basisMwh, bm = b.basisMwh;
          if (am == null && bm == null) return a.quote.displayName.localeCompare(b.quote.displayName);
          if (am == null) return 1;
          if (bm == null) return -1;
          return am - bm;
        }
        if (av == null) return 1;
        if (bv == null) return -1;
        if (av !== bv) return bv - av;
        const am = a.basisMwh, bm = b.basisMwh;
        if (am == null && bm == null) return 0;
        if (am == null) return 1;
        if (bm == null) return -1;
        return am - bm;
      });
    } else {
      arr.sort((a, b) => a.quote.displayName.localeCompare(b.quote.displayName));
    }
    return arr;
  }

  private toTreeItem(v: ValuedQuote): vscode.TreeItem {
    const label = v.quote.displayName + (v.quote.isPreview ? " (preview)" : "");
    const isBest = this.bestSlug != null && v.quote.slug === this.bestSlug;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);

    const mwh = v.descriptionMwh;
    const cost = costPer1kUsd(mwh, this.tariff);
    if (mwh != null) {
      item.description = `${mwh.toFixed(1)} mWh · $${(cost ?? 0).toFixed(2)}/1k`;
    } else {
      item.description = "-";
    }

    item.iconPath = new vscode.ThemeIcon(isBest ? "star-full" : "zap");
    item.contextValue = isBest ? "model.best" : v.quote.isPreview ? "model.preview" : "model";

    // Tooltip: do NOT set isTrusted — external strings (displayName/slug/contextBand/score.source)
    // could contain markdown command links. Use appendText() for external values so they are escaped.
    const md = new vscode.MarkdownString(undefined, true);
    // Build markdown safely: static structure via value, external strings via appendText
    const headerBase = `**${escapeMarkdown(v.quote.displayName)}**  \n\`slug: ${escapeMarkdown(v.quote.slug)}\``;
    const lines: string[] = [];
    lines.push(headerBase);
    if (isBest) lines.push(`\n$(star-full) **Best value**`);
    lines.push("");
    lines.push(`| Field | Value |`);
    lines.push(`|---|---|`);
    const rightNowStr = v.quote.rightNowMwh != null ? `${v.quote.rightNowMwh.toFixed(2)} mWh` : "-";
    const typicalStr = v.quote.typicalMwh != null ? `${v.quote.typicalMwh.toFixed(2)} mWh` : "-";
    const basisStr = v.basisMwh != null ? `${v.basisMwh.toFixed(2)} mWh` : "—";
    lines.push(`| Right now | ${rightNowStr} |`);
    lines.push(`| Typical (7d) | ${typicalStr} |`);
    lines.push(`| Basis | ${basisStr} |`);
    if (cost != null && mwh != null) lines.push(`| Cost/1k | $${cost.toFixed(2)} |`);
    if (v.quote.trend) {
      const arrow = v.quote.trend.direction === "above" ? "▲" : v.quote.trend.direction === "below" ? "▼" : "—";
      lines.push(`| Trend | ${arrow} ${v.quote.trend.pct}% ${escapeMarkdown(v.quote.trend.direction)} |`);
    }
    if (v.quote.cachePct != null) lines.push(`| Cache | ${v.quote.cachePct}% |`);
    if (v.quote.contextBand) {
      // contextBand is external but from scraped HTML — escape it
      lines.push(`| Context | ${escapeMarkdown(v.quote.contextBand)} |`);
    }
    if (v.score) {
      // score.source is external / user-provided — escape
      lines.push(`| Score | ${v.score.performanceScore} (${escapeMarkdown(v.score.source)}) |`);
    }
    if (v.value != null) lines.push(`| Value | ${v.value.toFixed(4)} (score/mWh) |`);
    else lines.push(`| Value | no benchmark |`);
    if (v.quote.bands.length > 0) {
      lines.push("");
      lines.push(`| Band | mWh | Share |`);
      lines.push(`|---|---|---|`);
      for (const b of v.quote.bands) {
        const m = b.mwh != null ? `${b.mwh.toFixed(2)}` : "—";
        const s = b.sharePct != null ? `${b.sharePct.toFixed(1)}%` : "—";
        lines.push(`| ${escapeMarkdown(b.band)} | ${m} | ${s} |`);
      }
    }
    if (this.snapshot) lines.push(`\n_Last updated: ${escapeMarkdown(this.snapshot.fetchedAt)}_`);
    md.value = lines.join("\n");
    item.tooltip = md;

    item.command = undefined;

    return item;
  }
}

function escapeMarkdown(text: string): string {
  // Escape markdown special chars that could form links/commands when md is rendered.
  // Minimal: escape backticks, brackets, parens that could form [text](url) or command: links.
  // Also escape backslashes first.
  return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\[/g, "\\[").replace(/\]/g, "\\]").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
