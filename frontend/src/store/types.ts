import type { Permissions, Role } from "../domain/rbac";
import type { ShopUser } from "../domain/user";

export type User = ShopUser;

export type Sku = {
  id: string;
  name: string;
  name_bn: string;
  photo: string;
  unit: string;
  stock: number;
  grade: string;
  location: string;
  unit_price: number;
  unit_cost: number;
  color: "green" | "red" | "yellow" | "orange" | string;
};

export type Customer = {
  id: string;
  name: string;
  name_bn: string;
  phone: string;
  credit_balance: number;
  crate_balance: number;
  credit_limit: number;
};

export type Sale = {
  id: string;
  sku_id: string;
  sku_name: string;
  customer_id: string;
  customer_name: string;
  qty: number;
  crates_returned: number;
  amount: number;
  cash_paid: number;
  on_credit: boolean;
  lots?: [string, number][];
  created_at: string;
  receipt: string;
};

export type Reminder = {
  id: string;
  customer_id: string;
  channel: string;
  amount: number;
  created_at: string;
  audio_bn: string;
  audio_en: string;
  status: string;
};

export type Collection = {
  id: string;
  customer_id: string;
  customer_name: string;
  amount: number;
  note?: string;
  is_advance: boolean;
  created_at: string;
};

export type Kpis = {
  cash_today: number;
  credit_today: number;
  outstanding_dues: number;
  warehouse_stock: number;
  spoilage_qty: number;
  spoilage_loss: number;
  pending_events: number;
};

export type ShopConfig = {
  language: "bn" | "en";
  manage_crates: boolean;
  extend_credit: boolean;
  cold_storage: boolean;
  shop_name: string;
};

export type QueuedEvent = {
  eventId: string;
  entityType: string;
  entityId: string;
  action: string;
  payload: Record<string, unknown>;
  deviceId: string;
  occurredAt: number;
  status: "pending" | "synced" | "rejected";
  reason?: string;
  synced?: boolean;
};

export type ShiftState = {
  cashier: string;
  floatAmount: number;
  status: "open" | "closed";
  cashCollected: number;
  creditIssued: number;
  zTotal: number;
  expectedDrawer: number;
  collectionCash: number;
};

export type Lot = {
  sku_id: string;
  challan: string;
  remaining: number;
  unit_cost: number;
  received_at: number;
};

export type Session = { role: Role };

export type AppState = {
  config: ShopConfig;
  skus: Sku[];
  customers: Customer[];
  sales: Sale[];
  reminders: Reminder[];
  collections: Collection[];
  users: User[];
  kpis: Kpis;
  queue: QueuedEvent[];
  lots: Lot[];
  shift: ShiftState;
  onboarded: boolean;
  online: boolean;
  session: Session;
  permissions: Permissions;
};

export type Screen =
  | "home"
  | "catalog"
  | "sale"
  | "ledger"
  | "warehouse"
  | "landed"
  | "spoilage"
  | "wizard"
  | "receipt"
  | "shift"
  | "settings"
  | "admin"
  | "users";
