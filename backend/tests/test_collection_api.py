from fastapi.testclient import TestClient

from app.domain.rbac import default_caps
from app.domain.shift import open_shift
from app.main import app, store

client = TestClient(app)


def setup_function() -> None:
    store.permissions = {"caps": default_caps(), "owner": {}, "occurred_at": 0}
    store.collections = []
    store.sales = []
    store.shift = open_shift(cashier="Yard", float_amount=5000, opened_at=0)
    store.customers["rahim"]["credit_balance"] = 150000


def test_collection_reduces_balance():
    res = client.post(
        "/api/collections",
        json={"customer_id": "rahim", "amount": 5000},
        headers={"X-Role": "enterer"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["collection"]["amount"] == 5000
    assert body["collection"]["is_advance"] is False
    assert body["customer"]["credit_balance"] == 145000
    assert store.collections[-1]["customer_id"] == "rahim"


def test_bad_amount_is_400():
    res = client.post(
        "/api/collections",
        json={"customer_id": "rahim", "amount": 0},
        headers={"X-Role": "enterer"},
    )
    assert res.status_code == 400
    assert res.json()["detail"]["code"] == "BAD_AMOUNT"


def test_unknown_customer_is_404():
    res = client.post(
        "/api/collections",
        json={"customer_id": "nobody", "amount": 100},
        headers={"X-Role": "enterer"},
    )
    assert res.status_code == 404


def test_both_keys_denied_is_403():
    store.permissions["caps"]["enterer"]["screen.ledger"] = "deny"
    store.permissions["caps"]["enterer"]["agent.collection"] = "deny"
    res = client.post(
        "/api/collections",
        json={"customer_id": "rahim", "amount": 100},
        headers={"X-Role": "enterer"},
    )
    assert res.status_code == 403
    assert res.json()["detail"]["key"] == "screen.ledger"


def test_overpay_with_advance_deny_is_403():
    store.permissions["caps"]["enterer"]["hitl.advance"] = "deny"
    res = client.post(
        "/api/collections",
        json={"customer_id": "rahim", "amount": 150001},
        headers={"X-Role": "enterer"},
    )
    assert res.status_code == 403
    assert res.json()["detail"]["key"] == "hitl.advance"


def test_overpay_without_override_is_409():
    res = client.post(
        "/api/collections",
        json={"customer_id": "rahim", "amount": 150001},
        headers={"X-Role": "enterer"},
    )
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["code"] == "HITL_REQUIRED"
    assert detail["reason"] == "advance"
    assert detail["current"] == 150000


def test_overpay_with_override_goes_negative():
    res = client.post(
        "/api/collections",
        json={"customer_id": "rahim", "amount": 152000, "confirm_override": True},
        headers={"X-Role": "enterer"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["collection"]["is_advance"] is True
    assert body["customer"]["credit_balance"] == -2000


def test_bootstrap_includes_collections():
    client.post(
        "/api/collections",
        json={"customer_id": "rahim", "amount": 5000},
        headers={"X-Role": "enterer"},
    )
    snapshot = client.get("/api/bootstrap").json()
    assert len(snapshot["collections"]) == 1
    assert snapshot["collections"][0]["amount"] == 5000


def test_shift_close_counts_collection_cash():
    client.post(
        "/api/collections",
        json={"customer_id": "rahim", "amount": 5000},
        headers={"X-Role": "enterer"},
    )
    shift = client.post("/api/shift/close", headers={"X-Role": "enterer"}).json()
    assert shift["collection_cash"] == 5000
    assert shift["cash_collected"] == 5000
    assert shift["expected_drawer"] == 10000
