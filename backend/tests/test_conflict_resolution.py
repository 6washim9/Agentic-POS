from app.domain.conflict import Event, resolve_events


def test_later_timestamp_wins_for_same_entity_non_financial():
    events = [
        Event(
            event_id="e1",
            entity_type="sku",
            entity_id="fuji",
            action="grade",
            payload={"grade": "A"},
            device_id="a",
            occurred_at=1000,
        ),
        Event(
            event_id="e2",
            entity_type="sku",
            entity_id="fuji",
            action="grade",
            payload={"grade": "B"},
            device_id="b",
            occurred_at=2000,
        ),
    ]
    resolved = resolve_events(events)
    assert resolved["sku:fuji"]["grade"] == "B"


def test_stock_adjustments_are_appended_not_overwritten():
    events = [
        Event(
            event_id="s1",
            entity_type="stock",
            entity_id="fuji",
            action="adjust",
            payload={"delta": -10},
            device_id="a",
            occurred_at=1000,
        ),
        Event(
            event_id="s2",
            entity_type="stock",
            entity_id="fuji",
            action="adjust",
            payload={"delta": -5},
            device_id="b",
            occurred_at=1001,
        ),
    ]
    resolved = resolve_events(events, initial_stock={"fuji": 100})
    assert resolved["stock:fuji"]["qty"] == 85


def test_financial_credit_entries_never_overwrite_each_other():
    events = [
        Event(
            event_id="c1",
            entity_type="ledger",
            entity_id="rahim",
            action="credit",
            payload={"amount": 50000},
            device_id="a",
            occurred_at=1000,
        ),
        Event(
            event_id="c2",
            entity_type="ledger",
            entity_id="rahim",
            action="credit",
            payload={"amount": 20000},
            device_id="b",
            occurred_at=1002,
        ),
    ]
    resolved = resolve_events(events)
    assert resolved["ledger:rahim"]["balance"] == 70000


def test_duplicate_event_ids_are_idempotent():
    events = [
        Event(
            event_id="dup",
            entity_type="ledger",
            entity_id="rahim",
            action="credit",
            payload={"amount": 1000},
            device_id="a",
            occurred_at=1,
        ),
        Event(
            event_id="dup",
            entity_type="ledger",
            entity_id="rahim",
            action="credit",
            payload={"amount": 1000},
            device_id="a",
            occurred_at=1,
        ),
    ]
    resolved = resolve_events(events)
    assert resolved["ledger:rahim"]["balance"] == 1000


def test_financial_payment_entries_subtract_from_balance():
    events = [
        Event(
            event_id="p1",
            entity_type="ledger",
            entity_id="rahim",
            action="payment",
            payload={"amount": 5000},
            device_id="a",
            occurred_at=1000,
        ),
        Event(
            event_id="p2",
            entity_type="ledger",
            entity_id="rahim",
            action="payment",
            payload={"amount": 2000},
            device_id="b",
            occurred_at=1001,
        ),
    ]
    resolved = resolve_events(events)
    assert resolved["ledger:rahim"]["balance"] == -7000


def test_mixed_credit_and_payment_net_correctly():
    events = [
        Event(
            event_id="c1",
            entity_type="ledger",
            entity_id="rahim",
            action="credit",
            payload={"amount": 50000},
            device_id="a",
            occurred_at=1000,
        ),
        Event(
            event_id="p1",
            entity_type="ledger",
            entity_id="rahim",
            action="payment",
            payload={"amount": 20000},
            device_id="b",
            occurred_at=1001,
        ),
    ]
    resolved = resolve_events(events)
    assert resolved["ledger:rahim"]["balance"] == 30000
