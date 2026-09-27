import type { Sale } from "../store/types";

export type PaymentStatus = "paid" | "due" | "partial";
export type PaymentMethod = "cash" | "baki" | "split";

export function salePaid(sale: Sale): number {
  return sale.cash_paid ?? (sale.on_credit ? 0 : sale.amount);
}

export function saleDue(sale: Sale): number {
  return Math.max(sale.amount - salePaid(sale), 0);
}

export function paymentStatus(sale: Sale): PaymentStatus {
  const due = saleDue(sale);
  if (due <= 0) return "paid";
  if (salePaid(sale) <= 0) return "due";
  return "partial";
}

export function paymentMethod(sale: Sale): PaymentMethod {
  const paid = salePaid(sale);
  const due = saleDue(sale);
  if (due <= 0) return "cash";
  if (paid <= 0) return "baki";
  return "split";
}

export function recentSales(sales: Sale[], limit = 8): Sale[] {
  return [...sales].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, limit);
}

function toDateKey(iso: string): string {
  return iso.slice(0, 10);
}

function shiftDay(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function salesByDay(sales: Sale[], days: number, asOf: Date): { date: string; total: number }[] {
  const end = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  const buckets: { date: string; total: number }[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    buckets.push({ date: ymd(shiftDay(end, -i)), total: 0 });
  }
  const index = new Map(buckets.map((bucket, i) => [bucket.date, i]));
  for (const sale of sales) {
    const key = toDateKey(sale.created_at);
    const slot = index.get(key);
    if (slot === undefined) continue;
    buckets[slot].total += sale.amount;
  }
  return buckets;
}

export function topProducts(sales: Sale[]): { skuId: string; name: string; qty: number; amount: number }[] {
  const map = new Map<string, { skuId: string; name: string; qty: number; amount: number }>();
  for (const sale of sales) {
    const current = map.get(sale.sku_id) ?? { skuId: sale.sku_id, name: sale.sku_name, qty: 0, amount: 0 };
    current.qty += sale.qty;
    current.amount += sale.amount;
    map.set(sale.sku_id, current);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

export function formatTaka(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function duesShare(outstanding: number, collected: number): { due: number; collected: number } {
  const total = outstanding + collected;
  if (total <= 0) return { due: 0, collected: 0 };
  const due = Math.round((outstanding / total) * 100);
  return { due, collected: 100 - due };
}
