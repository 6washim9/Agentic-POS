import { describe, expect, it } from "vitest";
import { resolveEvents, type SyncEvent } from "./conflict";

const event = (partial: Partial<SyncEvent> & Pick<SyncEvent, "eventId" | "entityType" | "entityId" | "action">): SyncEvent => ({
  payload: {},
  deviceId: "a",
  occurredAt: 1,
  ...partial,
});

describe("resolveEvents", () => {
  it("appends stock adjustments instead of overwriting", () => {
    const resolved = resolveEvents(
      [
        event({
          eventId: "s1",
          entityType: "stock",
          entityId: "fuji",
          action: "adjust",
          payload: { delta: -10 },
          occurredAt: 1000,
        }),
        event({
          eventId: "s2",
          entityType: "stock",
          entityId: "fuji",
          action: "adjust",
          payload: { delta: -5 },
          deviceId: "b",
          occurredAt: 1001,
        }),
      ],
      { fuji: 100 },
    );
    expect(resolved["stock:fuji"].qty).toBe(85);
  });

  it("never overwrites concurrent credit entries", () => {
    const resolved = resolveEvents([
      event({
        eventId: "c1",
        entityType: "ledger",
        entityId: "rahim",
        action: "credit",
        payload: { amount: 50000 },
        occurredAt: 1000,
      }),
      event({
        eventId: "c2",
        entityType: "ledger",
        entityId: "rahim",
        action: "credit",
        payload: { amount: 20000 },
        deviceId: "b",
        occurredAt: 1002,
      }),
    ]);
    expect(resolved["ledger:rahim"].balance).toBe(70000);
  });

  it("treats duplicate event ids as idempotent", () => {
    const dup = event({
      eventId: "dup",
      entityType: "ledger",
      entityId: "rahim",
      action: "credit",
      payload: { amount: 1000 },
    });
    const resolved = resolveEvents([dup, dup]);
    expect(resolved["ledger:rahim"].balance).toBe(1000);
  });

  it("subtracts ledger payment events", () => {
    const resolved = resolveEvents([
      event({
        eventId: "p1",
        entityType: "ledger",
        entityId: "rahim",
        action: "payment",
        payload: { amount: 5000 },
        occurredAt: 1000,
      }),
      event({
        eventId: "p2",
        entityType: "ledger",
        entityId: "rahim",
        action: "payment",
        payload: { amount: 2000 },
        deviceId: "b",
        occurredAt: 1001,
      }),
    ]);
    expect(resolved["ledger:rahim"].balance).toBe(-7000);
  });

  it("nets credits and payments", () => {
    const resolved = resolveEvents([
      event({
        eventId: "c1",
        entityType: "ledger",
        entityId: "rahim",
        action: "credit",
        payload: { amount: 50000 },
        occurredAt: 1000,
      }),
      event({
        eventId: "p1",
        entityType: "ledger",
        entityId: "rahim",
        action: "payment",
        payload: { amount: 20000 },
        deviceId: "b",
        occurredAt: 1001,
      }),
    ]);
    expect(resolved["ledger:rahim"].balance).toBe(30000);
  });
});
