import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeMwh, costPer1kUsd, costPerRequestUsd, humanizeAge, formatMwh, formatCostPer1k } from "../src/core/energy";

describe("energy.normalizeMwh", () => {
  it("strips ~ and normalizes mWh", () => {
    assert.equal(normalizeMwh("~218.01 mWh"), 218.01);
    assert.equal(normalizeMwh("245.48 mWh"), 245.48);
  });
  it("converts Wh ×1e3", () => {
    assert.equal(normalizeMwh("1.73 Wh"), 1730);
    assert.equal(normalizeMwh("0.5 Wh"), 500);
  });
  it("converts kWh ×1e6", () => {
    assert.equal(normalizeMwh("0.002 kWh"), 2000);
    assert.equal(normalizeMwh("1 kWh"), 1e6);
  });
  it("treats en-dash / em-dash as null", () => {
    assert.equal(normalizeMwh("—"), null);
    assert.equal(normalizeMwh("–"), null);
    assert.equal(normalizeMwh("-"), null);
    assert.equal(normalizeMwh("—"), null);
  });
  it("returns null when Gathering data / missing", () => {
    assert.equal(normalizeMwh(""), null);
    assert.equal(normalizeMwh(null), null);
    assert.equal(normalizeMwh("Gathering data"), null);
  });
  it("strips · and ~ debris", () => {
    assert.equal(normalizeMwh("~218.01 mWh · 88% cache"), 218.01);
  });
});

describe("energy.cost helpers", () => {
  it("costPer1kUsd = mwh * tariff / 1000", () => {
    const close = (a: number | null, b: number) => assert.ok(a != null && Math.abs(a - b) < 1e-9, `${a} ~ ${b}`);
    close(costPer1kUsd(245.48, 10), 2.4548);
    close(costPer1kUsd(1000, 10), 10);
    assert.equal(costPer1kUsd(null, 10), null);
  });
  it("costPer1k respects custom tariff", () => {
    const close = (a: number | null, b: number) => assert.ok(a != null && Math.abs(a - b) < 1e-9);
    close(costPer1kUsd(200, 8), 1.6);
    close(costPer1kUsd(200, 12), 2.4);
  });
  it("costPerRequest = mwh * tariff / 1e6", () => {
    const close = (a: number | null, b: number) => assert.ok(a != null && Math.abs(a - b) < 1e-9, `${a} ~ ${b}`);
    close(costPerRequestUsd(245.48, 10), 0.0024548);
    assert.equal(costPerRequestUsd(null, 10), null);
  });
});

describe("energy.formatMwh", () => {
  it("formats sub-1000 values as mWh with 2 decimals", () => {
    assert.equal(formatMwh(999.99), "999.99 mWh");
    assert.equal(formatMwh(0), "0.00 mWh");
  });
  it("formats values >= 1000 as Wh with 2 decimals", () => {
    assert.equal(formatMwh(1000), "1.00 Wh");
    assert.equal(formatMwh(1920), "1.92 Wh");
  });
  it("formats null as dash", () => {
    assert.equal(formatMwh(null), "-");
  });
});
describe("energy.humanizeAge", () => {
  it("just now <60s", () => {
    const now = new Date("2026-08-28T12:00:30.000Z");
    const then = "2026-08-28T12:00:00.000Z";
    assert.equal(humanizeAge(then, now), "just now");
  });
  it("minutes", () => {
    const now = new Date("2026-08-28T12:30:00.000Z");
    assert.equal(humanizeAge("2026-08-28T12:00:00.000Z", now), "30m ago");
  });
  it("hours", () => {
    const now = new Date("2026-08-28T15:00:00.000Z");
    assert.equal(humanizeAge("2026-08-28T12:00:00.000Z", now), "3h ago");
  });
  it("days", () => {
    const now = new Date("2026-08-30T12:00:00.000Z");
    assert.equal(humanizeAge("2026-08-28T12:00:00.000Z", now), "2d ago");
  });
  it("unknown for invalid date", () => {
    assert.equal(humanizeAge("not-a-date"), "unknown");
  });
});
