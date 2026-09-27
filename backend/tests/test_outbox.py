from app.domain.outbox import OutboxItem, acknowledge_batch, apply_idempotent_sync


def test_duplicate_local_id_is_accepted_once():
    first = apply_idempotent_sync(
        [],
        [
            OutboxItem(
                local_id="sale-1",
                entity_type="sale",
                entity_id="sale-1",
                action="create",
                payload={"amount": 50000},
                device_id="yard-1",
                occurred_at=1000,
            )
        ],
    )
    second = apply_idempotent_sync(
        first.store,
        [
            OutboxItem(
                local_id="sale-1",
                entity_type="sale",
                entity_id="sale-1",
                action="create",
                payload={"amount": 50000},
                device_id="yard-1",
                occurred_at=1000,
            )
        ],
    )
    assert len(first.accepted) == 1
    assert len(second.accepted) == 1
    assert second.accepted[0].duplicate is True
    assert len(second.store) == 1


def test_batch_marks_accepted_and_rejected_per_record():
    items = [
        OutboxItem(
            local_id="ok-1",
            entity_type="sale",
            entity_id="ok-1",
            action="create",
            payload={"amount": 10},
            device_id="a",
            occurred_at=1,
        ),
        OutboxItem(
            local_id="bad-1",
            entity_type="sale",
            entity_id="bad-1",
            action="create",
            payload={"amount": -1},
            device_id="a",
            occurred_at=2,
        ),
    ]
    result = apply_idempotent_sync([], items)
    acked = acknowledge_batch(items, result)
    assert acked["ok-1"] == "synced"
    assert acked["bad-1"] == "rejected"
    assert result.rejected[0].reason == "invalid_amount"


def test_does_not_mark_whole_batch_synced_when_one_fails():
    items = [
        OutboxItem(
            local_id="a",
            entity_type="sale",
            entity_id="a",
            action="create",
            payload={"amount": 1},
            device_id="d",
            occurred_at=1,
        ),
        OutboxItem(
            local_id="b",
            entity_type="sale",
            entity_id="b",
            action="create",
            payload={"amount": -9},
            device_id="d",
            occurred_at=2,
        ),
    ]
    statuses = acknowledge_batch(items, apply_idempotent_sync([], items))
    assert statuses["a"] == "synced"
    assert statuses["b"] != "synced"
