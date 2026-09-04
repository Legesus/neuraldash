import * as vscode from "vscode";
import type { ValuedQuote } from "../core/types";
import { formatMwh } from "../core/energy";

export class StatusBarController {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = "neuraldash.pickBestValue";
    this.item.tooltip = "NeuralDash: click to view board";
  }

  update(myModelSlug: string, valued: ValuedQuote[]): void {
    if (!myModelSlug) {
      this.item.hide();
      return;
    }
    const match = valued.find((v) => v.quote.slug === myModelSlug);
    if (!match || match.descriptionMwh == null) {
      this.item.hide();
      return;
    }
    const mwh = match.descriptionMwh;
    const cost = match.costPer1kUsd;
    const costStr = cost != null ? `$${cost.toFixed(2)}/1k` : "-";
    this.item.text = `$(zap) ${match.quote.displayName} · ${formatMwh(mwh)} · ${costStr}`;
    this.item.tooltip = `${match.quote.displayName} — ${formatMwh(mwh)} (${costStr})`;
    this.item.show();
  }

  hide(): void {
    this.item.hide();
  }

  dispose(): void {
    this.item.dispose();
  }
}
