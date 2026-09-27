import { describe, expect, it } from "vitest";
import { applyLocalCollection, applyLocalSale, hydrateState } from "./offline";
import { defaultState } from "./seed";

describe("local sale outbox and split tender", () => {
  it("queues pending not boolean synced", () => {
    const result = applyLocalSale(defaultState(), {
      skuId: "fuji",
      customerId: "salma",
      cratesSold: 2,
      cratesReturned: 0,
      onCredit: false,
      cashPaid: 1000,
    });
    expect(result.sale).not.toBeNull();
    expect(result.state.queue.at(-1)?.status).toBe("pending");
    expect(result.sale?.cash_paid).toBe(1000);
    expect(result.sale?.on_credit).toBe(false);
  });

  it("puts remainder on baki and consumes FIFO lots", () => {
    const result = applyLocalSale(defaultState(), {
      skuId: "fuji",
      customerId: "salma",
      cratesSold: 10,
      cratesReturned: 0,
      onCredit: true,
      cashPaid: 2000,
    });
    expect(result.sale?.cash_paid).toBe(2000);
    expect(result.sale?.on_credit).toBe(true);
    expect(result.sale?.lots?.[0]).toEqual(["CH-100", 10]);
    const fuji = result.state.lots.find((lot) => lot.challan === "CH-100");
    expect(fuji?.remaining).toBe(410);
  });

  it("returns hitl without committing when credit limit exceeded", () => {
    const result = applyLocalSale(defaultState(), {
      skuId: "fuji",
      customerId: "salma",
      cratesSold: 200,
      cratesReturned: 0,
      onCredit: true,
      cashPaid: 0,
    });
    expect(result.hitl).toBe("credit_limit_override");
    expect(result.sale).toBeNull();
    expect(result.state.sales).toHaveLength(0);
  });
});

describe("local collection", () => {
  it("reduces balance and queues a ledger payment", () => {
    const result = applyLocalCollection(defaultState(), { customerId: "rahim", amount: 50000 });
    expect(result.collection).not.toBeNull();
    expect(result.collection?.is_advance).toBe(false);
    expect(result.collection?.customer_id).toBe("rahim");
    const customer = result.state.customers.find((c) => c.id === "rahim");
    expect(customer?.credit_balance).toBe(100000);
    const event = result.state.queue.at(-1);
    expect(event?.entityType).toBe("ledger");
    expect(event?.entityId).toBe("rahim");
    expect(event?.action).toBe("payment");
    expect(event?.payload).toEqual({ amount: 50000 });
    expect(result.state.kpis.cash_today).toBe(50000);
  });

  it("returns hitl for an overpay without override and does not commit", () => {
    const result = applyLocalCollection(defaultState(), { customerId: "rahim", amount: 200000 });
    expect(result.hitl).toBe("advance");
    expect(result.collection).toBeNull();
    expect(result.state.collections).toHaveLength(0);
  });

  it("allows an overpay with override as an advance", () => {
    const result = applyLocalCollection(defaultState(), {
      customerId: "rahim",
      amount: 200000,
      confirmOverride: true,
    });
    expect(result.collection?.is_advance).toBe(true);
    const customer = result.state.customers.find((c) => c.id === "rahim");
    expect(customer?.credit_balance).toBe(-50000);
  });
});

describe("hydrateState collection migration", () => {
  it("defaults collections and backfills catalog caps", () => {
    const base = defaultState();
    delete base.permissions.caps.enterer["agent.collection"];
    const hydrated = hydrateState(base);
    expect(hydrated.collections).toEqual([]);
    expect(hydrated.permissions.caps.enterer["agent.collection"]).toBe("allow");
    expect(hydrated.shift.collectionCash).toBe(0);
  });
});

describe("hydrate users", () => {
  it("seeds three users when the snapshot has none", () => {
    const next = hydrateState({ onboarded: true, users: undefined });
    expect(next.users.map((u) => u.id)).toEqual(["user-enterer", "user-owner", "user-admin"]);
  });

  it("keeps users the cashier already added", () => {
    const next = hydrateState({
      users: [
        {
          id: "u-1",
          prefix: "mrs",
          first_name: "Salma",
          email: "salma@arat.local",
          active: true,
          role: "owner",
          created_at: "2026-09-22T10:00:00.000Z",
        },
      ],
    });
    expect(next.users).toHaveLength(1);
    expect(next.users[0].email).toBe("salma@arat.local");
  });
});
