import * as vscode from "vscode";
import type { Snapshot, ValuedQuote, SortOrder } from "../core/types";
import { costPer1kUsd } from "../core/energy";
import { computeSeverityScale, basisToSvgUri } from "../core/color";
import type { SeverityScale } from "../core/color";
import type { FlexEntry, FlexSources } from "../core/flexCatalog";
import { formatFlexEntryDescription } from "../core/flexCatalog";
import { modelRowDescription, buildModelTooltipMd } from "../core/rowView";
import { buildFlexTooltipMd } from "../core/flexHover";
import { sortValued, energySortKey, partitionByEnergy } from "../core/ranking";
import { NEURALWATT_URL } from "../providers/neuralwattProvider";
import type { ThinkingInfo } from "../core/thinking";
import { thinkingFor } from "../core/thinking";

export class FlexSectionItem extends vscode.TreeItem {
  constructor(public readonly flexEntries: FlexEntry[]) {
    super("Flex tiers — catalog pricing, no live energy data", vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "flex.header";
    this.description = `${flexEntries.length} variants`;
    // grey zap icon for the header (same grey as null-basis)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#808080" d="M9.5 1 3.5 9.2h3.4L6 15l6.5-8.2H9.1L9.5 1z"/></svg>`;
    this.iconPath = vscode.Uri.parse("data:image/svg+xml;utf8," + encodeURIComponent(svg));
  }
}

export class NoEnergySectionItem extends vscode.TreeItem {
  constructor(public readonly rows: ValuedQuote[]) {
    super("No energy data", vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "no-energy.header";
    this.description = `${rows.length} models`;
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
  private flexEntries: FlexEntry[] = [];
  private registrySource = "";
  private flexSources: FlexSources | null = null;
  private thinking: ReadonlyMap<string, ThinkingInfo> = new Map();

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
    flexEntries: FlexEntry[] = [],
    registrySource = "",
    flexSources: FlexSources | null = null,
    thinking: ReadonlyMap<string, ThinkingInfo> = new Map(),
  ): void {
    this.snapshot = snapshot;
    this.valued = valued;
    this.bestSlug = bestSlug;
    this.tariff = tariff;
    this.flexEntries = flexEntries;
    this.registrySource = registrySource;
    this.flexSources = flexSources;
    this.thinking = thinking;
    // compute severity scale once per render, over the same energy the rows
    // display and sort by (right-now first) so color tracks the visible order
    const bases = valued.map(energySortKey);
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
      thinking: this.thinking,
    };
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    // Flex header children
    if (element instanceof FlexSectionItem) {
      return element.flexEntries.map((e) => this.toFlexItem(e));
    }

    if (element instanceof NoEnergySectionItem) {
      return element.rows.map((v) => this.toTreeItem(v));
    }

    if (!this.snapshot || this.valued.length === 0) {
      const item = new vscode.TreeItem(this.statusMessage ?? "No data yet — refresh to load.", vscode.TreeItemCollapsibleState.None);
      item.description = this.snapshot ? `${this.snapshot.quotes.length} models` : undefined;
      return [item];
    }
    const sorted = this.applySort(this.valued);
    const { ranked, noEnergy } = partitionByEnergy(sorted);
    const rows: vscode.TreeItem[] = ranked.map((v) => this.toTreeItem(v));

    // Append flex collapsible section when enabled and the catalog has rows
    if (this.flexEnabled && this.flexEntries.length > 0) {
      rows.push(new FlexSectionItem(this.flexEntries));
    }
    if (noEnergy.length > 0) {
      rows.push(new NoEnergySectionItem(noEnergy));
    }
    return rows;
  }

  private toFlexItem(entry: FlexEntry): vscode.TreeItem {
    const label = entry.name + (entry.preview ? " (preview)" : "");
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = formatFlexEntryDescription(entry);
    item.contextValue = "flex.model";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#808080" d="M9.5 1 3.5 9.2h3.4L6 15l6.5-8.2H9.1L9.5 1z"/></svg>`;
    item.iconPath = vscode.Uri.parse("data:image/svg+xml;utf8," + encodeURIComponent(svg));

    const md = new vscode.MarkdownString(undefined, true);
    const base = this.valued.find((v) => v.quote.slug === entry.baseSlug) ?? null;
    md.value = buildFlexTooltipMd(entry, this.flexSources, base, { pricingUrl: NEURALWATT_URL, thinking: thinkingFor(this.thinking, [entry.slug, entry.baseSlug]) });
    md.isTrusted = true;
    item.tooltip = md;
    return item;
  }

  private applySort(list: ValuedQuote[]): ValuedQuote[] {
    // Single comparator source: core sortValued (ranking.test.ts). Energy
    // order follows the DISPLAYED number (descriptionMwh, right-now first),
    // so the visible list is monotonic; value order keeps the typical basis.
    return sortValued(list, this.sortOrder);
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
      const svg = basisToSvgUri(energySortKey(v), this.scale);
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
      thinking: this.thinking.get(v.quote.slug) ?? null,
    });
    md.isTrusted = true;
    item.tooltip = md;

    item.command = { command: "neuraldash.openModelChart", title: "Show 48h trend", arguments: [v.quote.slug] };

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
  thinking: ReadonlyMap<string, ThinkingInfo>;
}
