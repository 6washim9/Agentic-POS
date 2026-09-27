import { describe, expect, it } from "vitest";
import { applyDualAssetSale } from "./crateLedger";

describe("applyDualAssetSale", () => {
  it("atomically tracks product volume and returnable crates", () => {
    const result = applyDualAssetSale({
      productStockBefore: 500,
      crateBalanceBefore: 40,
      cratesSold: 100,
      cratesReturned: 20,
      unitPrice: 500,
      onCredit: true,
    });
    expect(result.productStockAfter).toBe(400);
    expect(result.crateBalanceAfter).toBe(120);
    expect(result.saleAmount).toBe(50000);
    expect(result.creditDelta).toBe(50000);
  });

  it("does not increase credit on cash sale", () => {
    const result = applyDualAssetSale({
      productStockBefore: 50,
      crateBalanceBefore: 0,
      cratesSold: 10,
      cratesReturned: 10,
      unitPrice: 200,
      onCredit: false,
    });
    expect(result.crateBalanceAfter).toBe(0);
    expect(result.creditDelta).toBe(0);
  });
});
