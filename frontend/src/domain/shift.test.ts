import { describe, expect, it } from "vitest";
import { closeShift, openShift } from "./shift";

describe("shift z-report", () => {
  it("drawer equals float plus cash collected", () => {
    const shift = openShift("Karim", 2000, 1);
    const closed = closeShift(
      shift,
      [
        { amount: 1000, cashPaid: 400 },
        { amount: 800, cashPaid: 800 },
      ],
      2,
    );
    expect(closed.cashCollected).toBe(1200);
    expect(closed.creditIssued).toBe(600);
    expect(closed.expectedDrawer).toBe(3200);
    expect(closed.status).toBe("closed");
  });

  it("includes collection cash in the drawer", () => {
    const shift = openShift("Karim", 2000, 1);
    const closed = closeShift(shift, [{ amount: 1000, cashPaid: 400 }], 2, [5000, 2000]);
    expect(closed.collectionCash).toBe(7000);
    expect(closed.cashCollected).toBe(7400);
    expect(closed.expectedDrawer).toBe(9400);
    expect(closed.zTotal).toBe(1000);
    expect(closed.creditIssued).toBe(600);
  });

  it("defaults collection cash to zero", () => {
    const shift = openShift("Karim", 2000, 1);
    const closed = closeShift(shift, [], 2);
    expect(closed.collectionCash).toBe(0);
    expect(closed.expectedDrawer).toBe(2000);
  });
});
