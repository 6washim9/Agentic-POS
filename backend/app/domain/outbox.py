from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class OutboxItem:
    local_id: str
    entity_type: str
    entity_id: str
    action: str
    payload: dict[str, Any]
    device_id: str
    occurred_at: int


@dataclass(frozen=True)
class Ack:
    local_id: str
    remote_id: str
    duplicate: bool = False


@dataclass(frozen=True)
class Reject:
    local_id: str
    reason: str


@dataclass
class SyncResult:
    accepted: list[Ack] = field(default_factory=list)
    rejected: list[Reject] = field(default_factory=list)
    store: list[OutboxItem] = field(default_factory=list)


def _valid(item: OutboxItem) -> str | None:
    amount = item.payload.get("amount")
    if amount is not None and float(amount) < 0:
        return "invalid_amount"
    return None


def apply_idempotent_sync(store: list[OutboxItem], incoming: list[OutboxItem]) -> SyncResult:
    known = {item.local_id: item for item in store}
    accepted: list[Ack] = []
    rejected: list[Reject] = []
    next_store = list(store)
    for item in incoming:
        reason = _valid(item)
        if reason:
            rejected.append(Reject(local_id=item.local_id, reason=reason))
            continue
        if item.local_id in known:
            accepted.append(Ack(local_id=item.local_id, remote_id=item.local_id, duplicate=True))
            continue
        known[item.local_id] = item
        next_store.append(item)
        accepted.append(Ack(local_id=item.local_id, remote_id=item.local_id, duplicate=False))
    return SyncResult(accepted=accepted, rejected=rejected, store=next_store)


def acknowledge_batch(items: list[OutboxItem], result: SyncResult) -> dict[str, str]:
    statuses = {item.local_id: "pending" for item in items}
    for ack in result.accepted:
        statuses[ack.local_id] = "synced"
    for reject in result.rejected:
        statuses[reject.local_id] = "rejected"
    return statuses
