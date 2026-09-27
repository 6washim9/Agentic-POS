export type SaleLine = {
  amount: number;
  cashPaid: number;
};

export type Shift = {
  cashier: string;
  floatAmount: number;
  openedAt: number;
  status: "open" | "closed";
  cashCollected: number;
  creditIssued: number;
  zTotal: number;
  expectedDrawer: number;
  collectionCash: number;
  closedAt: number | null;
};

export function openShift(cashier: string, floatAmount: number, openedAt: number): Shift {
  if (floatAmount < 0) throw new Error("float cannot be negative");
  return {
    cashier,
    floatAmount,
    openedAt,
    status: "open",
    cashCollected: 0,
    creditIssued: 0,
    zTotal: 0,
    expectedDrawer: floatAmount,
    collectionCash: 0,
    closedAt: null,
  };
}

export function closeShift(
  shift: Shift,
  sales: SaleLine[],
  closedAt: number,
  collections: number[] = [],
): Shift {
  const collectionCash = collections.reduce((n, amount) => n + amount, 0);
  const cashCollected = sales.reduce((n, line) => n + line.cashPaid, 0) + collectionCash;
  const zTotal = sales.reduce((n, line) => n + line.amount, 0);
  const creditIssued = sales.reduce((n, line) => n + Math.max(line.amount - line.cashPaid, 0), 0);
  return {
    ...shift,
    status: "closed",
    cashCollected,
    creditIssued,
    zTotal,
    expectedDrawer: shift.floatAmount + cashCollected,
    collectionCash,
    closedAt,
  };
}
