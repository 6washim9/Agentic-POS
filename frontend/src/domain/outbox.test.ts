import { describe, expect, it } from "vitest";
import { applyAck, pendingOnly, type OutboxItem } from "./outbox";

const item = (id: string, status: OutboxItem["status"] = "pending"): OutboxItem => ({
  localId: id,
  entityType: "sale",
  entityId: id,
  action: "create",
  payload: { amount: 1 },
  deviceId: "yard",
  occurredAt: 1,
  status,
});

describe("outbox ack", () => {
  it("only retries pending records", () => {
    const pending = pendingOnly([item("a"), item("b", "synced"), item("c", "rejected")]);
    expect(pending.map((row) => row.localId)).toEqual(["a"]);
  });

  it("marks accepted and rejected per record not per batch", () => {
    const next = applyAck([item("ok"), item("bad")], {
      accepted: [{ local_id: "ok", remote_id: "ok" }],
      rejected: [{ local_id: "bad", reason: "invalid_amount" }],
    });
    expect(next.find((row) => row.localId === "ok")?.status).toBe("synced");
    expect(next.find((row) => row.localId === "bad")?.status).toBe("rejected");
    expect(next.find((row) => row.localId === "bad")?.reason).toBe("invalid_amount");
  });
});
