import { applyCollection } from "../domain/collection";
import { applyDualAssetSale } from "../domain/crateLedger";
import { computeLandedCost } from "../domain/landedCost";
import { parseVoiceCommand } from "../domain/nlp";
import { backfillCaps } from "../domain/rbac";
import { applySplitTender } from "../domain/splitTender";
import { decryptJson, encryptJson } from "./crypto";
import { CRYPTO_SECRET, defaultState, DEVICE_ID } from "./seed";
import type { AppState, Collection, Customer, Lot, QueuedEvent, Sale, Sku } from "./types";

const STORAGE_KEY = "arat-pos.aes256";

function recalc(state: AppState): AppState {
  const cash =
    state.sales.reduce((n, s) => n + (s.cash_paid ?? (s.on_credit ? 0 : s.amount)), 0) +
    (state.collections ?? []).reduce((n, c) => n + c.amount, 0);
  const credit = state.sales.reduce((n, s) => {
    const paid = s.cash_paid ?? (s.on_credit ? 0 : s.amount);
    return n + Math.max(s.amount - paid, 0);
  }, 0);
  const dues = state.customers.reduce((n, c) => n + c.credit_balance, 0);
  const warehouse = state.skus
    .filter((s) => s.location === "cold" || s.location === "gudam")
    .reduce((n, s) => n + s.stock, 0);
  const spoilageQty = state.skus
    .filter((s) => s.location === "spoil" || s.grade === "C")
    .reduce((n, s) => n + s.stock, 0);
  return {
    ...state,
    kpis: {
      ...state.kpis,
      cash_today: cash,
      credit_today: credit,
      outstanding_dues: dues,
      warehouse_stock: warehouse,
      spoilage_qty: spoilageQty,
      pending_events: state.queue.filter((e) => e.status === "pending" || (!e.status && !e.synced)).length,
    },
  };
}

function queueEvent(
  state: AppState,
  entityType: string,
  entityId: string,
  action: string,
  payload: Record<string, unknown>,
): AppState {
  const event: QueuedEvent = {
    eventId: crypto.randomUUID(),
    entityType,
    entityId,
    action,
    payload,
    deviceId: DEVICE_ID,
    occurredAt: Date.now(),
    status: "pending",
  };
  return recalc({ ...state, queue: [...state.queue, event] });
}

export function hydrateState(raw: Partial<AppState> | null | undefined): AppState {
  const base = defaultState();
  if (!raw) return base;
  const queue = (raw.queue ?? []).map((item) => ({
    ...item,
    status: item.status ?? (item.synced ? "synced" : "pending"),
  }));
  return recalc({
    ...base,
    ...raw,
    config: { ...base.config, ...raw.config },
    skus: raw.skus ?? base.skus,
    customers: raw.customers ?? base.customers,
    sales: (raw.sales ?? []).map((sale) => ({
      ...sale,
      cash_paid: sale.cash_paid ?? (sale.on_credit ? 0 : sale.amount),
    })),
    reminders: raw.reminders ?? [],
    collections: raw.collections ?? [],
    users: raw.users ?? base.users,
    queue,
    lots: raw.lots ?? base.lots,
    shift: raw.shift
      ? { ...base.shift, ...raw.shift, collectionCash: raw.shift.collectionCash ?? 0 }
      : base.shift,
    session: { role: raw.session?.role ?? "enterer" },
    permissions: {
      caps: backfillCaps(raw.permissions?.caps ?? base.permissions.caps),
      owner: raw.permissions?.owner ?? {},
      occurredAt:
        raw.permissions?.occurredAt ??
        (raw.permissions as { occurred_at?: number } | undefined)?.occurred_at ??
        0,
    },
    onboarded: Boolean(raw.onboarded),
    online: typeof navigator === "undefined" ? true : navigator.onLine,
  });
}

export async function loadPersisted(): Promise<AppState | null> {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return hydrateState(await decryptJson<AppState>(raw, CRYPTO_SECRET));
  } catch {
    return null;
  }
}

export async function persistState(state: AppState): Promise<void> {
  const packed = await encryptJson(state, CRYPTO_SECRET);
  localStorage.setItem(STORAGE_KEY, packed);
}

export function skuColor(sku: Sku): Sku["color"] {
  if (sku.grade === "C" || sku.location === "spoil") return "orange";
  if (sku.location === "cold" || sku.location === "gudam") return "yellow";
  return "green";
}

function allocateLots(lots: Lot[], skuId: string, qty: number): { lots: Lot[]; consumed: [string, number][] } {
  let remainingNeed = qty;
  const consumed: [string, number][] = [];
  const nextLots: Lot[] = [];
  const ordered = [...lots].sort((a, b) => {
    const skuRank = Number(a.sku_id !== skuId) - Number(b.sku_id !== skuId);
    if (skuRank !== 0) return skuRank;
    return a.received_at - b.received_at;
  });
  for (const lot of ordered) {
    if (lot.sku_id !== skuId || remainingNeed <= 0) {
      nextLots.push(lot);
      continue;
    }
    const take = Math.min(lot.remaining, remainingNeed);
    consumed.push([lot.challan, take]);
    const leftover = lot.remaining - take;
    remainingNeed -= take;
    if (leftover > 0) nextLots.push({ ...lot, remaining: leftover });
  }
  if (remainingNeed > 0) throw new Error("insufficient lot stock");
  return { lots: nextLots, consumed };
}

export function applyLocalSale(
  state: AppState,
  input: {
    skuId: string;
    customerId: string;
    cratesSold: number;
    cratesReturned: number;
    onCredit: boolean;
    cashPaid?: number;
    confirmOverride?: boolean;
  },
): { state: AppState; sale: Sale | null; tts: { bn: string; en: string }; hitl?: string } {
  const sku = state.skus.find((s) => s.id === input.skuId);
  const customer = state.customers.find((c) => c.id === input.customerId);
  if (!sku || !customer) throw new Error("SKU or customer not found");
  const total = sku.unit_price * input.cratesSold;
  const cashPaid = input.cashPaid ?? (input.onCredit ? 0 : total);
  const split = applySplitTender(total, cashPaid);
  const projected = customer.credit_balance + split.creditDelta;
  if (split.onCredit && projected > customer.credit_limit && !input.confirmOverride) {
    return { state, sale: null, tts: { bn: "", en: "" }, hitl: "credit_limit_override" };
  }
  const result = applyDualAssetSale({
    productStockBefore: sku.stock,
    crateBalanceBefore: customer.crate_balance,
    cratesSold: input.cratesSold,
    cratesReturned: input.cratesReturned,
    unitPrice: sku.unit_price,
    onCredit: split.onCredit,
  });
  const allocated = allocateLots(state.lots, sku.id, input.cratesSold);
  const nextSku: Sku = { ...sku, stock: result.productStockAfter, color: skuColor({ ...sku, stock: result.productStockAfter }) };
  const nextCustomer: Customer = {
    ...customer,
    crate_balance: result.crateBalanceAfter,
    credit_balance: customer.credit_balance + split.creditDelta,
  };
  const sale: Sale = {
    id: crypto.randomUUID(),
    sku_id: sku.id,
    sku_name: sku.name,
    customer_id: customer.id,
    customer_name: customer.name,
    qty: input.cratesSold,
    crates_returned: input.cratesReturned,
    amount: result.saleAmount,
    cash_paid: split.cashPaid,
    on_credit: split.onCredit,
    lots: allocated.consumed,
    created_at: new Date().toISOString(),
    receipt: `${state.config.shop_name}\n${customer.name}\n${input.cratesSold} crate ${sku.name}\n${result.saleAmount} Taka ${split.onCredit ? "BAKI" : "CASH"}\ncash ${split.cashPaid}`,
  };
  const tts = split.onCredit
    ? {
        bn: `সংরক্ষিত। ${customer.name_bn} এর খাতায় ${input.cratesSold} ক্রেট ${sku.name_bn} এবং ${split.creditDelta} টাকা বাকি যোগ হয়েছে। বর্তমান ব্যালেন্স ${nextCustomer.credit_balance} টাকা।`,
        en: `Saved. Added ${input.cratesSold} crates of ${sku.name} and ${split.creditDelta} Taka credit to ${customer.name}'s ledger. Current balance is ${nextCustomer.credit_balance} Taka.`,
      }
    : {
        bn: `সংরক্ষিত। ${input.cratesSold} ক্রেট ${sku.name_bn} নগদ ${result.saleAmount} টাকায় বিক্রি হয়েছে।`,
        en: `Saved. Sold ${input.cratesSold} crates of ${sku.name} for ${result.saleAmount} Taka cash.`,
      };
  let next = {
    ...state,
    skus: state.skus.map((s) => (s.id === sku.id ? nextSku : s)),
    customers: state.customers.map((c) => (c.id === customer.id ? nextCustomer : c)),
    sales: [...state.sales, sale],
    lots: allocated.lots,
  };
  next = queueEvent(next, "sale", sale.id, "create", sale as unknown as Record<string, unknown>);
  return { state: next, sale, tts };
}

export function applyLocalLanded(
  state: AppState,
  input: {
    skuId: string;
    crates: number;
    baseProcurement: number;
    customsDuty: number;
    freight: number;
    portClearance: number;
    transport: number;
    challan?: string;
  },
): AppState {
  const result = computeLandedCost(input);
  const challan = input.challan || `CH-${Date.now()}`;
  const lot: Lot = {
    sku_id: input.skuId,
    challan,
    remaining: input.crates,
    unit_cost: result.unitCostPerCrate,
    received_at: Date.now(),
  };
  const next = {
    ...state,
    skus: state.skus.map((sku) =>
      sku.id === input.skuId
        ? {
            ...sku,
            stock: sku.stock + input.crates,
            unit_cost: result.unitCostPerCrate,
            location: state.config.cold_storage ? "cold" : "gudam",
            color: "yellow" as const,
          }
        : sku,
    ),
    lots: [...state.lots, lot],
  };
  return queueEvent(next, "lot", input.skuId, "landed", { ...input, challan, unitCost: result.unitCostPerCrate });
}

export function applyLocalSpoilage(
  state: AppState,
  input: { skuId: string; qty: number; toGrade: string; writeOff: boolean },
): { state: AppState; tts: { bn: string; en: string } } {
  const sku = state.skus.find((s) => s.id === input.skuId);
  if (!sku) throw new Error("SKU not found");
  if (input.qty > sku.stock) throw new Error("insufficient stock");
  const loss = input.writeOff ? sku.unit_cost * input.qty : 0;
  const remaining = input.writeOff ? sku.stock - input.qty : sku.stock;
  const nextSku: Sku = {
    ...sku,
    stock: remaining,
    grade: input.toGrade,
    location: input.toGrade === "C" || input.writeOff ? "spoil" : sku.location,
    color: input.toGrade === "C" || input.writeOff ? "orange" : sku.color,
  };
  let next = {
    ...state,
    skus: state.skus.map((s) => (s.id === sku.id ? nextSku : s)),
    kpis: { ...state.kpis, spoilage_loss: state.kpis.spoilage_loss + loss },
  };
  next = queueEvent(next, "spoilage", sku.id, "log", { qty: input.qty, grade: input.toGrade, loss });
  return {
    state: next,
    tts: {
      bn: `সংরক্ষিত। ${input.qty} ক্রেট ${sku.name_bn} গ্রেড ${input.toGrade} হিসেবে লগ হয়েছে। ক্ষতি ${Math.round(loss)} টাকা।`,
      en: `Saved. Logged ${input.qty} crates of ${sku.name} as grade ${input.toGrade}. Loss ${Math.round(loss)} Taka.`,
    },
  };
}

export function applyLocalCollection(
  state: AppState,
  input: { customerId: string; amount: number; note?: string; confirmOverride?: boolean },
): { state: AppState; collection: Collection | null; tts: { bn: string; en: string }; hitl?: string } {
  const customer = state.customers.find((c) => c.id === input.customerId);
  if (!customer) throw new Error("customer not found");
  let result;
  try {
    result = applyCollection(customer.credit_balance, input.amount, input.confirmOverride);
  } catch (err) {
    if (err instanceof Error && err.message === "advance exceeds dues" && !input.confirmOverride) {
      return { state, collection: null, tts: { bn: "", en: "" }, hitl: "advance" };
    }
    throw err;
  }
  const collection: Collection = {
    id: crypto.randomUUID(),
    customer_id: customer.id,
    customer_name: customer.name,
    amount: input.amount,
    note: input.note,
    is_advance: result.isAdvance,
    created_at: new Date().toISOString(),
  };
  const nextCustomer: Customer = { ...customer, credit_balance: result.newBalance };
  let next: AppState = {
    ...state,
    customers: state.customers.map((c) => (c.id === customer.id ? nextCustomer : c)),
    collections: [...state.collections, collection],
  };
  next = queueEvent(next, "ledger", customer.id, "payment", { amount: input.amount });
  const tts = result.isAdvance
    ? {
        bn: `সংরক্ষিত। ${customer.name_bn} এর কাছে ${input.amount} টাকা অগ্রিম জমা নেওয়া হয়েছে। ব্যালেন্স ${result.newBalance} টাকা।`,
        en: `Saved. Collected ${input.amount} Taka advance from ${customer.name}. Balance ${result.newBalance} Taka.`,
      }
    : {
        bn: `সংরক্ষিত। ${customer.name_bn} এর কাছে ${input.amount} টাকা জমা হয়েছে। বাকি ${result.newBalance} টাকা।`,
        en: `Saved. Collected ${input.amount} Taka from ${customer.name}. Remaining ${result.newBalance} Taka.`,
      };
  return { state: next, collection, tts };
}

export function applyLocalReminder(state: AppState, customerId: string, channel: "sms" | "whatsapp"): AppState {
  const customer = state.customers.find((c) => c.id === customerId);
  if (!customer) throw new Error("customer not found");
  const note = {
    id: crypto.randomUUID(),
    customer_id: customer.id,
    channel,
    amount: customer.credit_balance,
    created_at: new Date().toISOString(),
    audio_bn: `${customer.name_bn}, আপনার বাকি ${Math.round(customer.credit_balance)} টাকা। অনুগ্রহ করে পরিশোধ করুন।`,
    audio_en: `${customer.name}, your outstanding baki is ${Math.round(customer.credit_balance)} Taka. Please settle.`,
    status: "queued",
  };
  return queueEvent({ ...state, reminders: [...state.reminders, note] }, "reminder", note.id, "queue", note);
}

export function matchVoiceToIds(state: AppState, utterance: string) {
  const parsed = parseVoiceCommand(utterance);
  const skuName = String(parsed.entities.sku ?? "").toLowerCase();
  const customerName = String(parsed.entities.customer ?? "").toLowerCase();
  const sku = state.skus.find(
    (s) => s.name.toLowerCase().includes(skuName) || s.id.includes(skuName) || skuName.includes(s.id),
  ) ?? state.skus.find((s) => skuName && s.name.toLowerCase().includes(skuName.split(" ")[0] ?? ""));
  const customer = state.customers.find(
    (c) => c.name.toLowerCase().includes(customerName) || c.id.includes(customerName),
  );
  return { parsed, sku, customer };
}

export { defaultState, DEVICE_ID, recalc };
