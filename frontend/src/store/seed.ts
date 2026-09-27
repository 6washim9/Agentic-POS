import { defaultPermissions } from "../domain/rbac";
import type { AppState } from "./types";

export const DEVICE_ID = "yard-device-1";
export const CRYPTO_SECRET = "arat-pos-local-aes256";

export const defaultState = (): AppState => ({
  onboarded: false,
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  config: {
    language: "bn",
    manage_crates: true,
    extend_credit: true,
    cold_storage: true,
    shop_name: "Badamtoli Arat",
  },
  skus: [
    { id: "fuji", name: "Fuji Apples", name_bn: "ফুজি আপেল", photo: "apple", unit: "crate", stock: 420, grade: "A", location: "cold", unit_price: 500, unit_cost: 380, color: "yellow" },
    { id: "mango", name: "Himsagar Mango", name_bn: "হিমসাগর আম", photo: "mango", unit: "crate", stock: 180, grade: "A", location: "yard", unit_price: 1200, unit_cost: 900, color: "green" },
    { id: "banana", name: "Sagor Banana", name_bn: "সাগর কলা", photo: "banana", unit: "crate", stock: 90, grade: "B", location: "gudam", unit_price: 350, unit_cost: 220, color: "yellow" },
    { id: "orange", name: "Malta Orange", name_bn: "মাল্টা কমলা", photo: "orange", unit: "crate", stock: 24, grade: "C", location: "spoil", unit_price: 280, unit_cost: 210, color: "orange" },
    { id: "grape", name: "Red Grapes", name_bn: "লাল আঙ্গুর", photo: "grape", unit: "crate", stock: 60, grade: "A", location: "cold", unit_price: 900, unit_cost: 640, color: "yellow" },
    { id: "pomegranate", name: "Pomegranate", name_bn: "ডালিম", photo: "pomegranate", unit: "crate", stock: 48, grade: "A", location: "yard", unit_price: 1100, unit_cost: 780, color: "green" },
  ],
  customers: [
    { id: "rahim", name: "Rahim Aratdar", name_bn: "রহিম আড়তদার", phone: "+8801711000001", credit_balance: 150000, crate_balance: 40, credit_limit: 300000 },
    { id: "karim", name: "Karim Mahajon", name_bn: "করিম মহাজন", phone: "+8801711000002", credit_balance: 42000, crate_balance: 12, credit_limit: 120000 },
    { id: "salma", name: "Salma Traders", name_bn: "সালমা ট্রেডার্স", phone: "+8801711000003", credit_balance: 0, crate_balance: 0, credit_limit: 80000 },
  ],
  sales: [],
  reminders: [],
  collections: [],
  users: [
    { id: "user-enterer", prefix: "mr", first_name: "Enterer", email: "enterer@arat.local", active: true, role: "enterer", created_at: "2026-09-15T00:00:00.000Z" },
    { id: "user-owner", prefix: "mrs", first_name: "Owner", email: "owner@arat.local", active: true, role: "owner", created_at: "2026-09-15T00:00:00.000Z" },
    { id: "user-admin", prefix: "mr", first_name: "Super Admin", email: "admin@arat.local", active: true, role: "super_admin", created_at: "2026-09-15T00:00:00.000Z" },
  ],
  kpis: {
    cash_today: 0,
    credit_today: 0,
    outstanding_dues: 192000,
    warehouse_stock: 570,
    spoilage_qty: 24,
    spoilage_loss: 0,
    pending_events: 0,
  },
  queue: [],
  lots: [
    { sku_id: "fuji", challan: "CH-100", remaining: 420, unit_cost: 380, received_at: 1 },
    { sku_id: "mango", challan: "CH-200", remaining: 180, unit_cost: 900, received_at: 1 },
    { sku_id: "banana", challan: "CH-300", remaining: 90, unit_cost: 220, received_at: 1 },
    { sku_id: "orange", challan: "CH-400", remaining: 24, unit_cost: 210, received_at: 1 },
    { sku_id: "grape", challan: "CH-500", remaining: 60, unit_cost: 640, received_at: 1 },
    { sku_id: "pomegranate", challan: "CH-600", remaining: 48, unit_cost: 780, received_at: 1 },
  ],
  shift: {
    cashier: "Yard",
    floatAmount: 5000,
    status: "open",
    cashCollected: 0,
    creditIssued: 0,
      zTotal: 0,
      expectedDrawer: 5000,
      collectionCash: 0,
    },
  session: { role: "enterer" },
  permissions: defaultPermissions(),
});
