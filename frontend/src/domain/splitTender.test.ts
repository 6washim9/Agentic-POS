import { describe, expect, it } from "vitest";
import { applySplitTender } from "./splitTender";

describe("split tender", () => {
  it("puts remainder on baki", () => {
    const result = applySplitTender(50000, 20000);
    expect(result.cashPaid).toBe(20000);
    expect(result.creditDelta).toBe(30000);
    expect(result.onCredit).toBe(true);
  });

  it("rejects overpay", () => {
    expect(() => applySplitTender(100, 150)).toThrow(/cash/i);
  });
});
