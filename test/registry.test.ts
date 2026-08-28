import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BOARD_NAME_TO_SLUG, slugify, toSlug } from "../src/core/registry";

describe("registry", () => {
  it("map hits include GLM-5.2 and Qwen3.6 35B Fast", () => {
    assert.equal(BOARD_NAME_TO_SLUG["GLM-5.2"], "glm-5.2");
    assert.equal(BOARD_NAME_TO_SLUG["Qwen3.6 35B Fast"], "qwen3.6-35b-fast");
    assert.equal(toSlug("GLM-5.2"), "glm-5.2");
    assert.equal(toSlug("Qwen3.6 35B Fast"), "qwen3.6-35b-fast");
  });

  it("covers all 14 board names", () => {
    const expected: Record<string, string> = {
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
    for (const [k, v] of Object.entries(expected)) {
      assert.equal(toSlug(k), v, k);
    }
  });

  it("slugify fallback lowercases and replaces non-alphanum", () => {
    assert.equal(slugify("My Unknown Model 9000!"), "my-unknown-model-9000");
    assert.equal(slugify("  Hello--World  "), "hello-world");
    assert.equal(toSlug("My Unknown Model 9000!"), "my-unknown-model-9000");
  });

  it("slugify preserves dots", () => {
    assert.equal(slugify("Qwen 3.8 27B"), "qwen-3.8-27b");
  });
});
