import { describe, expect, it } from "vitest";
import { computeLandedCost } from "./landedCost";

describe("computeLandedCost", () => {
  it("aggregates procurement duties freight and clearance", () => {
    const result = computeLandedCost({
      crates: 100,
      baseProcurement: 40000,
      customsDuty: 5000,
      freight: 3000,
      portClearance: 2000,
      transport: 1000,
    });
    expect(result.totalLanded).toBe(51000);
    expect(result.unitCostPerCrate).toBe(510);
  });

  it("raises when crate count is zero", () => {
    expect(() =>
      computeLandedCost({
        crates: 0,
        baseProcurement: 1000,
        customsDuty: 0,
        freight: 0,
        portClearance: 0,
        transport: 0,
      }),
    ).toThrow(/crates/i);
  });
});
