/**
 * Model name -> slug mapping. Pure, no vscode imports.
 */

export const BOARD_NAME_TO_SLUG: Record<string, string> = {
  "DeepSeek V4 Flash": "deepseek-v4-flash",
  "DeepSeek V4-Pro": "deepseek-v4-pro",
  "Gemma 4 31B": "gemma-4-31b",
  "GLM-5.2": "glm-5.2",
  "GLM-5.2 (fast)": "glm-5.2-fast",
  "GLM-5.2 (short)": "glm-5.2-short",
  "GLM-5.2 (short, fast)": "glm-5.2-short-fast",
  "Kimi K2.7 Code": "kimi-k2.7-code",
  "Kimi K2.7 Code Fast": "kimi-k2.7-code-fast",
  "Kimi K3": "kimi-k3",
  "Kimi K3 Fast": "kimi-k3-fast",
  "Qwen 3.8 27B": "qwen-3.8-27b",
  "Qwen3.6 35B": "qwen3.6-35b",
  "Qwen3.6 35B Fast": "qwen3.6-35b-fast",
};

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

export function toSlug(displayName: string): string {
  const mapped = BOARD_NAME_TO_SLUG[displayName];
  if (mapped) return mapped;
  return slugify(displayName);
}
