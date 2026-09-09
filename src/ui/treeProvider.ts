import * as vscode from "vscode";
import type { Snapshot, ValuedQuote, SortOrder } from "../core/types";
import { costPer1kUsd } from "../core/energy";
import { computeSeverityScale, basisToSvgUri } from "../core/color";
import type { SeverityScale } from "../core/color";
import type { RegistryModel } from "../core/flex";
import { modelRowDescription, tooltipFooter, buildModelTooltipMd, escapeMarkdownLocal } from "../core/rowView";
import { NEURALWATT_URL } from "../providers/neuralwattProvider";
import { formatFlexDescription, formatContextTokens } from "../core/flex";

export class FlexSectionItem extends vscode.TreeItem {
  constructor(public readonly flexModels: RegistryModel[]) {
    super("Flex tiers — registry pricing, no live energy data", vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "flex.header";
    this.description = `${flexModels.length} variants`;
    // grey zap icon for the header (same grey as null-basis)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#808080" d="M9.5 1 3.5 9.2h3.4L6 15l6.5-8.2H9.1L9.5 1z"/></svg>`;
    this.iconPath = vscode.Uri.parse("data:image/svg+xml;utf8," + encodeURIComponent(svg));
  }
}

export class BoardTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChange = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private valued: ValuedQuote[] = [];
  private bestSlug: string | null = null;
  private snapshot: Snapshot | null = null;
  private tariff: number = 10;
  private sortOrder: SortOrder = "energy";
  private statusMessage: string | null = null;
  private colorScaleEnabled = true;
  private flexEnabled = true;
  private scale: SeverityScale = { lnMin: 0, lnMax: 0, count: 0 };
  private flexTiers: RegistryModel[] = [];
  private registrySource = "";

  constructor(private readonly context: vscode.ExtensionContext) {
    const saved = context.workspaceState.get<SortOrder>("sortOrder");
    if (saved === "value" || saved === "energy" || saved === "name") this.sortOrder = saved;
  }

  refresh(): void {
    this._onDidChange.fire(undefined);
  }

  setMessage(msg: string | null): void {
    this.statusMessage = msg;
  }

  setData(
    snapshot: Snapshot | null,
    valued: ValuedQuote[],
    bestSlug: string | null,
    tariff: number,
    flexTiers: RegistryModel[] = [],
    registrySource = "",
  ): void {
    this.snapshot = snapshot;
    this.valued = valued;
    this.bestSlug = bestSlug;
    this.tariff = tariff;
    this.flexTiers = flexTiers;
    this.registrySource = registrySource;
    // compute severity scale once per render
    const bases = valued.map((v) => v.basisMwh);
    this.scale = computeSeverityScale(bases);
    // colorScale flag read lazily in toTreeItem; but we also keep a cached value from config
    // Controller will call with updated flags via setFlags or we read VS Code config here
    try {
      const cfg = vscode.workspace.getConfiguration("neuraldash");
      this.colorScaleEnabled = cfg.get<boolean>("colorScale", true);
      this.flexEnabled = cfg.get<boolean>("showFlexTiers", true);
    } catch {
      // ignore in tests
    }
    this._onDidChange.fire(undefined);
  }

  setSortOrder(order: SortOrder): void {
    this.sortOrder = order;
    void this.context.workspaceState.update("sortOrder", order);
    this._onDidChange.fire(undefined);
  }

  getSortOrder(): SortOrder {
    return this.sortOrder;
  }

  /** Current board state for diagnostics (e.g. `neuraldash.debugTooltip`). */
  getBoardData(): BoardSnapshotData {
    return {
      snapshot: this.snapshot,
      valued: this.valued,
      bestSlug: this.bestSlug,
      tariff: this.tariff,
      registrySource: this.registrySource,
    };
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    // Flex header children
    if (element instanceof FlexSectionItem) {
      return element.flexModels.map((m) => this.toFlexItem(m));
    }

    if (!this.snapshot || this.valued.length === 0) {
      const item = new vscode.TreeItem(this.statusMessage ?? "No data yet — refresh to load.", vscode.TreeItemCollapsibleState.None);
      item.description = this.snapshot ? `${this.snapshot.quotes.length} models` : undefined;
      return [item];
    }
    const sorted = this.applySort(this.valued);
    const rows: vscode.TreeItem[] = sorted.map((v) => this.toTreeItem(v));

    // Append flex collapsible section when enabled and registry has tiers
    if (this.flexEnabled && this.flexTiers.length > 0) {
      rows.push(new FlexSectionItem(this.flexTiers));
    }
    return rows;
  }

  private toFlexItem(m: RegistryModel): vscode.TreeItem {
    const label = m.name || m.slug;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = formatFlexDescription(m);
    item.contextValue = "flex.model";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#808080" d="M9.5 1 3.5 9.2h3.4L6 15l6.5-8.2H9.1L9.5 1z"/></svg>`;
    item.iconPath = vscode.Uri.parse("data:image/svg+xml;utf8," + encodeURIComponent(svg));

    const md = new vscode.MarkdownString(undefined, true);
    const lines: string[] = [];
    lines.push(`**${escapeMarkdownLocal(m.name)}**  \n\`slug: ${escapeMarkdownLocal(m.slug)}\``);
    lines.push("");
    lines.push(`| Field | Value |`);
    lines.push(`|---|---|`);
    lines.push(`| Provider | ${escapeMarkdownLocal(m.provider)} |`);
    lines.push(`| Family | ${escapeMarkdownLocal(m.family ?? "-")} |`);
    lines.push(`| Context | ${escapeMarkdownLocal(formatContextTokens(m.context))} tokens |`);
    lines.push(`| Input | $${escapeMarkdownLocal(m.cost.input.toFixed(2))} /1M tok |`);
    lines.push(`| Output | $${escapeMarkdownLocal(m.cost.output.toFixed(2))} /1M tok |`);
    if (m.cost.cache_read != null) lines.push(`| Cache read | $${escapeMarkdownLocal(m.cost.cache_read.toFixed(3))} |`);
    if (m.description) lines.push(`| Description | ${escapeMarkdownLocal(m.description)} |`);
    if (m.last_updated) lines.push(`| Last updated | ${escapeMarkdownLocal(m.last_updated)} |`);
    lines.push(`| Source | ${escapeMarkdownLocal(this.registrySource)} |`);
    lines.push(`\n_Pricing from registry — no live energy data_`);
    // Same sticky-hover footer as model rows; isTrusted required for the command: link.
    lines.push(tooltipFooter(NEURALWATT_URL, m.slug));
    md.value = lines.join("\n");
    md.isTrusted = true;
    item.tooltip = md;
    return item;
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
    // Slug identity: the openModelChart context-menu / inline invocation
    // passes the TreeItem; its core-serialized string `id` is the lookup key
    // (also improves VS Code identity/selection persistence across refreshes).
    item.id = v.quote.slug;

    const mwh = v.descriptionMwh;
    const cost = costPer1kUsd(mwh, this.tariff);
    item.description = modelRowDescription(mwh, cost, v.quote.sparkline, v.quote.trend);

    if (isBest) {
      item.iconPath = new vscode.ThemeIcon("star-full");
    } else if (this.colorScaleEnabled) {
      const svg = basisToSvgUri(v.basisMwh, this.scale);
      item.iconPath = vscode.Uri.parse("data:image/svg+xml;utf8," + encodeURIComponent(svg));
    } else {
      item.iconPath = new vscode.ThemeIcon("zap");
    }
    item.contextValue = isBest ? "model.best" : v.quote.isPreview ? "model.preview" : "model";

    // Tooltip: isTrusted=true so the footer command: link is clickable (content is
    // extension-assembled; only static + formatted numbers flow into it).
    // Footer link markers `](` flip the hover widget to interactive/sticky so the
    // pointer can move into the tooltip; applied to every model row unconditionally.
    // isTrusted is required for the command: link to be clickable.
    const md = new vscode.MarkdownString(undefined, true);
    md.value = buildModelTooltipMd(v, {
      fetchedAt: this.snapshot ? this.snapshot.fetchedAt : null,
      isBest,
      pricingUrl: NEURALWATT_URL,
      tariff: this.tariff,
    });
    md.isTrusted = true;
    item.tooltip = md;

    item.command = undefined;

    return item;
  }
}

/**
 * Current board state for diagnostics (e.g. `neuraldash.debugTooltip`).
 * Returns live references — read-only use.
 */
export interface BoardSnapshotData {
  snapshot: Snapshot | null;
  valued: ValuedQuote[];
  bestSlug: string | null;
  tariff: number;
  registrySource: string;
}
