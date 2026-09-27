from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Event:
    event_id: str
    entity_type: str
    entity_id: str
    action: str
    payload: dict[str, Any]
    device_id: str
    occurred_at: int


def resolve_events(
    events: list[Event],
    initial_stock: dict[str, int] | None = None,
) -> dict[str, dict[str, Any]]:
    seen: set[str] = set()
    ordered = sorted(events, key=lambda e: (e.occurred_at, e.event_id))
    state: dict[str, dict[str, Any]] = {}
    stock = dict(initial_stock or {})

    for event in ordered:
        if event.event_id in seen:
            continue
        seen.add(event.event_id)
        key = f"{event.entity_type}:{event.entity_id}"
        if event.entity_type == "stock" and event.action == "adjust":
            current = stock.get(event.entity_id, 0)
            current += int(event.payload.get("delta", 0))
            stock[event.entity_id] = current
            state[key] = {"qty": current}
            continue
        if event.entity_type == "ledger" and event.action == "credit":
            current = int(state.get(key, {}).get("balance", 0))
            current += int(event.payload.get("amount", 0))
            state[key] = {"balance": current}
            continue
        if event.entity_type == "ledger" and event.action == "payment":
            current = int(state.get(key, {}).get("balance", 0))
            current -= int(event.payload.get("amount", 0))
            state[key] = {"balance": current}
            continue
        existing = state.get(key, {})
        merged = {**existing, **event.payload}
        state[key] = merged
    return state
