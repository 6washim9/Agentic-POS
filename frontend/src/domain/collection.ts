export type CollectionResult = {
  newBalance: number;
  isAdvance: boolean;
  advanceDelta: number;
};

export function applyCollection(
  currentBalance: number,
  amount: number,
  confirmOverride = false,
): CollectionResult {
  if (amount <= 0) throw new Error("amount must be positive");
  if (amount > currentBalance && !confirmOverride) throw new Error("advance exceeds dues");
  const newBalance = currentBalance - amount;
  return {
    newBalance,
    isAdvance: newBalance < 0,
    advanceDelta: Math.max(amount - currentBalance, 0),
  };
}

export type CollectionSaleInput = {
  id: string;
  amount: number;
  cash_paid: number;
  on_credit: boolean;
  created_at: string;
};

export type CollectionEntry = {
  id: string;
  amount: number;
  is_advance: boolean;
  created_at: string;
};

export type KhataLine = {
  id: string;
  kind: "sale" | "collection";
  amount: number;
  createdAt: string;
  isAdvance: boolean;
  balance: number;
};

export type Khata = {
  opening: number;
  lines: KhataLine[];
  balance: number;
};

export function deriveKhata(
  creditBalance: number,
  sales: CollectionSaleInput[],
  collections: CollectionEntry[],
): Khata {
  type Raw = { at: string; id: string; delta: number; isAdvance: boolean; kind: "sale" | "collection" };
  const ledger: Raw[] = [];
  let debits = 0;
  let credits = 0;
  for (const sale of sales) {
    const paid = sale.cash_paid ?? (sale.on_credit ? 0 : sale.amount);
    const remainder = sale.amount - paid;
    if (remainder <= 0) continue;
    debits += remainder;
    ledger.push({ at: sale.created_at, id: sale.id, delta: remainder, isAdvance: false, kind: "sale" });
  }
  for (const collection of collections) {
    credits += collection.amount;
    ledger.push({
      at: collection.created_at,
      id: collection.id,
      delta: -collection.amount,
      isAdvance: collection.is_advance,
      kind: "collection",
    });
  }
  const opening = creditBalance - debits + credits;
  ledger.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const lines: KhataLine[] = [];
  let running = opening;
  for (const row of ledger) {
    running += row.delta;
    lines.push({
      id: row.id,
      kind: row.kind,
      amount: Math.abs(row.delta),
      createdAt: row.at,
      isAdvance: row.isAdvance,
      balance: running,
    });
  }
  return { opening, lines, balance: running };
}
