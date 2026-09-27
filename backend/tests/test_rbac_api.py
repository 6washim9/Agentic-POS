from fastapi.testclient import TestClient
from app.main import app, store
from app.domain.rbac import default_caps

client = TestClient(app)


def setup_function() -> None:
    store.permissions = {"caps": default_caps(), "owner": {}, "occurred_at": 0}


def test_enterer_cannot_put_owner_overrides():
    res = client.put(
        "/api/permissions/owner",
        json={"screen.sale": "deny"},
        headers={"X-Role": "enterer"},
    )
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "FORBIDDEN"


def test_owner_cannot_expand_confirm_cap_to_allow():
    store.permissions["caps"]["enterer"]["hitl.credit_override"] = "confirm"
    res = client.put(
        "/api/permissions/owner",
        json={"hitl.credit_override": "allow"},
        headers={"X-Role": "owner"},
    )
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "CAP_EXCEEDED"


def test_denied_sale_returns_403():
    store.permissions["caps"]["enterer"]["screen.sale"] = "deny"
    store.permissions["caps"]["enterer"]["agent.sale"] = "deny"
    res = client.post(
        "/api/sales",
        json={"sku_id": "fuji", "customer_id": "salma", "crates_sold": 1, "on_credit": False},
        headers={"X-Role": "enterer"},
    )
    assert res.status_code == 403
    assert res.json()["detail"]["key"] == "screen.sale"


def test_super_admin_put_caps_clips_owner():
    store.permissions["owner"] = {"hitl.credit_override": "allow"}
    caps = default_caps()
    caps["enterer"]["hitl.credit_override"] = "confirm"
    res = client.put("/api/permissions/caps", json={"caps": caps}, headers={"X-Role": "super_admin"})
    assert res.status_code == 200
    body = client.get("/api/permissions").json()
    assert body["owner"]["hitl.credit_override"] == "confirm"


def test_unknown_key_is_400():
    res = client.put(
        "/api/permissions/owner",
        json={"nope": "allow"},
        headers={"X-Role": "owner"},
    )
    assert res.status_code == 400
