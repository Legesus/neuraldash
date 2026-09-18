import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFlexCatalogCards, flexCardById } from "../src/core/flexCatalogCards";
import type { FlexCardsDoc } from "../src/core/flexCatalogCards";
import { MODEL_CARDS, cardsFixtureHtml } from "./flexFixture";

function parseFixture(): FlexCardsDoc {
  const doc = parseFlexCatalogCards(cardsFixtureHtml());
  assert.ok(doc, "the full /models fixture must parse");
  return doc!;
}

function cardOf(doc: FlexCardsDoc, id: string) {
  const card = flexCardById(doc, id);
  assert.ok(card, `card holding "${id}" must exist`);
  return card!;
}

describe("flexCatalogCards.parseFlexCatalogCards", () => {
  it("C0 GATE: node-html-parser tolerates the live missing-space attr defect (data-price directly followed by data-energy)", () => {
    // The defect is verbatim on EVERY fixture card; this minimal reproduction
    // is the canary. If the DOM parser ever chokes on the attribute join,
    // this fails BEFORE anything downstream trusts card prices.
    const html =
      "<html><body>" +
      '<article class="nw-card"\n' +
      '  data-family="Canary Family"\n' +
      '  data-flex="1"\n' +
      '  data-price="0.00015"data-energy="0.349">\n' +
      '  <div class="nw-idlist"><a data-model-id="canary" data-model-action="variant">canary</a></div>\n' +
      '  <div class="mt-auto cursor-help" title="Cached input: $0.02/M tokens">\n' +
      "    <span>Input: <strong>$0.15/M</strong></span>\n" +
      "    <span>Output: <strong>$0.60/M</strong></span>\n" +
      "  </div>\n" +
      "</article></body></html>";
    const doc = parseFlexCatalogCards(html);
    assert.ok(doc);
    assert.equal(doc!.cards.length, 1);
    assert.equal(doc!.cards[0]!.inputPerMillion, 0.15);
    assert.equal(doc!.cards[0]!.outputPerMillion, 0.6);
    // The full fixture carries the defect on every card too.
    const full = cardsFixtureHtml();
    assert.equal((full.match(/"data-energy=/g) ?? []).length, MODEL_CARDS.length);
    assert.ok(full.includes('data-price="0.00015"data-energy='));
  });

  it("C1 parses all 11 family cards and 14 distinct ids; the non-article decoy is ignored", () => {
    const doc = parseFixture();
    assert.equal(doc.cards.length, 11);
    const ids = new Set(doc.cards.flatMap((c) => [...c.ids]));
    assert.equal(ids.size, 14);
    assert.equal(doc.cards.filter((c) => c.ids.length > 0).length, 11);
  });

  it("C2 data-price is USD per 1K INPUT tokens: x1000 matches the v1 exact values", () => {
    const doc = parseFixture();
    assert.equal(cardOf(doc, "deepseek-v4-flash").inputPerMillion, 0.14); // 0.00014 * 1000
    assert.equal(cardOf(doc, "glm-5.3").inputPerMillion, 1.45); // 0.00145 * 1000
    assert.equal(cardOf(doc, "gemma-4-31b").inputPerMillion, 0.144); // 0.000144 * 1000 (footer displays $0.14 — rounded, NOT used)
  });

  it("C3 the preview card: exact input from data-price, rounded output + cached from footer text/title", () => {
    const doc = parseFixture();
    const card = cardOf(doc, "deepseek-v4.1-flash");
    assert.equal(card.inputPerMillion, 0.15); // data-price 0.00015 (footer Input $0.15/M is redundant)
    assert.equal(card.outputPerMillion, 0.6); // footer "Output: $0.60/M"
    assert.equal(card.cachedInputPerMillion, 0.02); // title "Cached input: $0.02/M tokens ..."
    assert.equal(card.family, "DeepSeek V4.1 Flash");
    assert.deepEqual(card.ids, ["deepseek-v4.1-flash"]);
  });

  it("C4 a multi-id family card maps EVERY listed id to the same card (deduped, order-preserving)", () => {
    const doc = parseFixture();
    const viaBase = cardOf(doc, "kimi-k2.7-code");
    const viaFast = cardOf(doc, "kimi-k2.7-code-fast");
    assert.equal(viaBase, viaFast); // identical card object: join by id, any listed id
    assert.deepEqual(viaBase.ids, ["kimi-k2.7-code", "kimi-k2.7-code-fast"]);
    // The details link repeats the primary id and must not duplicate it.
    assert.equal(viaBase.ids.filter((id) => id === "kimi-k2.7-code").length, 1);
    assert.deepEqual(cardOf(doc, "qwen3.6-35b-fast").ids, ["qwen3.6-35b", "qwen3.6-35b-fast"]);
  });

  it("C5 card-level defects skip THAT card only: no ids, no data-price, no Output span", () => {
    const valid =
      '<article data-family="Ok" data-price="0.0001"><a data-model-id="ok-id"></a>' +
      '<div title="Cached input: $0.01/M tokens"><span>Output: <strong>$0.10/M</strong></span></div></article>';
    const noIds = '<article data-family="A" data-price="0.0001"><span>Output: <strong>$0.10/M</strong></span></article>';
    const noPrice = '<article data-family="B"><a data-model-id="b-id"></a><span>Output: <strong>$0.10/M</strong></span></article>';
    const noOutput = '<article data-family="C" data-price="0.0001"><a data-model-id="c-id"></a></article>';
    const junkPrice = '<article data-family="D" data-price="cheap"><a data-model-id="d-id"></a><span>Output: <strong>$0.10/M</strong></span></article>';
    const doc = parseFlexCatalogCards(`<html><body>${noIds}${noPrice}${noOutput}${junkPrice}${valid}</body></html>`);
    assert.ok(doc);
    assert.deepEqual(
      doc!.cards.map((c) => c.ids),
      [["ok-id"]],
    );
  });

  it("C6 zero valid cards / empty / non-string input -> null (keep-last-known contract)", () => {
    assert.equal(parseFlexCatalogCards("<html><body><p>error page</p></body></html>"), null);
    assert.equal(parseFlexCatalogCards(""), null);
    assert.equal(parseFlexCatalogCards("   "), null);
    assert.equal(parseFlexCatalogCards(42 as unknown as string), null);
    assert.equal(parseFlexCatalogCards(null as unknown as string), null);
  });

  it("C7 $0.00 is a valid parsed value (free-output embedding card); a missing cached title stays null", () => {
    const doc = parseFixture();
    const embedding = cardOf(doc, "qwen3-embedding-8b");
    assert.equal(embedding.outputPerMillion, 0);
    assert.equal(embedding.cachedInputPerMillion, 0);
    const pro = cardOf(doc, "deepseek-v4-pro");
    assert.equal(pro.cachedInputPerMillion, null);
    assert.equal(pro.outputPerMillion, 2.4);
  });

  it("C8 output extraction is text-anchored: bare stats-tile labels never match the footer regex", () => {
    // The stats tiles carry bare "Input"/"Output" spans (no colon, no $) —
    // only the pricing footer span "Output: $X/M" may satisfy the probe.
    const doc = parseFixture();
    for (const card of doc.cards) {
      assert.notEqual(card.outputPerMillion, null);
    }
    assert.equal(cardOf(doc, "kimi-k3").outputPerMillion, 15);
  });
});

describe("flexCatalogCards.flexCardById", () => {
  it("J1 null doc / unknown id / empty id -> null", () => {
    assert.equal(flexCardById(null, "anything"), null);
    const doc = parseFixture();
    assert.equal(flexCardById(doc, "not-a-listed-id"), null);
    assert.equal(flexCardById(doc, ""), null);
  });

  it("J2 the preview id resolves through the card even though /v1/models lacks it", () => {
    const doc = parseFixture();
    assert.ok(flexCardById(doc, "deepseek-v4.1-flash"));
  });
});
