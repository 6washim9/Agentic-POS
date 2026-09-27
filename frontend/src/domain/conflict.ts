export type SyncEvent = {
  eventId: string;
  entityType: string;
  entityId: string;
  action: string;
  payload: Record<string, unknown>;
  deviceId: string;
  occurredAt: number;
};

export function resolveEvents(
  events: SyncEvent[],
  initialStock: Record<string, number> = {},
): Record<string, Record<string, unknown>> {
  const seen = new Set<string>();
  const ordered = [...events].sort((a, b) => a.occurredAt - b.occurredAt || a.eventId.localeCompare(b.eventId));
  const state: Record<string, Record<string, unknown>> = {};
  const stock = { ...initialStock };

  for (const event of ordered) {
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    const key = `${event.entityType}:${event.entityId}`;
    if (event.entityType === "stock" && event.action === "adjust") {
      const current = (stock[event.entityId] ?? 0) + Number(event.payload.delta ?? 0);
      stock[event.entityId] = current;
      state[key] = { qty: current };
      continue;
    }
    if (event.entityType === "ledger" && event.action === "credit") {
      const current = Number(state[key]?.balance ?? 0) + Number(event.payload.amount ?? 0);
      state[key] = { balance: current };
      continue;
    }
    if (event.entityType === "ledger" && event.action === "payment") {
      const current = Number(state[key]?.balance ?? 0) - Number(event.payload.amount ?? 0);
      state[key] = { balance: current };
      continue;
    }
    state[key] = { ...(state[key] ?? {}), ...event.payload };
  }
  return state;
}
