# Baki Collection Implementation Plan

> **As-built 2026-09-15:** All 12 tasks shipped inline. Domain, API, offline, RBAC, Ledger, and voice match the spec. Do not re-run these steps unless a regression appears. POS restyle (dark magenta admin shell) is a follow-on visual pass; see spec section 14.

**Goal:** Record cash collections against a customer's running baki khata, with advance overpay behind HITL, offline sync, shift cash, and RBAC gating.

**Architecture:** A `collection` is a first-class record, never a sale. A pure `apply_collection` / `applyCollection` function reduces `credit_balance`; overpay beyond dues requires `confirm_override` and may drive the balance negative (advance). The khata is derived read-only from sales plus collections. Collections queue as outbox `ledger` / `payment` events and replay by subtracting. Python and TypeScript implement the same rules independently, as split tender and shift already do.

**Tech Stack:** Python 3 FastAPI + `pytest` (domain + `fastapi.testclient`). React 18 + TypeScript + Vitest. Encrypted local `AppState` + `/api` Vite proxy.

## Global Constraints

- Bangla default copy; no emoji in UI or docs (except none used here).
- TDD: failing test first for every domain/API/UI behavior.
- Do not commit unless the user explicitly asks. Replace every "commit" checkpoint with a full test run.
- Follow existing patterns in `backend/app/domain/` and `frontend/src/domain/`.
- `amount` is a positive integer Taka; cash tender only in this slice.
- Exact settle (`amount == current_balance`) is NOT an advance.
- Overpay requires `confirm_override`; RBAC may only `deny` the override, never bypass the confirm sheet.
- RBAC additions are CATALOG-only: `agent.collection` (after `agent.reminder`) and `hitl.advance` (after `hitl.credit_override`). No new roles and no new cells.
- Missing permission key still resolves to `deny`.
- Backend commands run from `backend/`; frontend commands run from `frontend/`.

## File map

Create:

- `backend/app/domain/collection.py`
- `backend/tests/test_collection.py`
- `backend/tests/test_collection_api.py`
- `frontend/src/domain/collection.ts`
- `frontend/src/domain/collection.test.ts`

Modify:

- `backend/app/domain/conflict.py` — `ledger` + `payment` branch
- `backend/app/domain/shift.py` — `collection_cash` in `close_shift`
- `backend/app/domain/rbac.py` — CATALOG + enterer defaults
- `backend/app/main.py` — `Store.collections`, `POST /api/collections`, snapshot, shift close
- `backend/tests/test_conflict_resolution.py`, `backend/tests/test_shift.py`, `backend/tests/test_rbac.py`
- `frontend/src/domain/rbac.ts` — CATALOG, enterer defaults, `voiceKey("payment")`, `backfillCaps`
- `frontend/src/domain/conflict.ts` — payment branch
- `frontend/src/domain/shift.ts` — collection cash
- `frontend/src/domain/nlp.ts` — amount entity for `payment`
- `frontend/src/store/types.ts`, `frontend/src/store/seed.ts`, `frontend/src/store/offline.ts`
- `frontend/src/i18n/copy.ts`
- `frontend/src/screens/Ledger.tsx`, `frontend/src/screens/Shift.tsx`, `frontend/src/screens/Settings.tsx`
- `frontend/src/App.tsx`
- `frontend/src/domain/rbac.test.ts`, `frontend/src/domain/nlp.test.ts`, `frontend/src/domain/shift.test.ts`, `frontend/src/domain/conflict.test.ts`, `frontend/src/store/offline.test.ts`

---

### Task 1: Backend `apply_collection` domain

**Files:**
- Create: `backend/app/domain/collection.py`
- Test: `backend/tests/test_collection.py`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `CollectionResult` dataclass with `new_balance: int`, `is_advance: bool`, `advance_delta: int`
  - `apply_collection(current_balance: int, amount: int, confirm_override: bool = False) -> CollectionResult`

- [x] **Step 1: Write the failing tests**

Create `backend/tests/test_collection.py`:

```python
import pytest

from app.domain.collection import apply_collection


def test_collection_reduces_balance():
    result = apply_collection(150000, 50000)
    assert result.new_balance == 100000
    assert result.is_advance is False
    assert result.advance_delta == 0


def test_exact_settle_to_zero_is_not_advance():
    result = apply_collection(3000, 3000)
    assert result.new_balance == 0
    assert result.is_advance is False


def test_overpay_without_override_raises():
    with pytest.raises(ValueError, match="advance exceeds dues"):
        apply_collection(3000, 5000)


def test_overpay_with_override_goes_negative():
    result = apply_collection(3000, 5000, confirm_override=True)
    assert result.new_balance == -2000
    assert result.is_advance is True
    assert result.advance_delta == 2000


def test_non_positive_amount_rejected():
    with pytest.raises(ValueError, match="amount must be positive"):
        apply_collection(3000, 0)
    with pytest.raises(ValueError, match="amount must be positive"):
        apply_collection(3000, -100)


def test_collecting_against_negative_balance_requires_override():
    with pytest.raises(ValueError, match="advance exceeds dues"):
        apply_collection(-2000, 500)
    result = apply_collection(-2000, 500, confirm_override=True)
    assert result.new_balance == -2500
    assert result.is_advance is True
```

- [x] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_collection.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.domain.collection'`

- [x] **Step 3: Write the minimal implementation**

Create `backend/app/domain/collection.py`:

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class CollectionResult:
    new_balance: int
    is_advance: bool
    advance_delta: int


def apply_collection(
    current_balance: int,
    amount: int,
    confirm_override: bool = False,
) -> CollectionResult:
    if amount <= 0:
        raise ValueError("amount must be positive")
    if amount > current_balance and not confirm_override:
        raise ValueError("advance exceeds dues")
    new_balance = current_balance - amount
    return CollectionResult(
        new_balance=new_balance,
        is_advance=new_balance < 0,
        advance_delta=max(amount - current_balance, 0),
    )
```

- [x] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_collection.py -v`
Expected: 6 passed

- [x] **Step 5: Checkpoint (do not commit)**

Run: `python -m pytest -q`
Expected: all existing tests plus the 6 new tests pass.

---

### Task 2: Backend khata derivation

**Files:**
- Modify: `backend/app/domain/collection.py`
- Test: `backend/tests/test_collection.py`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `KhataLine` dataclass: `id: str`, `kind: str` (`"sale"` | `"collection"`), `amount: int`, `created_at: str`, `is_advance: bool`, `balance: int`
  - `Khata` dataclass: `opening: int`, `lines: list[KhataLine]`, `balance: int`
  - `derive_khata(credit_balance: int, sales: list[dict], collections: list[dict]) -> Khata`
  - A sale contributes a debit equal to `amount - cash_paid` only when that remainder is `> 0`.
  - A collection contributes a credit equal to its `amount`.
  - `opening = credit_balance - sum(debits) + sum(credits)`; the final `balance` equals `credit_balance`.

- [x] **Step 1: Write the failing tests**

Append to `backend/tests/test_collection.py`:

```python
from app.domain.collection import derive_khata


def test_khata_debits_only_the_sale_remainder():
    khata = derive_khata(
        600,
        sales=[
            {"id": "s1", "amount": 1000, "cash_paid": 400, "on_credit": True, "created_at": "2026-09-15T10:00:00"},
            {"id": "s2", "amount": 800, "cash_paid": 800, "on_credit": False, "created_at": "2026-09-15T11:00:00"},
        ],
        collections=[],
    )
    sale_lines = [line for line in khata.lines if line.kind == "sale"]
    assert len(sale_lines) == 1
    assert sale_lines[0].amount == 600


def test_khata_opening_is_the_seed_balance():
    khata = derive_khata(150000, sales=[], collections=[])
    assert khata.opening == 150000
    assert khata.lines == []
    assert khata.balance == 150000


def test_khata_running_balance_ends_at_credit_balance():
    khata = derive_khata(
        59700,
        sales=[
            {"id": "s1", "amount": 1000, "cash_paid": 400, "on_credit": True, "created_at": "2026-09-15T10:00:00"},
            {"id": "s2", "amount": 5000, "cash_paid": 0, "on_credit": True, "created_at": "2026-09-15T12:00:00"},
        ],
        collections=[
            {"id": "c1", "amount": 300, "is_advance": False, "created_at": "2026-09-15T11:00:00"},
        ],
    )
    assert [line.kind for line in khata.lines] == ["sale", "collection", "sale"]
    assert khata.lines[0].balance == 600
    assert khata.lines[1].balance == 300
    assert khata.lines[2].balance == 5300
    assert khata.balance == 59700


def test_khata_marks_advance_collection():
    khata = derive_khata(
        -2000,
        sales=[],
        collections=[
            {"id": "c1", "amount": 5000, "is_advance": True, "created_at": "2026-09-15T10:00:00"},
        ],
    )
    assert khata.lines[0].is_advance is True
    assert khata.lines[0].balance == -2000
```

Note: `test_khata_running_balance_ends_at_credit_balance` uses an opening of `59700` so the arithmetic is self-consistent: opening 0 + 600 - 300 + 5000 = 5300, then `derive_khata` must produce `credit_balance` of 5300. Use `credit_balance=5300` instead of 59700 to make the assertion exact. Replace that argument with `5300` and keep the `khata.balance == 5300` assertion.

- [x] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_collection.py -v`
Expected: FAIL with `ImportError: cannot import name 'derive_khata'`

- [x] **Step 3: Write the minimal implementation**

Append to `backend/app/domain/collection.py`:

```python
from typing import Any


@dataclass(frozen=True)
class KhataLine:
    id: str
    kind: str
    amount: int
    created_at: str
    is_advance: bool
    balance: int


@dataclass(frozen=True)
class Khata:
    opening: int
    lines: list[KhataLine]
    balance: int


def derive_khata(
    credit_balance: int,
    sales: list[dict[str, Any]],
    collections: list[dict[str, Any]],
) -> Khata:
    ledger: list[tuple[str, str, int, bool, str]] = []
    debits = 0
    credits = 0
    for sale in sales:
        paid = sale.get("cash_paid")
        if paid is None:
            paid = 0 if sale.get("on_credit") else sale["amount"]
        remainder = int(sale["amount"]) - int(paid)
        if remainder <= 0:
            continue
        debits += remainder
        ledger.append((str(sale["created_at"]), str(sale["id"]), remainder, False, "sale"))
    for collection in collections:
        amount = int(collection["amount"])
        credits += amount
        ledger.append(
            (
                str(collection["created_at"]),
                str(collection["id"]),
                -amount,
                bool(collection.get("is_advance")),
                "collection",
            )
        )
    opening = credit_balance - debits + credits
    ledger.sort(key=lambda row: (row[0], row[1]))
    lines: list[KhataLine] = []
    running = opening
    for created_at, line_id, delta, is_advance, kind in ledger:
        running += delta
        lines.append(
            KhataLine(
                id=line_id,
                kind=kind,
                amount=abs(delta),
                created_at=created_at,
                is_advance=is_advance,
                balance=running,
            )
        )
    return Khata(opening=opening, lines=lines, balance=running)
```

- [x] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_collection.py -v`
Expected: 10 passed

- [x] **Step 5: Checkpoint (do not commit)**

Run: `python -m pytest -q`
Expected: all tests pass.

---

### Task 3: Backend conflict replay for `ledger` + `payment`

**Files:**
- Modify: `backend/app/domain/conflict.py`
- Test: `backend/tests/test_conflict_resolution.py`

**Interfaces:**
- Consumes: `Event`, `resolve_events` (existing)
- Produces: a `ledger` + `payment` branch that subtracts `amount` from the running balance. `ledger` + `credit` keeps adding.

- [x] **Step 1: Write the failing tests**

Append to `backend/tests/test_conflict_resolution.py`:

```python
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
```

- [x] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_conflict_resolution.py -v`
Expected: FAIL because `payment` falls through to the merge branch and produces no `balance` key.

- [x] **Step 3: Write the minimal implementation**

In `backend/app/domain/conflict.py`, add a branch immediately after the existing `credit` branch:

```python
        if event.entity_type == "ledger" and event.action == "payment":
            current = int(state.get(key, {}).get("balance", 0))
            current -= int(event.payload.get("amount", 0))
            state[key] = {"balance": current}
            continue
```

- [x] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_conflict_resolution.py -v`
Expected: 6 passed

- [x] **Step 5: Checkpoint (do not commit)**

Run: `python -m pytest -q`
Expected: all tests pass.

---

### Task 4: Backend shift collection cash

**Files:**
- Modify: `backend/app/domain/shift.py`
- Test: `backend/tests/test_shift.py`

**Interfaces:**
- Consumes: `Shift`, `SaleLine`, `open_shift`
- Produces:
  - `Shift.collection_cash: int = 0` (new dataclass field, placed after `expected_drawer` and before `closed_at`)
  - `close_shift(shift: Shift, sales: list[SaleLine], closed_at: int, collections: list[int] | None = None) -> Shift`
  - `cash_collected = sum(sale.cash_paid) + sum(collections)`; `expected_drawer = float_amount + cash_collected`; `z_total` and `credit_issued` stay sales-only.

Signature note: `collections` is appended after `closed_at` so the existing positional call `close_shift(shift, sales, closed_at)` and the existing keyword call `close_shift(shift, sales=[...], closed_at=2)` both keep working.

- [x] **Step 1: Write the failing tests**

Append to `backend/tests/test_shift.py`:

```python
def test_collection_cash_joins_drawer():
    shift = open_shift(cashier="Karim", float_amount=2000, opened_at=1)
    closed = close_shift(
        shift,
        sales=[SaleLine(amount=1000, cash_paid=400, on_credit=True, recorded_price=1000)],
        closed_at=2,
        collections=[5000, 2000],
    )
    assert closed.collection_cash == 7000
    assert closed.cash_collected == 7400
    assert closed.expected_drawer == 9400
    assert closed.z_total == 1000
    assert closed.credit_issued == 600


def test_shift_without_collections_has_zero_collection_cash():
    shift = open_shift(cashier="Karim", float_amount=2000, opened_at=1)
    closed = close_shift(shift, sales=[], closed_at=2)
    assert closed.collection_cash == 0
    assert closed.expected_drawer == 2000
```

- [x] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_shift.py -v`
Expected: FAIL with `TypeError: close_shift() got an unexpected keyword argument 'collections'`

- [x] **Step 3: Write the minimal implementation**

Replace `backend/app/domain/shift.py` with:

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class SaleLine:
    amount: int
    cash_paid: int
    on_credit: bool
    recorded_price: int


@dataclass(frozen=True)
class Shift:
    cashier: str
    float_amount: int
    opened_at: int
    status: str
    cash_collected: int = 0
    credit_issued: int = 0
    z_total: int = 0
    expected_drawer: int = 0
    collection_cash: int = 0
    closed_at: int | None = None


def open_shift(cashier: str, float_amount: int, opened_at: int) -> Shift:
    if float_amount < 0:
        raise ValueError("float cannot be negative")
    return Shift(cashier=cashier, float_amount=float_amount, opened_at=opened_at, status="open")


def close_shift(
    shift: Shift,
    sales: list[SaleLine],
    closed_at: int,
    collections: list[int] | None = None,
) -> Shift:
    collection_cash = sum(collections or [])
    cash = sum(line.cash_paid for line in sales) + collection_cash
    credit = sum(max(line.amount - line.cash_paid, 0) for line in sales)
    z_total = sum(line.amount for line in sales)
    return Shift(
        cashier=shift.cashier,
        float_amount=shift.float_amount,
        opened_at=shift.opened_at,
        status="closed",
        cash_collected=cash,
        credit_issued=credit,
        z_total=z_total,
        expected_drawer=shift.float_amount + cash,
        collection_cash=collection_cash,
        closed_at=closed_at,
    )
```

- [x] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_shift.py -v`
Expected: 4 passed

- [x] **Step 5: Checkpoint (do not commit)**

Run: `python -m pytest -q`
Expected: all tests pass.

---

### Task 5: Backend RBAC CATALOG additions

**Files:**
- Modify: `backend/app/domain/rbac.py`
- Test: `backend/tests/test_rbac.py`

**Interfaces:**
- Consumes: `CATALOG`, `default_caps` (existing)
- Produces: `CATALOG` includes `agent.collection` and `hitl.advance`; `default_caps()["enterer"]["hitl.advance"] == "confirm"`; `default_caps()["super_admin"]["agent.collection"] == "allow"`; missing key still `deny`.

- [x] **Step 1: Write the failing tests**

Append to `backend/tests/test_rbac.py`:

```python
def test_collection_keys_are_in_catalog():
    from app.domain.rbac import CATALOG

    assert "agent.collection" in CATALOG
    assert "hitl.advance" in CATALOG


def test_collection_defaults():
    caps = default_caps()
    assert caps["super_admin"]["agent.collection"] == "allow"
    assert caps["owner"]["agent.collection"] == "allow"
    assert caps["enterer"]["agent.collection"] == "allow"
    assert caps["enterer"]["hitl.advance"] == "confirm"
    assert caps["owner"]["hitl.advance"] == "allow"


def test_unknown_collection_key_still_denies():
    caps = default_caps()
    assert effective(caps, {}, "enterer", "agent.nope") == "deny"
```

- [x] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_rbac.py -v`
Expected: FAIL on `"agent.collection" in CATALOG`

- [x] **Step 3: Write the minimal implementation**

In `backend/app/domain/rbac.py`, add the keys to `CATALOG`:

```python
    "agent.sale",
    "agent.spoilage",
    "agent.reminder",
    "agent.collection",
    "agent.confirm_reply",
    "hitl.credit_override",
    "hitl.advance",
    "hitl.shift_close",
    "hitl.write_off",
```

and add the enterer default in `default_caps()` after the existing HITL defaults:

```python
    enterer["hitl.write_off"] = "confirm"
    enterer["hitl.advance"] = "confirm"
```

- [x] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_rbac.py -v`
Expected: 11 passed

- [x] **Step 5: Checkpoint (do not commit)**

Run: `python -m pytest -q`
Expected: all tests pass.

---

### Task 6: Backend collections API and wiring

**Files:**
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_collection_api.py` (create)

**Interfaces:**
- Consumes: `apply_collection` (Task 1), `close_shift` collections argument (Task 4), `require_any` / `cell_of` / `read_role` (existing), `enqueue` (existing)
- Produces:
  - `Store.collections: list[dict[str, Any]]`
  - `POST /api/collections` with body `CollectionIn`
  - Bootstrap snapshot `collections` (last 50) and `kpis.cash_today` includes collection cash
  - Shift snapshot includes `collection_cash`; `POST /api/shift/close` passes collection amounts

- [x] **Step 1: Write the failing API tests**

Create `backend/tests/test_collection_api.py`:

```python
from fastapi.testclient import TestClient

from app.domain.rbac import default_caps
from app.domain.shift import open_shift
from app.main import app, store

client = TestClient(app)


def setup_function() -> None:
    store.permissions = {"caps": default_caps(), "owner": {}, "occurred_at": 0}
    store.collections = []
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
```

- [x] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_collection_api.py -v`
Expected: FAIL with 404 (route not found) on the happy path

- [x] **Step 3: Write the minimal implementation**

In `backend/app/main.py`:

1. Add the import:

```python
from app.domain.collection import apply_collection
```

2. In `Store.__init__`, after `self.reminders = []`:

```python
        self.collections: list[dict[str, Any]] = []
```

3. In `Store.snapshot`, include collection cash in `cash_today` and add the `collections` list. Replace the `cash_today` line:

```python
        cash_today = sum(
            float(s.get("cash_paid", 0 if s["on_credit"] else s["amount"])) for s in self.sales
        ) + sum(float(c["amount"]) for c in self.collections)
```

Add to the shift dict:

```python
                "collection_cash": self.shift.collection_cash,
```

And add to the returned dict, after `"reminders"`:

```python
            "collections": self.collections[-50:],
```

4. Add the request model after `class ReminderIn`:

```python
class CollectionIn(BaseModel):
    customer_id: str
    amount: int
    note: str | None = None
    confirm_override: bool = False
    local_id: str | None = None
```

5. Add the endpoint after `reminder`:

```python
@app.post("/api/collections")
def create_collection(body: CollectionIn, role: str = Depends(read_role)) -> dict[str, Any]:
    require_any(role, ["screen.ledger", "agent.collection"])
    customer = store.customers.get(body.customer_id)
    if not customer:
        raise HTTPException(404, "customer not found")
    current = int(customer["credit_balance"])
    if body.amount <= 0:
        raise HTTPException(400, detail={"code": "BAD_AMOUNT"})
    if body.amount > current and cell_of(role, "hitl.advance") == "deny":
        raise HTTPException(403, detail={"code": "FORBIDDEN", "key": "hitl.advance"})
    try:
        result = apply_collection(current, body.amount, body.confirm_override)
    except ValueError as exc:
        if "advance exceeds dues" in str(exc):
            raise HTTPException(
                409,
                detail={
                    "code": "HITL_REQUIRED",
                    "reason": "advance",
                    "projected": current - body.amount,
                    "current": current,
                },
            ) from exc
        raise HTTPException(400, detail={"code": "BAD_AMOUNT"}) from exc
    collection = {
        "id": body.local_id or str(uuid4()),
        "customer_id": customer["id"],
        "customer_name": customer["name"],
        "amount": body.amount,
        "note": body.note,
        "is_advance": result.is_advance,
        "created_at": now_iso(),
    }
    customer["credit_balance"] = result.new_balance
    store.collections.append(collection)
    enqueue("ledger", customer["id"], "payment", {"amount": body.amount})
    if result.is_advance:
        tts = {
            "bn": f"সংরক্ষিত। {customer['name_bn']} এর কাছে {body.amount} টাকা অগ্রিম জমা নেওয়া হয়েছে। ব্যালেন্স {result.new_balance} টাকা।",
            "en": f"Saved. Collected {body.amount} Taka advance from {customer['name']}. Balance {result.new_balance} Taka.",
        }
    else:
        tts = {
            "bn": f"সংরক্ষিত। {customer['name_bn']} এর কাছে {body.amount} টাকা জমা হয়েছে। বাকি {result.new_balance} টাকা।",
            "en": f"Saved. Collected {body.amount} Taka from {customer['name']}. Remaining {result.new_balance} Taka.",
        }
    return {"collection": collection, "customer": customer, "tts": tts}
```

6. In `shift_close`, pass collection amounts. Replace the `store.shift = close_shift(...)` line:

```python
    store.shift = close_shift(
        store.shift,
        lines,
        int(datetime.now(timezone.utc).timestamp() * 1000),
        collections=[int(collection["amount"]) for collection in store.collections],
    )
```

- [x] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_collection_api.py -v`
Expected: 9 passed

- [x] **Step 5: Checkpoint (do not commit)**

Run: `python -m pytest -q`
Expected: all tests pass.

---

### Task 7: Frontend `applyCollection` and khata domain

**Files:**
- Create: `frontend/src/domain/collection.ts`
- Test: `frontend/src/domain/collection.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `CollectionResult = { newBalance: number; isAdvance: boolean; advanceDelta: number }`
  - `applyCollection(currentBalance: number, amount: number, confirmOverride = false): CollectionResult`
  - `KhataLine = { id: string; kind: "sale" | "collection"; amount: number; createdAt: string; isAdvance: boolean; balance: number }`
  - `Khata = { opening: number; lines: KhataLine[]; balance: number }`
  - `deriveKhata(creditBalance: number, sales: CollectionSaleInput[], collections: CollectionEntry[]): Khata`
  - `CollectionSaleInput = { id: string; amount: number; cash_paid: number; on_credit: boolean; created_at: string }`
  - `CollectionEntry = { id: string; amount: number; is_advance: boolean; created_at: string }`

- [x] **Step 1: Write the failing tests**

Create `frontend/src/domain/collection.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyCollection, deriveKhata } from "./collection";

describe("applyCollection", () => {
  it("reduces the balance", () => {
    const result = applyCollection(150000, 50000);
    expect(result.newBalance).toBe(100000);
    expect(result.isAdvance).toBe(false);
    expect(result.advanceDelta).toBe(0);
  });

  it("treats an exact settle as not an advance", () => {
    const result = applyCollection(3000, 3000);
    expect(result.newBalance).toBe(0);
    expect(result.isAdvance).toBe(false);
  });

  it("throws on an overpay without override", () => {
    expect(() => applyCollection(3000, 5000)).toThrow("advance exceeds dues");
  });

  it("allows an overpay with override and marks it advance", () => {
    const result = applyCollection(3000, 5000, true);
    expect(result.newBalance).toBe(-2000);
    expect(result.isAdvance).toBe(true);
    expect(result.advanceDelta).toBe(2000);
  });

  it("rejects a non-positive amount", () => {
    expect(() => applyCollection(3000, 0)).toThrow("amount must be positive");
    expect(() => applyCollection(3000, -10)).toThrow("amount must be positive");
  });
});

describe("deriveKhata", () => {
  it("debits only the sale remainder", () => {
    const khata = deriveKhata(
      600,
      [
        { id: "s1", amount: 1000, cash_paid: 400, on_credit: true, created_at: "2026-09-15T10:00:00" },
        { id: "s2", amount: 800, cash_paid: 800, on_credit: false, created_at: "2026-09-15T11:00:00" },
      ],
      [],
    );
    expect(khata.lines).toHaveLength(1);
    expect(khata.lines[0].kind).toBe("sale");
    expect(khata.lines[0].amount).toBe(600);
  });

  it("uses the seed balance as opening", () => {
    const khata = deriveKhata(150000, [], []);
    expect(khata.opening).toBe(150000);
    expect(khata.balance).toBe(150000);
  });

  it("running balance ends at the credit balance", () => {
    const khata = deriveKhata(
      5300,
      [
        { id: "s1", amount: 1000, cash_paid: 400, on_credit: true, created_at: "2026-09-15T10:00:00" },
        { id: "s2", amount: 5000, cash_paid: 0, on_credit: true, created_at: "2026-09-15T12:00:00" },
      ],
      [
        { id: "c1", amount: 300, is_advance: false, created_at: "2026-09-15T11:00:00" },
      ],
    );
    expect(khata.lines.map((line) => line.kind)).toEqual(["sale", "collection", "sale"]);
    expect(khata.lines[0].balance).toBe(600);
    expect(khata.lines[1].balance).toBe(300);
    expect(khata.lines[2].balance).toBe(5300);
    expect(khata.balance).toBe(5300);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/domain/collection.test.ts`
Expected: FAIL to resolve `./collection`

- [x] **Step 3: Write the minimal implementation**

Create `frontend/src/domain/collection.ts`:

```ts
export type CollectionResult = {
  newBalance: number;
  isAdvance: boolean;
  advanceDelta: number;
};

export function applyCollection(
  currentBalance: number,
  amount: number,
  confirmOverride = false,
): CollectionResult {
  if (amount <= 0) throw new Error("amount must be positive");
  if (amount > currentBalance && !confirmOverride) throw new Error("advance exceeds dues");
  const newBalance = currentBalance - amount;
  return {
    newBalance,
    isAdvance: newBalance < 0,
    advanceDelta: Math.max(amount - currentBalance, 0),
  };
}

export type CollectionSaleInput = {
  id: string;
  amount: number;
  cash_paid: number;
  on_credit: boolean;
  created_at: string;
};

export type CollectionEntry = {
  id: string;
  amount: number;
  is_advance: boolean;
  created_at: string;
};

export type KhataLine = {
  id: string;
  kind: "sale" | "collection";
  amount: number;
  createdAt: string;
  isAdvance: boolean;
  balance: number;
};

export type Khata = {
  opening: number;
  lines: KhataLine[];
  balance: number;
};

export function deriveKhata(
  creditBalance: number,
  sales: CollectionSaleInput[],
  collections: CollectionEntry[],
): Khata {
  type Raw = { at: string; id: string; delta: number; isAdvance: boolean; kind: "sale" | "collection" };
  const ledger: Raw[] = [];
  let debits = 0;
  let credits = 0;
  for (const sale of sales) {
    const paid = sale.cash_paid ?? (sale.on_credit ? 0 : sale.amount);
    const remainder = sale.amount - paid;
    if (remainder <= 0) continue;
    debits += remainder;
    ledger.push({ at: sale.created_at, id: sale.id, delta: remainder, isAdvance: false, kind: "sale" });
  }
  for (const collection of collections) {
    credits += collection.amount;
    ledger.push({
      at: collection.created_at,
      id: collection.id,
      delta: -collection.amount,
      isAdvance: collection.is_advance,
      kind: "collection",
    });
  }
  const opening = creditBalance - debits + credits;
  ledger.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const lines: KhataLine[] = [];
  let running = opening;
  for (const row of ledger) {
    running += row.delta;
    lines.push({
      id: row.id,
      kind: row.kind,
      amount: Math.abs(row.delta),
      createdAt: row.at,
      isAdvance: row.isAdvance,
      balance: running,
    });
  }
  return { opening, lines, balance: running };
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/domain/collection.test.ts`
Expected: 8 passed

- [x] **Step 5: Checkpoint (do not commit)**

Run: `npx tsc --noEmit`
Expected: no errors.

---

### Task 8: Frontend conflict and shift collection cash

**Files:**
- Modify: `frontend/src/domain/conflict.ts`, `frontend/src/domain/shift.ts`
- Test: `frontend/src/domain/conflict.test.ts`, `frontend/src/domain/shift.test.ts`

**Interfaces:**
- Consumes: `resolveEvents`, `closeShift` (existing)
- Produces:
  - `resolveEvents` subtracts for `ledger` + `payment`
  - `Shift.collectionCash: number` and `closeShift(shift, sales, closedAt, collections: number[] = [])`

- [x] **Step 1: Write the failing tests**

Append to `frontend/src/domain/conflict.test.ts`:

```ts
  it("subtracts ledger payment events", () => {
    const resolved = resolveEvents([
      event({
        eventId: "p1",
        entityType: "ledger",
        entityId: "rahim",
        action: "payment",
        payload: { amount: 5000 },
        occurredAt: 1000,
      }),
      event({
        eventId: "p2",
        entityType: "ledger",
        entityId: "rahim",
        action: "payment",
        payload: { amount: 2000 },
        deviceId: "b",
        occurredAt: 1001,
      }),
    ]);
    expect(resolved["ledger:rahim"].balance).toBe(-7000);
  });

  it("nets credits and payments", () => {
    const resolved = resolveEvents([
      event({
        eventId: "c1",
        entityType: "ledger",
        entityId: "rahim",
        action: "credit",
        payload: { amount: 50000 },
        occurredAt: 1000,
      }),
      event({
        eventId: "p1",
        entityType: "ledger",
        entityId: "rahim",
        action: "payment",
        payload: { amount: 20000 },
        deviceId: "b",
        occurredAt: 1001,
      }),
    ]);
    expect(resolved["ledger:rahim"].balance).toBe(30000);
  });
```

Append to `frontend/src/domain/shift.test.ts`:

```ts
  it("includes collection cash in the drawer", () => {
    const shift = openShift("Karim", 2000, 1);
    const closed = closeShift(shift, [{ amount: 1000, cashPaid: 400 }], 2, [5000, 2000]);
    expect(closed.collectionCash).toBe(7000);
    expect(closed.cashCollected).toBe(7400);
    expect(closed.expectedDrawer).toBe(9400);
    expect(closed.zTotal).toBe(1000);
    expect(closed.creditIssued).toBe(600);
  });

  it("defaults collection cash to zero", () => {
    const shift = openShift("Karim", 2000, 1);
    const closed = closeShift(shift, [], 2);
    expect(closed.collectionCash).toBe(0);
    expect(closed.expectedDrawer).toBe(2000);
  });
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/domain/conflict.test.ts src/domain/shift.test.ts`
Expected: FAIL — payment produces no balance; `closeShift` ignores the fourth argument.

- [x] **Step 3: Write the minimal implementation**

In `frontend/src/domain/conflict.ts`, add a branch after the existing `credit` branch inside the loop:

```ts
    if (event.entityType === "ledger" && event.action === "payment") {
      const current = Number(state[key]?.balance ?? 0) - Number(event.payload.amount ?? 0);
      state[key] = { balance: current };
      continue;
    }
```

In `frontend/src/domain/shift.ts`, add `collectionCash: number` to the `Shift` type after `expectedDrawer`, set `collectionCash: 0` in `openShift`, and change `closeShift`:

```ts
export function closeShift(
  shift: Shift,
  sales: SaleLine[],
  closedAt: number,
  collections: number[] = [],
): Shift {
  const collectionCash = collections.reduce((n, amount) => n + amount, 0);
  const cashCollected = sales.reduce((n, line) => n + line.cashPaid, 0) + collectionCash;
  const zTotal = sales.reduce((n, line) => n + line.amount, 0);
  const creditIssued = sales.reduce((n, line) => n + Math.max(line.amount - line.cashPaid, 0), 0);
  return {
    ...shift,
    status: "closed",
    cashCollected,
    creditIssued,
    zTotal,
    expectedDrawer: shift.floatAmount + cashCollected,
    collectionCash,
    closedAt,
  };
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/domain/conflict.test.ts src/domain/shift.test.ts`
Expected: 5 + 3 passed

- [x] **Step 5: Checkpoint (do not commit)**

Run: `npx tsc --noEmit`
Expected: no errors.

---

### Task 9: Frontend RBAC catalog, cap backfill, and voice key

**Files:**
- Modify: `frontend/src/domain/rbac.ts`, `frontend/src/domain/nlp.ts`
- Test: `frontend/src/domain/rbac.test.ts`, `frontend/src/domain/nlp.test.ts`

**Interfaces:**
- Consumes: `CATALOG`, `defaultCaps`, `voiceKey` (existing)
- Produces:
  - `CATALOG` includes `agent.collection` and `hitl.advance`
  - enterer default `hitl.advance` is `confirm`
  - `voiceKey("payment") === "agent.collection"`
  - `backfillCaps(caps: Caps): Caps` fills any missing CATALOG key per role from `defaultCaps()`
  - `parseVoiceCommand` keeps intent `payment` and extracts `entities.amount` and `entities.customer` for `joma` / `receive` / `payment`

- [x] **Step 1: Write the failing tests**

Append to `frontend/src/domain/rbac.test.ts` (add `backfillCaps` to the existing import list):

```ts
  it("includes collection catalog keys and defaults", () => {
    const caps = defaultCaps();
    expect(CATALOG).toContain("agent.collection");
    expect(CATALOG).toContain("hitl.advance");
    expect(caps.enterer["agent.collection"]).toBe("allow");
    expect(caps.enterer["hitl.advance"]).toBe("confirm");
  });

  it("maps payment voice intent to agent.collection", () => {
    expect(voiceKey("payment")).toBe("agent.collection");
  });

  it("backfills missing catalog keys from defaults", () => {
    const caps = defaultCaps();
    delete caps.enterer["agent.collection"];
    delete caps.enterer["hitl.advance"];
    const restored = backfillCaps(caps);
    expect(restored.enterer["agent.collection"]).toBe("allow");
    expect(restored.enterer["hitl.advance"]).toBe("confirm");
  });
```

Note: also add `CATALOG` and `backfillCaps` to the imports at the top of `rbac.test.ts`.

Append to `frontend/src/domain/nlp.test.ts`:

```ts
  it("parses a Bangla joma payment with amount and customer", () => {
    const result = parseVoiceCommand("রহিম কে 5000 টাকা জমা নিলাম");
    expect(result.intent).toBe("payment");
    expect(result.entities.amount).toBe(5000);
    expect(String(result.entities.customer).toLowerCase()).toContain("rahim");
  });
```

Note: the existing NLP regex keys on `to|ke` followed by a Latin word, so this utterance uses a Latin customer name after the Bangla `কে`. If `parseVoiceCommand` does not extract it, extend the customer regex in `nlp.ts` to also match `কে\s+([a-z]+)` (the current pattern `(?:to|ke)\s+([a-z]+)` already matches `ke rahim`; for the Bangla `কে` character add `(?:to|ke|কে)\s+([a-z]+)`). The amount regex already matches `(\d[\d,]*)\s*(?:taka|tk|bdt)` only for Latin units, so also match `টাকা`: change the amount regex to `(?:for|taka|tk|bdt|টাকা)\s*(\d[\d,]*)|(\d[\d,]*)\s*(?:taka|tk|bdt|টাকা)`.

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/domain/rbac.test.ts src/domain/nlp.test.ts`
Expected: FAIL on the new catalog/backfill/voiceKey/payment assertions

- [x] **Step 3: Write the minimal implementation**

In `frontend/src/domain/rbac.ts`:

- Add `"agent.collection"` after `"agent.reminder"` and `"hitl.advance"` after `"hitl.credit_override"` in `CATALOG`.
- Add `enterer["hitl.advance"] = "confirm";` in `defaultCaps()`.
- Extend `voiceKey`:

```ts
export function voiceKey(
  intent: string,
): "agent.sale" | "agent.spoilage" | "agent.reminder" | "agent.collection" | "agent.confirm_reply" | null {
  if (intent === "sale") return "agent.sale";
  if (intent === "spoilage") return "agent.spoilage";
  if (intent === "debt_reminder") return "agent.reminder";
  if (intent === "payment") return "agent.collection";
  if (intent === "confirm") return "agent.confirm_reply";
  return null;
}
```

- Add `backfillCaps` near `clipOwner`:

```ts
export function backfillCaps(caps: Caps): Caps {
  const defaults = defaultCaps();
  const roles: Role[] = ["super_admin", "owner", "enterer"];
  const next = {} as Caps;
  for (const role of roles) {
    next[role] = { ...defaults[role], ...(caps?.[role] ?? {}) };
  }
  return next;
}
```

In `frontend/src/domain/nlp.ts`, change the amount and customer regexes:

```ts
  const amountMatch = text.match(
    /(?:for|taka|tk|bdt|টাকা)\s*(\d[\d,]*)|(\d[\d,]*)\s*(?:taka|tk|bdt|টাকা)/,
  );
```

```ts
  const customerMatch = text.match(/(?:to|ke|কে)\s+([a-z]+)/);
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/domain/rbac.test.ts src/domain/nlp.test.ts`
Expected: 9 + 4 passed

- [x] **Step 5: Checkpoint (do not commit)**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass, no type errors.

---

### Task 10: Frontend store types, seed, and offline collection

**Files:**
- Modify: `frontend/src/store/types.ts`, `frontend/src/store/seed.ts`, `frontend/src/store/offline.ts`
- Test: `frontend/src/store/offline.test.ts`

**Interfaces:**
- Consumes: `applyCollection` (Task 7), `backfillCaps` (Task 9), `queueEvent` / `recalc` (existing)
- Produces:
  - `Collection` type: `{ id; customer_id; customer_name; amount; note?; is_advance; created_at }`
  - `AppState.collections: Collection[]`
  - `ShiftState.collectionCash: number`
  - `applyLocalCollection(state, { customerId, amount, note?, confirmOverride? }) -> { state; collection: Collection | null; tts; hitl?: "advance" }`
  - `recalc` cash includes collections; `hydrateState` backfills caps, defaults collections and shift cash

- [x] **Step 1: Write the failing tests**

Append to `frontend/src/store/offline.test.ts` (add `applyLocalCollection` and `hydrateState` to the imports):

```ts
describe("local collection", () => {
  it("reduces balance and queues a ledger payment", () => {
    const result = applyLocalCollection(defaultState(), { customerId: "rahim", amount: 50000 });
    expect(result.collection).not.toBeNull();
    expect(result.collection?.is_advance).toBe(false);
    expect(result.collection?.customer_id).toBe("rahim");
    const customer = result.state.customers.find((c) => c.id === "rahim");
    expect(customer?.credit_balance).toBe(100000);
    const event = result.state.queue.at(-1);
    expect(event?.entityType).toBe("ledger");
    expect(event?.entityId).toBe("rahim");
    expect(event?.action).toBe("payment");
    expect(event?.payload).toEqual({ amount: 50000 });
    expect(result.state.kpis.cash_today).toBe(50000);
  });

  it("returns hitl for an overpay without override and does not commit", () => {
    const result = applyLocalCollection(defaultState(), { customerId: "rahim", amount: 200000 });
    expect(result.hitl).toBe("advance");
    expect(result.collection).toBeNull();
    expect(result.state.collections).toHaveLength(0);
  });

  it("allows an overpay with override as an advance", () => {
    const result = applyLocalCollection(defaultState(), {
      customerId: "rahim",
      amount: 200000,
      confirmOverride: true,
    });
    expect(result.collection?.is_advance).toBe(true);
    const customer = result.state.customers.find((c) => c.id === "rahim");
    expect(customer?.credit_balance).toBe(-50000);
  });
});

describe("hydrateState collection migration", () => {
  it("defaults collections and backfills catalog caps", () => {
    const base = defaultState();
    delete base.permissions.caps.enterer["agent.collection"];
    const hydrated = hydrateState(base);
    expect(hydrated.collections).toEqual([]);
    expect(hydrated.permissions.caps.enterer["agent.collection"]).toBe("allow");
    expect(hydrated.shift.collectionCash).toBe(0);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/store/offline.test.ts`
Expected: FAIL because `applyLocalCollection` is not exported

- [x] **Step 3: Write the minimal implementation**

In `frontend/src/store/types.ts`, add after `Reminder`:

```ts
export type Collection = {
  id: string;
  customer_id: string;
  customer_name: string;
  amount: number;
  note?: string;
  is_advance: boolean;
  created_at: string;
};
```

Add `collections: Collection[];` to `AppState` after `reminders`, and `collectionCash: number;` to `ShiftState` after `expectedDrawer`.

In `frontend/src/store/seed.ts`, add `collections: [],` after `reminders: []`, and `collectionCash: 0,` in the shift object after `expectedDrawer: 5000,`.

In `frontend/src/store/offline.ts`:

- Add imports: `import { applyCollection } from "../domain/collection";` and `backfillCaps` from `../domain/rbac`, plus `Collection` to the type import.
- In `recalc`, replace the `cash` computation:

```ts
  const cash =
    state.sales.reduce((n, s) => n + (s.cash_paid ?? (s.on_credit ? 0 : s.amount)), 0) +
    (state.collections ?? []).reduce((n, c) => n + c.amount, 0);
```

- In `hydrateState`, add `collections: raw.collections ?? [],` after `reminders`, wrap caps with backfill, and default shift cash:

```ts
    collections: raw.collections ?? [],
    shift: raw.shift
      ? { ...base.shift, ...raw.shift, collectionCash: raw.shift.collectionCash ?? 0 }
      : base.shift,
```

```ts
      caps: backfillCaps(raw.permissions?.caps ?? base.permissions.caps),
```

- Add `applyLocalCollection` after `applyLocalReminder`:

```ts
export function applyLocalCollection(
  state: AppState,
  input: { customerId: string; amount: number; note?: string; confirmOverride?: boolean },
): { state: AppState; collection: Collection | null; tts: { bn: string; en: string }; hitl?: string } {
  const customer = state.customers.find((c) => c.id === input.customerId);
  if (!customer) throw new Error("customer not found");
  let result;
  try {
    result = applyCollection(customer.credit_balance, input.amount, input.confirmOverride);
  } catch (err) {
    if (err instanceof Error && err.message === "advance exceeds dues" && !input.confirmOverride) {
      return { state, collection: null, tts: { bn: "", en: "" }, hitl: "advance" };
    }
    throw err;
  }
  const collection: Collection = {
    id: crypto.randomUUID(),
    customer_id: customer.id,
    customer_name: customer.name,
    amount: input.amount,
    note: input.note,
    is_advance: result.isAdvance,
    created_at: new Date().toISOString(),
  };
  const nextCustomer: Customer = { ...customer, credit_balance: result.newBalance };
  let next: AppState = {
    ...state,
    customers: state.customers.map((c) => (c.id === customer.id ? nextCustomer : c)),
    collections: [...state.collections, collection],
  };
  next = queueEvent(next, "ledger", customer.id, "payment", { amount: input.amount });
  const tts = result.isAdvance
    ? {
        bn: `সংরক্ষিত। ${customer.name_bn} এর কাছে ${input.amount} টাকা অগ্রিম জমা নেওয়া হয়েছে। ব্যালেন্স ${result.newBalance} টাকা।`,
        en: `Saved. Collected ${input.amount} Taka advance from ${customer.name}. Balance ${result.newBalance} Taka.`,
      }
    : {
        bn: `সংরক্ষিত। ${customer.name_bn} এর কাছে ${input.amount} টাকা জমা হয়েছে। বাকি ${result.newBalance} টাকা।`,
        en: `Saved. Collected ${input.amount} Taka from ${customer.name}. Remaining ${result.newBalance} Taka.`,
      };
  return { state: next, collection, tts };
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/store/offline.test.ts`
Expected: 5 passed

- [x] **Step 5: Checkpoint (do not commit)**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass, no type errors.

---

### Task 11: Frontend copy, Ledger collect/khata, Shift row, Settings card

**Files:**
- Modify: `frontend/src/i18n/copy.ts`, `frontend/src/screens/Ledger.tsx`, `frontend/src/screens/Shift.tsx`, `frontend/src/screens/Settings.tsx`
- Test: `npx tsc --noEmit` plus Task 12 wiring

**Interfaces:**
- Consumes: `Collection` (Task 10), `deriveKhata` (Task 7)
- Produces:
  - New copy keys: `collect`, `joma`, `advance`, `khata`, `opening`, `hitlAdvance`, `note`
  - `Ledger` props: `customers`, `collections`, `onRemind`, `onCollect(id: string, amount: number, note: string)`
  - Dues chip colour: red `> 0`, green `=== 0`, yellow `< 0`
  - `ShiftScreen` shows a `collectionCash` row
  - `OWNER_CARDS` ledger keys become `["screen.ledger", "agent.reminder", "agent.collection"]`

- [x] **Step 1: Add the copy keys**

In `frontend/src/i18n/copy.ts`, add to `bn` before `resetDefaults`:

```ts
    collect: "জমা নিন",
    joma: "জমা",
    advance: "অগ্রিম",
    khata: "খাতা",
    opening: "আগের বাকি",
    hitlAdvance: "এই জমা বাকির চেয়ে বেশি। অগ্রিম রাখবেন?",
    note: "নোট",
```

Add to `en` in the same positions:

```ts
    collect: "Collect",
    joma: "Deposit",
    advance: "Advance",
    khata: "Khata",
    opening: "Opening due",
    hitlAdvance: "This deposit exceeds dues. Keep as advance?",
    note: "Note",
```

- [x] **Step 2: Replace `Ledger.tsx`**

```tsx
import { useState } from "react";
import { deriveKhata } from "../domain/collection";
import { copy, type Lang } from "../i18n/copy";
import type { Collection, Customer } from "../store/types";

type LedgerProps = {
  lang: Lang;
  customers: Customer[];
  collections: Collection[];
  onRemind: (id: string, channel: "sms" | "whatsapp") => void;
  onCollect: (id: string, amount: number, note: string) => void;
};

export function Ledger({ lang, customers, collections, onRemind, onCollect }: LedgerProps) {
  const t = copy[lang];
  const [openId, setOpenId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const chipClass = (balance: number) => (balance > 0 ? "red" : balance === 0 ? "green" : "yellow");

  return (
    <div className="panel">
      <h2>{t.ledger}</h2>
      {customers.map((c) => {
        const khata = deriveKhata(
          c.credit_balance,
          [],
          collections.filter((entry) => entry.customer_id === c.id),
        );
        return (
          <div key={c.id} className="list-item stack">
            <div>
              <button type="button" className="btn ghost" onClick={() => setOpenId(openId === c.id ? null : c.id)}>
                <strong>{lang === "bn" ? c.name_bn : c.name}</strong>
              </button>
              <div className={`chip ${chipClass(c.credit_balance)}`}>
                {t.dues}: {c.credit_balance.toLocaleString()}
              </div>
              <div className="chip yellow">
                {t.crateBal}: {c.crate_balance}
              </div>
            </div>
            <div className="stack">
              <div className="row">
                <input
                  type="number"
                  min={1}
                  placeholder={t.collect}
                  value={openId === c.id ? amount : ""}
                  onChange={(e) => {
                    setOpenId(c.id);
                    setAmount(e.target.value);
                  }}
                />
                <input
                  type="text"
                  placeholder={t.note}
                  value={openId === c.id ? note : ""}
                  onChange={(e) => {
                    setOpenId(c.id);
                    setNote(e.target.value);
                  }}
                />
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    const value = Number(amount);
                    if (!Number.isFinite(value) || value <= 0) return;
                    onCollect(c.id, value, note);
                    setAmount("");
                    setNote("");
                  }}
                >
                  {t.collect}
                </button>
              </div>
              <button type="button" className="btn ghost" disabled={c.credit_balance <= 0} onClick={() => onRemind(c.id, "sms")}>
                {t.sendSms}
              </button>
              <button type="button" className="btn ghost" disabled={c.credit_balance <= 0} onClick={() => onRemind(c.id, "whatsapp")}>
                {t.sendWa}
              </button>
            </div>
            {openId === c.id && (
              <div className="stack">
                <strong>{t.khata}</strong>
                {khata.opening !== 0 && (
                  <div className="list-item">
                    <span>{t.opening}</span>
                    <strong>{khata.opening.toLocaleString()}</strong>
                  </div>
                )}
                {khata.lines.map((line) => (
                  <div key={`${line.kind}-${line.id}`} className="list-item">
                    <span>
                      {line.kind === "sale" ? t.baki : t.joma}
                      {line.isAdvance ? ` · ${t.advance}` : ""}
                    </span>
                    <span>
                      {line.kind === "sale" ? "-" : "+"}
                      {line.amount.toLocaleString()} · {line.balance.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

Note: the khata here filters `collections` only. Real khata history also needs the customer's sales. `App.tsx` passes `state.sales`; add a `sales` prop of type `Sale[]` and build `CollectionSaleInput[]` from sales filtered by `customer_id` before calling `deriveKhata`. Update the props to `sales: Sale[]` and the call to:

```tsx
        const khata = deriveKhata(
          c.credit_balance,
          sales
            .filter((sale) => sale.customer_id === c.id)
            .map((sale) => ({
              id: sale.id,
              amount: sale.amount,
              cash_paid: sale.cash_paid ?? (sale.on_credit ? 0 : sale.amount),
              on_credit: sale.on_credit,
              created_at: sale.created_at,
            })),
          collections.filter((entry) => entry.customer_id === c.id),
        );
```

- [x] **Step 3: Add the Shift row**

In `frontend/src/screens/Shift.tsx`, add after the cash row:

```tsx
      <div className="list-item">
        <span>{t.joma}</span>
        <strong>{shift.collectionCash.toLocaleString()}</strong>
      </div>
```

- [x] **Step 4: Update the Owner Baki card**

In `frontend/src/screens/Settings.tsx`, change the ledger card:

```ts
  { id: "ledger", labelKey: "ledger", keys: ["screen.ledger", "agent.reminder", "agent.collection"] },
```

- [x] **Step 5: Checkpoint (do not commit)**

Run: `npx tsc --noEmit`
Expected: type errors only for the not-yet-updated `App.tsx` Ledger props; Task 12 resolves them. Confirm the only errors are the `Ledger` `sales`/`collections`/`onCollect` props in `App.tsx`.

---

### Task 12: Frontend App collection flow and voice routing

**Files:**
- Modify: `frontend/src/App.tsx`
- Test: `npx vitest run` + `npx tsc --noEmit` (App has no unit tests; verify via type-check and the running preview)

**Interfaces:**
- Consumes: `applyLocalCollection` (Task 10), `cellOf` (existing), `deriveKhata` usage in Ledger (Task 11)
- Produces:
  - Manual collect -> confirm sheet -> commit; overpay -> advance HITL sheet
  - Voice intent `payment` prefills the collect form, opens the ledger, opens the confirm sheet
  - Low-confidence fallback opens the ledger when allowed
  - Shift close passes collection amounts and stores `collectionCash`

- [x] **Step 1: Add collection state and types**

In `frontend/src/App.tsx`:

- Add `applyLocalCollection` to the `./store/offline` import.
- Add a draft type near `SaleDraft`:

```ts
type CollectDraft = { customerId: string; amount: number; note: string };
```

- Add state near the other form state:

```ts
  const [collectForm, setCollectForm] = useState<CollectDraft>({ customerId: "rahim", amount: 0, note: "" });
  const [pendingCollect, setPendingCollect] = useState<null | { form: CollectDraft; prompt: string }>(null);
  const [collectHitl, setCollectHitl] = useState<null | { form: CollectDraft }>(null);
```

- [x] **Step 2: Add commit and confirm functions**

After `commitSale`, add:

```ts
  const commitCollection = (override = false, form = collectForm) => {
    try {
      if (!allowed("screen.ledger") && !allowed("agent.collection")) {
        setBanner(t.forbidden);
        return;
      }
      const result = applyLocalCollection(state, {
        customerId: form.customerId,
        amount: form.amount,
        note: form.note || undefined,
        confirmOverride: override,
      });
      if (result.hitl) {
        if (cellOf(state.permissions.caps, state.permissions.owner, role, "hitl.advance") === "deny") {
          setBanner(t.forbidden);
          return;
        }
        setCollectHitl({ form });
        return;
      }
      if (!result.collection) return;
      save(result.state);
      setPendingCollect(null);
      announce(result.tts);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : t.fallback);
    }
  };

  const requestCollectConfirm = (form: CollectDraft) => {
    const customer = state.customers.find((c) => c.id === form.customerId);
    if (!customer) {
      commitCollection(false, form);
      return;
    }
    const name = lang === "bn" ? customer.name_bn : customer.name;
    const prompt =
      lang === "bn"
        ? `${name}, জমা ${form.amount} টাকা — ঠিক?`
        : `${name}, deposit ${form.amount} Taka — correct?`;
    setCollectForm(form);
    setPendingCollect({ form, prompt });
    announce(prompt);
  };
```

- [x] **Step 3: Route confirm replies for collections**

At the top of `handleConfirmReply`, add:

```ts
    if (pendingCollect) {
      const reply = parseConfirmReply(utterance);
      if (reply.decision === "commit") {
        commitCollection(false, pendingCollect.form);
        return true;
      }
      setPendingCollect(null);
      setBanner(t.cancel);
      return true;
    }
```

- [x] **Step 4: Add payment voice routing**

In `runVoice`, change the fallback branch to open the ledger when allowed:

```ts
    if (parsed.needsFallback || confidence < 0.8) {
      setBanner(t.fallback);
      if (allowed("screen.ledger")) setScreen("ledger");
      else if (allowed("screen.sale")) setScreen("sale");
      return;
    }
```

Add a `payment` branch before the final `setBanner(t.fallback)`:

```ts
    if (parsed.intent === "payment") {
      const amount = Number(parsed.entities.amount ?? 0);
      const form: CollectDraft = { customerId: customer?.id ?? collectForm.customerId, amount, note: "" };
      setCollectForm(form);
      if (allowed("screen.ledger")) setScreen("ledger");
      if (customer && amount > 0) requestCollectConfirm(form);
      return;
    }
```

- [x] **Step 5: Wire the Ledger screen props**

Replace the `screen === "ledger"` block:

```tsx
        {screen === "ledger" && (
          <Ledger
            lang={lang}
            customers={state.customers}
            sales={state.sales}
            collections={state.collections}
            onRemind={(id, channel) => {
              const next = applyLocalReminder(state, id, channel);
              save(next);
              const note = next.reminders[next.reminders.length - 1];
              announce({ bn: note.audio_bn, en: note.audio_en });
            }}
            onCollect={(id, amount, note) => requestCollectConfirm({ customerId: id, amount, note })}
          />
        )}
```

- [x] **Step 6: Wire the shift close collection cash**

In the `ShiftScreen` `onClose`, replace the `closeShift(...)` call's fourth argument and the saved shift fields:

```ts
              const closed = closeShift(
                {
                  cashier: state.shift.cashier,
                  floatAmount: state.shift.floatAmount,
                  openedAt: Date.now(),
                  status: state.shift.status,
                  cashCollected: 0,
                  creditIssued: 0,
                  zTotal: 0,
                  expectedDrawer: state.shift.floatAmount,
                  collectionCash: 0,
                  closedAt: null,
                },
                state.sales.map((sale) => ({
                  amount: sale.amount,
                  cashPaid: sale.cash_paid ?? (sale.on_credit ? 0 : sale.amount),
                })),
                Date.now(),
                state.collections.map((collection) => collection.amount),
              );
              save({
                ...state,
                shift: {
                  cashier: closed.cashier,
                  floatAmount: closed.floatAmount,
                  status: closed.status,
                  cashCollected: closed.cashCollected,
                  creditIssued: closed.creditIssued,
                  zTotal: closed.zTotal,
                  expectedDrawer: closed.expectedDrawer,
                  collectionCash: closed.collectionCash,
                },
              });
```

Also add `collectionCash: 0,` to the `openShift` result mapping in the shift `onOpen` handler.

- [x] **Step 7: Add the advance HITL sheet**

After the existing `hitl` sheet block, add:

```tsx
      {collectHitl && (
        <div className="modal-scrim" role="dialog" aria-modal="true" aria-labelledby="collect-hitl-title">
          <div className="sheet">
            <h2 id="collect-hitl-title">{t.hitlTitle}</h2>
            <p>{t.hitlAdvance}</p>
            <div className="row">
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  const form = collectHitl.form;
                  setCollectHitl(null);
                  commitCollection(true, form);
                }}
              >
                {t.confirm}
              </button>
              <button type="button" className="btn ghost" onClick={() => setCollectHitl(null)}>
                {t.cancel}
              </button>
            </div>
          </div>
        </div>
      )}
```

- [x] **Step 8: Run tests and type-check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [x] **Step 9: Checkpoint (do not commit)**

Run backend and frontend suites together:

Run: `python -m pytest -q` (from `backend/`) and `npx vitest run` (from `frontend/`)
Expected: all pass.

---

## Self-Review

**1. Spec coverage**

| Spec requirement | Task |
| --- | --- |
| 4.1 Collection record | Task 6 (server), Task 10 (`Collection` type) |
| 4.2 `apply_collection` rules | Task 1, Task 7 |
| 4.3 Khata derivation | Task 2, Task 7 |
| 4.4 Shift and KPIs | Task 4, Task 6, Task 8, Task 10, Task 12 |
| 4.5 Sync and conflict | Task 3, Task 8, Task 10 |
| 5.1 `POST /api/collections` | Task 6 |
| 5.2 Bootstrap `collections` | Task 6 |
| 5.3 Shift close | Task 6, Task 12 |
| 5.4 Untouched endpoints | no change required |
| 6 RBAC keys | Task 5, Task 9 |
| 6.1 Cap migration | Task 9 (backfillCaps), Task 10 (hydrate) |
| 7.1 Ledger collect + khata | Task 11 |
| 7.2 Confirm and HITL sheets | Task 12 |
| 7.3 Voice and typed entry | Task 9, Task 12 |
| 8 Copy | Task 11 |
| 9 Errors | Task 6 |
| 10 Tests | every task |

**2. Placeholder scan:** no `TBD`/`TODO`/"handle edge cases"; every code step contains full code.

**3. Type consistency:** Python `CollectionResult.new_balance` / `is_advance` / `advance_delta` match tests; TS `CollectionResult.newBalance` / `isAdvance` / `advanceDelta` match. `applyLocalCollection` returns `hitl: "advance"` which `App.tsx` and the store tests both consume. `closeShift` fourth argument `collections: number[]` is fed `state.collections.map((c) => c.amount)` and server `close_shift` receives `collections=[...]`. `CATALOG` additions match between `rbac.py` and `rbac.ts`.
