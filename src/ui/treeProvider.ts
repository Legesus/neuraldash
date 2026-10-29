import * as vscode from "vscode";
import type { Snapshot, ValuedQuote, SortOrder } from "../core/types";
import { costPer1kUsd } from "../core/energy";
import { computeSeverityScale, basisToSvgUri } from "../core/color";
import type { SeverityScale } from "../core/color";
import type { FlexEntry, FlexSources } from "../core/flexCatalog";
import { formatFlexEntryDescription } from "../core/flexCatalog";
import { modelRowDescription, tooltipFooter, buildModelTooltipMd, escapeMarkdownLocal } from "../core/rowView";
import { flexEnergyTable, tierComparisonTable } from "../core/cardFormat";
import { sortValued, energySortKey } from "../core/ranking";
import { NEURALWATT_URL } from "../providers/neuralwattProvider";
import { formatContextTokens } from "../core/flex";

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
  ): void {
    this.snapshot = snapshot;
    this.valued = valued;
    this.bestSlug = bestSlug;
    this.tariff = tariff;
    this.flexEntries = flexEntries;
    this.registrySource = registrySource;
    this.flexSources = flexSources;
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

    if (!this.snapshot || this.valued.length === 0) {
      const item = new vscode.TreeItem(this.statusMessage ?? "No data yet — refresh to load.", vscode.TreeItemCollapsibleState.None);
      item.description = this.snapshot ? `${this.snapshot.quotes.length} models` : undefined;
      return [item];
    }
    const sorted = this.applySort(this.valued);
    const rows: vscode.TreeItem[] = sorted.map((v) => this.toTreeItem(v));

    // Append flex collapsible section when enabled and the catalog has rows
    if (this.flexEnabled && this.flexEntries.length > 0) {
      rows.push(new FlexSectionItem(this.flexEntries));
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
    const lines: string[] = [];
    const subtitle = [entry.provider, entry.family].filter((s): s is string => !!s).map(escapeMarkdownLocal).join(" · ");
    lines.push(`**${escapeMarkdownLocal(entry.name)}** · Flex  \n\`${escapeMarkdownLocal(entry.slug)}\`${subtitle ? ` · ${subtitle}` : ""}`);
    if (entry.description) lines.push(`\n${escapeMarkdownLocal(entry.description)}`);
    lines.push("");
    const std = entry.standard ?? null;
    const table = tierComparisonTable([
      { label: "Input", normal: std?.inputPerMillion ?? null, flex: entry.inputPerMillion, digits: 2 },
      { label: "Output", normal: std?.outputPerMillion ?? null, flex: entry.outputPerMillion, digits: 2 },
      { label: "Cache read", normal: std?.cacheReadPerMillion ?? null, flex: entry.cacheReadPerMillion, digits: 2 },
    ]);
    if (table.length > 0) lines.push(...table);
    else lines.push(`_Pricing TBD${entry.tbdReason ? `: ${escapeMarkdownLocal(entry.tbdReason)}` : ""}_`);
    const tierNotes: string[] = [`${escapeMarkdownLocal(formatContextTokens(entry.context))} context tokens`];
    if (entry.flexMultiplier != null) tierNotes.push(`Flex multiplier ${escapeMarkdownLocal(String(entry.flexMultiplier))}×`);
    if (std) tierNotes.push(`Normal from ${std.source === "v1-standard" ? "/v1/models" : "portal /models card"}`);
    lines.push(`\n${tierNotes.join(" · ")}`);
    const updated = entry.lastUpdated ? ` · updated ${escapeMarkdownLocal(entry.lastUpdated)}` : "";
    const base = this.valued.find((v) => v.quote.slug === entry.baseSlug) ?? null;
    const energyTable = base ? flexEnergyTable(base.descriptionMwh, base.costPer1kUsd, entry.flexMultiplier) : [];
    if (energyTable.length > 0) {
      lines.push("", ...energyTable);
      lines.push(`\n_Consumed = board right-now for \`${escapeMarkdownLocal(entry.baseSlug)}\` · charged = consumed × Flex multiplier${updated}_`);
    } else {
      lines.push(`\n_No live energy data for Flex rows${updated}_`);
    }
    lines.push(`\n_${escapeMarkdownLocal(flexSourcesLine(entry, this.flexSources))}_`);
    // Same sticky-hover footer as model rows; isTrusted required for the command: link.
    lines.push(tooltipFooter(NEURALWATT_URL, entry.slug));
    md.value = lines.join("\n");
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
    });
    md.isTrusted = true;
    item.tooltip = md;

    item.command = { command: "neuraldash.openModelChart", title: "Show 48h trend", arguments: [v.quote.slug] };

    return item;
  }
}

function shortStamp(iso: string | null | undefined): string {
  const m = iso ? /^\d{4}-(\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso) : null;
  return m ? `${m[1]} ${m[2]}` : "time unknown";
}

function flexPricingKind(entry: FlexEntry): string {
  switch (entry.provenance) {
    case "v1-alias":
      return "exact";
    case "v1-derived":
    case "portal-card":
      return "derived";
    case "models-dev":
      return "models.dev";
    case "tbd":
      return "TBD";
  }
}

function flexSourcesLine(entry: FlexEntry, sources: FlexSources | null): string {
  const parts: string[] = [];
  if (entry.membership !== "v1-alias") parts.push(`perf view ${shortStamp(sources?.perf?.fetchedAt)}`);
  const usesV1 = entry.membership !== "perf-lane" || entry.provenance === "v1-alias" || entry.provenance === "v1-derived";
  if (usesV1) parts.push(`/v1/models ${shortStamp(sources?.v1?.fetchedAt)}`);
  if (entry.provenance === "portal-card") parts.push(`/models card ${shortStamp(sources?.cards?.fetchedAt)}`);
  return `Sources: ${parts.join(" · ")} · pricing ${flexPricingKind(entry)}`;
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
