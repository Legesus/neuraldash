import * as vscode from "vscode";
import type { ValuedQuote } from "../core/types";

export async function pickBestValueQuickPick(valued: ValuedQuote[]): Promise<void> {
  const sorted = [...valued].sort((a, b) => {
    const av = a.value, bv = b.value;
    if (av == null && bv == null) {
      const am = a.basisMwh, bm = b.basisMwh;
      if (am == null && bm == null) return 0;
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

  const items: (vscode.QuickPickItem & { slug: string; modelId?: string })[] = sorted.map((v) => ({
    label: `${v.quote.displayName}`,
    description: v.basisMwh != null ? `${v.basisMwh.toFixed(1)} mWh` : "—",
    detail: v.value != null ? `value ${v.value.toFixed(4)}` : "no benchmark",
    slug: v.quote.slug,
    buttons: [
      { iconPath: new vscode.ThemeIcon("copy"), tooltip: "Copy slug" },
      { iconPath: new vscode.ThemeIcon("globe"), tooltip: "Copy models.dev id (slug)" },
    ],
  }));

  const qp = vscode.window.createQuickPick<typeof items[number]>();
  qp.items = items;
  qp.placeholder = "Best value — highest score / mWh";
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;

  qp.onDidTriggerItemButton(async (e) => {
    const idx = (e.button as vscode.QuickInputButton).tooltip;
    if (idx === "Copy slug") {
      await vscode.env.clipboard.writeText((e.item as unknown as { slug: string }).slug);
      void vscode.window.showInformationMessage(`Copied slug: ${(e.item as unknown as { slug: string }).slug}`);
    } else {
      await vscode.env.clipboard.writeText((e.item as unknown as { slug: string }).slug);
      void vscode.window.showInformationMessage(`Copied id: ${(e.item as unknown as { slug: string }).slug}`);
    }
  });

  qp.onDidAccept(() => {
    qp.hide();
  });

  qp.show();
  await new Promise<void>((resolve) => qp.onDidHide(resolve));
  qp.dispose();
}

export async function pickMyModel(valued: ValuedQuote[]): Promise<string | undefined> {
  const items = valued.map((v) => ({
    label: v.quote.displayName,
    description: v.quote.slug,
    picked: false,
  }));
  // prepend "Clear"
  items.unshift({ label: "$(clear-all) Clear (no model)", description: "", picked: false });
  const chosen = await vscode.window.showQuickPick(items, { placeHolder: "Select your model for status bar" });
  if (!chosen) return undefined;
  if (chosen.description === "" && chosen.label.includes("Clear")) return "";
  return chosen.description;
}
