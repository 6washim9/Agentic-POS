export type OutboxStatus = "pending" | "synced" | "rejected";

export type OutboxItem = {
  localId: string;
  entityType: string;
  entityId: string;
  action: string;
  payload: Record<string, unknown>;
  deviceId: string;
  occurredAt: number;
  status: OutboxStatus;
  reason?: string;
};

export type SyncAck = {
  local_id: string;
  remote_id: string;
  duplicate?: boolean;
};

export type SyncReject = {
  local_id: string;
  reason: string;
};

export type SyncResponse = {
  accepted: SyncAck[];
  rejected: SyncReject[];
};

export function pendingOnly(items: OutboxItem[]): OutboxItem[] {
  return items.filter((item) => item.status === "pending");
}

export function applyAck(items: OutboxItem[], response: SyncResponse): OutboxItem[] {
  const accepted = new Map(response.accepted.map((row) => [row.local_id, row]));
  const rejected = new Map(response.rejected.map((row) => [row.local_id, row]));
  return items.map((item) => {
    if (accepted.has(item.localId)) {
      return { ...item, status: "synced" as const, reason: undefined };
    }
    const fail = rejected.get(item.localId);
    if (fail) {
      return { ...item, status: "rejected" as const, reason: fail.reason };
    }
    return item;
  });
}
