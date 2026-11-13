import * as vscode from "vscode";
import type { SortOrder, ValuedQuote } from "../core/types";
import { formatMwh } from "../core/energy";
import { sortValued } from "../core/ranking";

const MODE_LABELS: Record<SortOrder, string> = {
  bangForBuck: "Bang for Buck",
  fastest: "Fastest",
  lowestPrice: "Lowest Price",
};

export class StatusBarController {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = "neuraldash.pickBestValue";
    this.item.tooltip = "NeuralDash: click to view board";
  }

  update(myModelSlug: string, valued: ValuedQuote[], sortOrder: SortOrder = "bangForBuck"): void {
    const match = myModelSlug
      ? valued.find((v) => v.quote.slug === myModelSlug)
      : sortValued(valued, sortOrder)[0];
    if (!match || match.descriptionMwh == null) {
      this.item.hide();
      return;
    }
    const mwh = match.descriptionMwh;
    const tok = match.perf?.throughputToks?.p50;
    const tokStr = tok != null ? `${Math.round(tok)} tok/s` : "\u2014 tok/s";
    const modeLabel = MODE_LABELS[sortOrder];
    this.item.text = `$(zap) ${match.quote.displayName} \u00b7 ${tokStr} \u00b7 ${formatMwh(mwh)} (${modeLabel})`;
    this.item.tooltip = `${match.quote.displayName} \u2014 ${tokStr} \u00b7 ${formatMwh(mwh)} (${modeLabel})`;
    this.item.show();
  }

  hide(): void {
    this.item.hide();
  }

  dispose(): void {
    this.item.dispose();
  }
}
