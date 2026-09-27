import { applyAck } from "../domain/outbox";
import type { AppState, QueuedEvent } from "./types";

function roleHeaders(role?: string, json = false): Record<string, string> {
  const headers: Record<string, string> = { "X-Role": role ?? "enterer" };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

export async function fetchBootstrap(role?: string): Promise<Partial<AppState> | null> {
  try {
    const res = await fetch("/api/bootstrap", { headers: roleHeaders(role) });
    if (!res.ok) return null;
    return (await res.json()) as Partial<AppState>;
  } catch {
    return null;
  }
}

function toOutbox(item: QueuedEvent) {
  return {
    localId: item.eventId,
    entityType: item.entityType,
    entityId: item.entityId,
    action: item.action,
    payload: item.payload,
    deviceId: item.deviceId,
    occurredAt: item.occurredAt,
    status: item.status ?? (item.synced ? "synced" : "pending"),
    reason: item.reason,
  };
}

export async function pushQueue(state: AppState, role?: string): Promise<QueuedEvent[] | null> {
  const pending = state.queue.filter((e) => (e.status ?? (e.synced ? "synced" : "pending")) === "pending");
  if (!pending.length) return state.queue;
  try {
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: roleHeaders(role ?? state.session.role, true),
      body: JSON.stringify({
        events: pending.map((e) => ({
          event_id: e.eventId,
          local_id: e.eventId,
          entity_type: e.entityType,
          entity_id: e.entityId,
          action: e.action,
          payload: e.payload,
          device_id: e.deviceId,
          occurred_at: e.occurredAt,
        })),
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      accepted?: { local_id: string; remote_id: string; duplicate?: boolean }[];
      rejected?: { local_id: string; reason: string }[];
    };
    const acked = applyAck(state.queue.map(toOutbox), {
      accepted: data.accepted ?? [],
      rejected: data.rejected ?? [],
    });
    return state.queue.map((item) => {
      const next = acked.find((row) => row.localId === item.eventId);
      if (!next) return item;
      return { ...item, status: next.status, reason: next.reason, synced: next.status === "synced" };
    });
  } catch {
    return null;
  }
}

export async function postJson<T>(
  path: string,
  body: unknown,
  role?: string,
  method = "POST",
): Promise<{ ok: boolean; data?: T; status: number }> {
  try {
    const res = await fetch(path, {
      method,
      headers: roleHeaders(role, true),
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as T;
    return { ok: res.ok, data, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
