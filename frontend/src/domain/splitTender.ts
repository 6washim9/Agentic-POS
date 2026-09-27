export function applySplitTender(total: number, cashPaid: number): { cashPaid: number; creditDelta: number; onCredit: boolean } {
  if (cashPaid < 0) throw new Error("cash cannot be negative");
  if (cashPaid > total) throw new Error("cash exceeds sale total");
  const creditDelta = total - cashPaid;
  return { cashPaid, creditDelta, onCredit: creditDelta > 0 };
}
