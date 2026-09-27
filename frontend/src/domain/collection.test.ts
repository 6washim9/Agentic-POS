import { describe, expect, it } from "vitest";
import { applyCollection, deriveKhata } from "./collection";

describe("applyCollection", () => {
  it("reduces the balance", () => {
    const result = applyCollection(150000, 50000);
    expect(result.newBalance).toBe(100000);
    expect(result.isAdvance).toBe(false);
    expect(result.advanceDelta).toBe(0);
  });

  it("treats an exact settle as not an advance", () => {
    const result = applyCollection(3000, 3000);
    expect(result.newBalance).toBe(0);
    expect(result.isAdvance).toBe(false);
  });

  it("throws on an overpay without override", () => {
    expect(() => applyCollection(3000, 5000)).toThrow("advance exceeds dues");
  });

  it("allows an overpay with override and marks it advance", () => {
    const result = applyCollection(3000, 5000, true);
    expect(result.newBalance).toBe(-2000);
    expect(result.isAdvance).toBe(true);
    expect(result.advanceDelta).toBe(2000);
  });

  it("rejects a non-positive amount", () => {
    expect(() => applyCollection(3000, 0)).toThrow("amount must be positive");
    expect(() => applyCollection(3000, -10)).toThrow("amount must be positive");
  });
});

describe("deriveKhata", () => {
  it("debits only the sale remainder", () => {
    const khata = deriveKhata(
      600,
      [
        { id: "s1", amount: 1000, cash_paid: 400, on_credit: true, created_at: "2026-09-15T10:00:00" },
        { id: "s2", amount: 800, cash_paid: 800, on_credit: false, created_at: "2026-09-15T11:00:00" },
      ],
      [],
    );
    expect(khata.lines).toHaveLength(1);
    expect(khata.lines[0].kind).toBe("sale");
    expect(khata.lines[0].amount).toBe(600);
  });

  it("uses the seed balance as opening", () => {
    const khata = deriveKhata(150000, [], []);
    expect(khata.opening).toBe(150000);
    expect(khata.balance).toBe(150000);
  });

  it("running balance ends at the credit balance", () => {
    const khata = deriveKhata(
      5300,
      [
        { id: "s1", amount: 1000, cash_paid: 400, on_credit: true, created_at: "2026-09-15T10:00:00" },
        { id: "s2", amount: 5000, cash_paid: 0, on_credit: true, created_at: "2026-09-15T12:00:00" },
      ],
      [
        { id: "c1", amount: 300, is_advance: false, created_at: "2026-09-15T11:00:00" },
      ],
    );
    expect(khata.lines.map((line) => line.kind)).toEqual(["sale", "collection", "sale"]);
    expect(khata.lines[0].balance).toBe(600);
    expect(khata.lines[1].balance).toBe(300);
    expect(khata.lines[2].balance).toBe(5300);
    expect(khata.balance).toBe(5300);
  });
});
