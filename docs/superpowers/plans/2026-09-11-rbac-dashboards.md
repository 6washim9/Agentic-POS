# Role-Based Dashboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Super Admin `/admin` permission matrix, Owner Settings cards, and Enterer POS gating so screens, agent intents, and HITL overrides are `allow` | `confirm` | `deny`.

**Architecture:** Same Vite+FastAPI app. Permissions are a two-layer document (`caps` set by Super Admin, `owner` overrides for Enterer only). `effective(role, key)` takes the weaker cell. UI `can()` hides screens and refuses voice; FastAPI checks `X-Role` and returns 403. No JWT, PIN, or extra roles.

**Tech Stack:** Python 3 FastAPI + existing domain tests (`pytest`). React 18 + TypeScript + Vitest. Encrypted local `AppState` + `/api` Vite proxy.

## Global Constraints

- Roles are exactly `super_admin` | `owner` | `enterer`.
- Cells are exactly `deny` < `confirm` < `allow` (weaker wins).
- Owner may only write Enterer overrides and must not expand Super Admin caps (`403 CAP_EXCEEDED`).
- Super Admin `screen.admin` is forced `allow` on save.
- Missing permission key resolves to `deny`.
- Credit-limit business HITL is never skipped by RBAC `allow`; RBAC may only `deny` the override.
- Voice confirm-before-commit is independent of RBAC.
- Bangla default copy; no emoji in UI or docs.
- TDD: failing test first for every domain/API behavior.
- Do not commit unless the user explicitly asks.
- Follow existing patterns in `backend/app/domain/` and `frontend/src/domain/`.

## File map

Create:

- `backend/app/domain/rbac.py`
- `backend/tests/test_rbac.py`
- `frontend/src/domain/rbac.ts`
- `frontend/src/domain/rbac.test.ts`
- `frontend/src/screens/AdminMatrix.tsx`
- `frontend/src/screens/Settings.tsx`

Modify:

- `backend/app/main.py` — Store.permissions, snapshot, X-Role, permission endpoints, gate mutations
- `frontend/src/store/types.ts` — Role, Cell, Permissions, session, Screen admin/settings
- `frontend/src/store/seed.ts` — default session + permissions
- `frontend/src/store/offline.ts` — hydrate session/permissions
- `frontend/src/store/sync.ts` — send X-Role on fetch
- `frontend/src/i18n/copy.ts` — role/settings/admin strings
- `frontend/src/App.tsx` — role chip, can() gates, admin/settings screens
- `frontend/src/screens/Home.tsx` — hide denied KPIs; Owner settings button
- `frontend/src/styles/global.css` — matrix + settings cards

---

### Task 1: RBAC domain engine (Python)

**Files:**
- Create: `backend/app/domain/rbac.py`
- Test: `backend/tests/test_rbac.py`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `Role = Literal["super_admin", "owner", "enterer"]`
  - `Cell = Literal["deny", "confirm", "allow"]`
  - `CATALOG: tuple[str, ...]`
  - `RANK = {"deny": 0, "confirm": 1, "allow": 2}`
  - `default_caps() -> dict[str, dict[str, Cell]]`
  - `weaker(a: Cell, b: Cell) -> Cell`
  - `effective(caps, owner_overrides, role, key) -> Cell`
  - `clip_owner(caps_enterer, owner_overrides) -> dict[str, Cell]`
  - `force_super_admin_admin(caps) -> dict`
  - `validate_keys(mapping) -> str | None`  (`UNKNOWN_KEY` or None)
  - `owner_exceeds_cap(caps_enterer, owner_overrides) -> str | None` (key or None)

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_rbac.py`:

```python
from app.domain.rbac import (
    clip_owner,
    default_caps,
    effective,
    force_super_admin_admin,
    owner_exceeds_cap,
    validate_keys,
    weaker,
)


def test_weaker_prefers_deny():
    assert weaker("allow", "deny") == "deny"
    assert weaker("confirm", "allow") == "confirm"


def test_enterer_uses_min_of_cap_and_owner_override():
    caps = default_caps()
    caps["enterer"]["screen.warehouse"] = "allow"
    owner = {"screen.warehouse": "deny"}
    assert effective(caps, owner, "enterer", "screen.warehouse") == "deny"


def test_missing_key_is_deny():
    caps = default_caps()
    assert effective(caps, {}, "enterer", "screen.unknown") == "deny"


def test_owner_allow_is_clipped_to_confirm_cap():
    cap = {"hitl.credit_override": "confirm"}
    owner = {"hitl.credit_override": "allow"}
    clipped = clip_owner(cap, owner)
    assert clipped["hitl.credit_override"] == "confirm"


def test_owner_exceeds_cap_detected():
    cap = {"hitl.credit_override": "confirm"}
    owner = {"hitl.credit_override": "allow"}
    assert owner_exceeds_cap(cap, owner) == "hitl.credit_override"


def test_super_admin_screen_admin_forced_allow():
    caps = default_caps()
    caps["super_admin"]["screen.admin"] = "deny"
    forced = force_super_admin_admin(caps)
    assert forced["super_admin"]["screen.admin"] == "allow"


def test_unknown_key_rejected():
    assert validate_keys({"not.a.key": "allow"}) == "UNKNOWN_KEY"
    assert validate_keys({"screen.sale": "allow"}) is None


def test_enterer_defaults():
    caps = default_caps()
    assert caps["enterer"]["screen.settings"] == "deny"
    assert caps["enterer"]["screen.admin"] == "deny"
    assert caps["enterer"]["agent.sale"] == "allow"
    assert caps["enterer"]["hitl.credit_override"] == "confirm"
    assert caps["owner"]["screen.admin"] == "deny"
    assert caps["super_admin"]["screen.admin"] == "allow"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH=backend python3 -m pytest backend/tests/test_rbac.py -q`

Expected: FAIL with `ModuleNotFoundError: app.domain.rbac`

- [ ] **Step 3: Write minimal implementation**

Create `backend/app/domain/rbac.py`:

```python
from typing import Literal

Role = Literal["super_admin", "owner", "enterer"]
Cell = Literal["deny", "confirm", "allow"]

CATALOG: tuple[str, ...] = (
    "screen.home",
    "screen.catalog",
    "screen.sale",
    "screen.ledger",
    "screen.warehouse",
    "screen.landed",
    "screen.spoilage",
    "screen.receipt",
    "screen.shift",
    "screen.settings",
    "screen.admin",
    "agent.sale",
    "agent.spoilage",
    "agent.reminder",
    "agent.confirm_reply",
    "hitl.credit_override",
    "hitl.shift_close",
    "hitl.write_off",
)

RANK = {"deny": 0, "confirm": 1, "allow": 2}


def weaker(a: Cell, b: Cell) -> Cell:
    return a if RANK[a] <= RANK[b] else b


def _fill(cell: Cell) -> dict[str, Cell]:
    return {key: cell for key in CATALOG}


def default_caps() -> dict[str, dict[str, Cell]]:
    super_admin = _fill("allow")
    owner = _fill("allow")
    owner["screen.admin"] = "deny"
    enterer = _fill("allow")
    enterer["screen.settings"] = "deny"
    enterer["screen.admin"] = "deny"
    enterer["hitl.credit_override"] = "confirm"
    enterer["hitl.shift_close"] = "confirm"
    enterer["hitl.write_off"] = "confirm"
    return {"super_admin": super_admin, "owner": owner, "enterer": enterer}


def effective(
    caps: dict[str, dict[str, Cell]],
    owner_overrides: dict[str, Cell],
    role: str,
    key: str,
) -> Cell:
    if key not in CATALOG:
        return "deny"
    if role == "enterer":
        cap = caps.get("enterer", {}).get(key, "deny")
        override = owner_overrides.get(key)
        if override is None:
            return cap
        return weaker(cap, override)
    return caps.get(role, {}).get(key, "deny")


def clip_owner(caps_enterer: dict[str, Cell], owner_overrides: dict[str, Cell]) -> dict[str, Cell]:
    clipped: dict[str, Cell] = {}
    for key, cell in owner_overrides.items():
        cap = caps_enterer.get(key, "deny")
        clipped[key] = weaker(cap, cell)
    return clipped


def force_super_admin_admin(caps: dict[str, dict[str, Cell]]) -> dict[str, dict[str, Cell]]:
    next_caps = {role: dict(cells) for role, cells in caps.items()}
    next_caps.setdefault("super_admin", {})["screen.admin"] = "allow"
    return next_caps


def validate_keys(mapping: dict[str, Cell]) -> str | None:
    for key in mapping:
        if key not in CATALOG:
            return "UNKNOWN_KEY"
    return None


def owner_exceeds_cap(caps_enterer: dict[str, Cell], owner_overrides: dict[str, Cell]) -> str | None:
    for key, cell in owner_overrides.items():
        cap = caps_enterer.get(key, "deny")
        if RANK[cell] > RANK[cap]:
            return key
    return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH=backend python3 -m pytest backend/tests/test_rbac.py -q`

Expected: PASS (8 passed)

- [ ] **Step 5: Do not commit** unless the user asks.

---

### Task 2: RBAC domain engine (TypeScript)

**Files:**
- Create: `frontend/src/domain/rbac.ts`
- Test: `frontend/src/domain/rbac.test.ts`

**Interfaces:**
- Consumes: same catalog and defaults as Python Task 1
- Produces:
  - `export type Role = "super_admin" | "owner" | "enterer"`
  - `export type Cell = "deny" | "confirm" | "allow"`
  - `export const CATALOG: readonly string[]`
  - `export type Caps = Record<Role, Record<string, Cell>>`
  - `export type Permissions = { caps: Caps; owner: Record<string, Cell>; occurredAt: number }`
  - `defaultCaps(): Caps`
  - `weaker(a: Cell, b: Cell): Cell`
  - `effective(caps, owner, role, key): Cell`
  - `clipOwner(capsEnterer, owner): Record<string, Cell>`
  - `forceSuperAdminAdmin(caps): Caps`
  - `visibleScreens(role, caps, owner): string[]`
  - `voiceKey(intent: string): "agent.sale" | "agent.spoilage" | "agent.reminder" | "agent.confirm_reply" | null`
  - `can(perms, role, key): boolean` (true when cell !== deny)
  - `cellOf(perms, role, key): Cell`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/domain/rbac.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  clipOwner,
  defaultCaps,
  effective,
  forceSuperAdminAdmin,
  visibleScreens,
  voiceKey,
  weaker,
} from "./rbac";

describe("rbac", () => {
  it("weaker prefers deny", () => {
    expect(weaker("allow", "deny")).toBe("deny");
  });

  it("enterer effective is min of cap and owner override", () => {
    const caps = defaultCaps();
    caps.enterer["screen.warehouse"] = "allow";
    expect(effective(caps, { "screen.warehouse": "deny" }, "enterer", "screen.warehouse")).toBe("deny");
  });

  it("clips owner allow down to confirm cap", () => {
    const clipped = clipOwner({ "hitl.credit_override": "confirm" }, { "hitl.credit_override": "allow" });
    expect(clipped["hitl.credit_override"]).toBe("confirm");
  });

  it("forces super admin screen.admin allow", () => {
    const caps = defaultCaps();
    caps.super_admin["screen.admin"] = "deny";
    expect(forceSuperAdminAdmin(caps).super_admin["screen.admin"]).toBe("allow");
  });

  it("hides denied screens from tab list", () => {
    const caps = defaultCaps();
    caps.enterer["screen.warehouse"] = "deny";
    const ids = visibleScreens("enterer", caps, {});
    expect(ids).not.toContain("warehouse");
    expect(ids).toContain("sale");
    expect(ids).not.toContain("settings");
    expect(ids).not.toContain("admin");
  });

  it("maps voice intents to agent keys", () => {
    expect(voiceKey("sale")).toBe("agent.sale");
    expect(voiceKey("spoilage")).toBe("agent.spoilage");
    expect(voiceKey("debt_reminder")).toBe("agent.reminder");
    expect(voiceKey("unknown")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/domain/rbac.test.ts`

Expected: FAIL with `Failed to resolve import "./rbac"`

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/domain/rbac.ts` matching Python: same `CATALOG`, `RANK`, `defaultCaps`, `weaker`, `effective`, `clipOwner`, `forceSuperAdminAdmin`.

Also export:

```ts
export function cellOf(
  caps: Caps,
  owner: Record<string, Cell>,
  role: Role,
  key: string,
): Cell {
  return effective(caps, owner, role, key);
}

export function can(
  caps: Caps,
  owner: Record<string, Cell>,
  role: Role,
  key: string,
): boolean {
  return cellOf(caps, owner, role, key) !== "deny";
}

const SCREEN_IDS = [
  "home",
  "catalog",
  "sale",
  "ledger",
  "warehouse",
  "landed",
  "spoilage",
  "receipt",
  "shift",
  "settings",
  "admin",
] as const;

export function visibleScreens(
  role: Role,
  caps: Caps,
  owner: Record<string, Cell>,
): string[] {
  return SCREEN_IDS.filter((id) => can(caps, owner, role, `screen.${id}`));
}

export function voiceKey(intent: string): "agent.sale" | "agent.spoilage" | "agent.reminder" | "agent.confirm_reply" | null {
  if (intent === "sale") return "agent.sale";
  if (intent === "spoilage") return "agent.spoilage";
  if (intent === "debt_reminder") return "agent.reminder";
  if (intent === "confirm") return "agent.confirm_reply";
  return null;
}

export function defaultPermissions(): Permissions {
  return { caps: defaultCaps(), owner: {}, occurredAt: 0 };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/domain/rbac.test.ts`

Expected: PASS (6 tests)

- [ ] **Step 5: Do not commit** unless the user asks.

---

### Task 3: Types, seed, hydrate

**Files:**
- Modify: `frontend/src/store/types.ts`
- Modify: `frontend/src/store/seed.ts`
- Modify: `frontend/src/store/offline.ts`

**Interfaces:**
- Consumes: `Role`, `Cell`, `Permissions`, `defaultPermissions` from `frontend/src/domain/rbac.ts`
- Produces: `AppState.session.role`, `AppState.permissions`, `Screen` includes `"settings" | "admin"`

- [ ] **Step 1: Extend types**

In `frontend/src/store/types.ts` add imports and fields:

```ts
import type { Permissions, Role } from "../domain/rbac";

export type Session = { role: Role };

export type AppState = {
  // existing fields unchanged
  session: Session;
  permissions: Permissions;
};

export type Screen =
  | "home"
  | "catalog"
  | "sale"
  | "ledger"
  | "warehouse"
  | "landed"
  | "spoilage"
  | "wizard"
  | "receipt"
  | "shift"
  | "settings"
  | "admin";
```

- [ ] **Step 2: Seed defaults**

In `frontend/src/store/seed.ts` import `defaultPermissions` and add to `defaultState()`:

```ts
session: { role: "enterer" },
permissions: defaultPermissions(),
```

- [ ] **Step 3: Hydrate old snapshots**

In `hydrateState` after `shift: raw.shift ?? base.shift` add:

```ts
session: { role: raw.session?.role ?? "enterer" },
permissions: {
  caps: raw.permissions?.caps ?? base.permissions.caps,
  owner: raw.permissions?.owner ?? {},
  occurredAt: raw.permissions?.occurredAt ?? 0,
},
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`

Expected: PASS (App.tsx still compiles; extra Screen values are unused until Task 6)

- [ ] **Step 5: Do not commit** unless the user asks.

---

### Task 4: Permissions API + mutation gating

**Files:**
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_rbac.py` (append API tests) or create `backend/tests/test_rbac_api.py`

**Interfaces:**
- Consumes: `default_caps`, `effective`, `clip_owner`, `force_super_admin_admin`, `validate_keys`, `owner_exceeds_cap` from `app.domain.rbac`
- Produces:
  - `GET /api/permissions` → `{ caps, owner, occurred_at }`
  - `PUT /api/permissions/caps` Super Admin only
  - `PUT /api/permissions/owner` Owner or Super Admin
  - Header `X-Role` default `enterer`
  - Mutation 403 `{ "code": "FORBIDDEN", "key": "..." }`
  - Owner expand 403 `{ "code": "CAP_EXCEEDED", "key": "..." }`
  - Unknown key 400 `{ "code": "UNKNOWN_KEY" }`
  - `bootstrap` includes `permissions`

- [ ] **Step 1: Write failing API tests**

Create `backend/tests/test_rbac_api.py` using FastAPI `TestClient`:

```python
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
```

If `TestClient` is missing, install: `pip install --break-system-packages fastapi httpx` only if import fails. Prefer using already-installed FastAPI.

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH=backend python3 -m pytest backend/tests/test_rbac_api.py -q`

Expected: FAIL (404 on `/api/permissions` or AttributeError `store.permissions`)

- [ ] **Step 3: Implement Store + endpoints + gate**

In `Store.__init__`:

```python
from app.domain.rbac import (
    CATALOG,
    Cell,
    clip_owner,
    default_caps,
    effective,
    force_super_admin_admin,
    owner_exceeds_cap,
    validate_keys,
)

self.permissions = {"caps": default_caps(), "owner": {}, "occurred_at": 0}
```

Add to `snapshot()`:

```python
"permissions": self.permissions,
```

Helpers in `main.py`:

```python
from fastapi import Header

def read_role(x_role: str | None = Header(default=None, alias="X-Role")) -> str:
    if x_role in ("super_admin", "owner", "enterer"):
        return x_role
    return "enterer"


def require_any(role: str, keys: list[str]) -> None:
    cells = [effective(store.permissions["caps"], store.permissions["owner"], role, key) for key in keys]
    if all(cell == "deny" for cell in cells):
        raise HTTPException(403, detail={"code": "FORBIDDEN", "key": keys[0]})
```

Gate (call `require_any` at the top of each handler):

- `create_sale`: `require_any(role, ["screen.sale", "agent.sale"])`. If credit would exceed limit and `effective(..., "hitl.credit_override") == "deny"`, 403 with key `hitl.credit_override`. Do not skip existing HITL when cell is allow/confirm.
- `spoilage`: `["screen.spoilage", "agent.spoilage"]`; if `write_off` and `hitl.write_off == deny`, 403.
- `reminder`: `["agent.reminder", "screen.ledger"]`
- `landed`: `["screen.landed"]`
- `shift_close`: require `screen.shift` not deny AND `hitl.shift_close` not deny
- `update_config`: `["screen.settings", "screen.admin"]`
- `sync`: no extra gate

Endpoints:

```python
@app.get("/api/permissions")
def get_permissions() -> dict[str, Any]:
    return store.permissions


class CapsIn(BaseModel):
    caps: dict[str, dict[str, str]]


@app.put("/api/permissions/caps")
def put_caps(body: CapsIn, x_role: str | None = Header(default=None, alias="X-Role")) -> dict[str, Any]:
    role = x_role if x_role in ("super_admin", "owner", "enterer") else "enterer"
    if role != "super_admin":
        raise HTTPException(403, detail={"code": "FORBIDDEN", "key": "screen.admin"})
    flat = {k: v for cells in body.caps.values() for k, v in cells.items()}
    if validate_keys(flat):
        raise HTTPException(400, detail={"code": "UNKNOWN_KEY"})
    caps = force_super_admin_admin(body.caps)
    owner = clip_owner(caps["enterer"], store.permissions["owner"])
    store.permissions = {"caps": caps, "owner": owner, "occurred_at": int(datetime.now(timezone.utc).timestamp() * 1000)}
    return store.permissions


@app.put("/api/permissions/owner")
def put_owner(body: dict[str, str], x_role: str | None = Header(default=None, alias="X-Role")) -> dict[str, Any]:
    role = x_role if x_role in ("super_admin", "owner", "enterer") else "enterer"
    if role == "enterer":
        raise HTTPException(403, detail={"code": "FORBIDDEN", "key": "screen.settings"})
    if validate_keys(body):
        raise HTTPException(400, detail={"code": "UNKNOWN_KEY"})
    exceeded = owner_exceeds_cap(store.permissions["caps"]["enterer"], body)
    if exceeded:
        raise HTTPException(403, detail={"code": "CAP_EXCEEDED", "key": exceeded})
    store.permissions["owner"] = clip_owner(store.permissions["caps"]["enterer"], body)
    store.permissions["occurred_at"] = int(datetime.now(timezone.utc).timestamp() * 1000)
    return store.permissions
```

Inject `role = read_role(...)` into mutation endpoints. Keep function signatures compatible with FastAPI Header injection.

- [ ] **Step 4: Run tests**

Run: `PYTHONPATH=backend python3 -m pytest backend/tests/test_rbac.py backend/tests/test_rbac_api.py backend/tests -q`

Expected: all previous tests still pass plus new API tests.

- [ ] **Step 5: Do not commit** unless the user asks.

---

### Task 5: Copy + styles + Admin matrix + Owner settings screens

**Files:**
- Modify: `frontend/src/i18n/copy.ts`
- Modify: `frontend/src/styles/global.css`
- Create: `frontend/src/screens/AdminMatrix.tsx`
- Create: `frontend/src/screens/Settings.tsx`

**Interfaces:**
- Consumes: `CATALOG`, `Cell`, `Caps`, `Role`, `weaker`, `clipOwner`, `forceSuperAdminAdmin`, `defaultCaps` from `frontend/src/domain/rbac.ts`
- Produces: presentational screens only; parent owns save.

- [ ] **Step 1: Add copy keys** to both `bn` and `en` in `frontend/src/i18n/copy.ts`:

```
role, settings, admin, allow, deny, confirmCell, forbidden, capExceeded, resetDefaults
```

Bangla:

```
role: "ভূমিকা"
settings: "সেটিংস"
admin: "অ্যাডমিন"
allow: "অনুমতি"
deny: "নিষেধ"
confirmCell: "নিশ্চিত"
forbidden: "এই কাজের অনুমতি নেই।"
capExceeded: "সুপার অ্যাডমিন এই ফিচার সীমিত করেছেন।"
resetDefaults: "ডিফল্টে ফিরুন"
```

English:

```
role: "Role"
settings: "Settings"
admin: "Admin"
allow: "Allow"
deny: "Deny"
confirmCell: "Confirm"
forbidden: "You do not have permission for this."
capExceeded: "Super Admin capped this feature."
resetDefaults: "Reset defaults"
```

Role labels (not copy keys, hardcode in chip): `সুপার অ্যাডমিন` / `Super Admin`, `মালিক` / `Owner`, `এন্ট্রি` / `Enterer`.

- [ ] **Step 2: CSS** append to `frontend/src/styles/global.css`:

```css
.matrix {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.matrix th,
.matrix td {
  border: 1px solid var(--line);
  padding: 8px;
  text-align: center;
}
.matrix th:first-child,
.matrix td:first-child {
  text-align: left;
}
.cell-allow { background: var(--green-soft); color: var(--green); }
.cell-confirm { background: var(--yellow-soft); color: #854d0e; }
.cell-deny { background: var(--red-soft); color: var(--red); }
.settings-card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 14px;
}
```

- [ ] **Step 3: AdminMatrix screen**

`frontend/src/screens/AdminMatrix.tsx`:

Props:

```ts
type Props = {
  lang: Lang;
  shopName: string;
  caps: Caps;
  onChange: (caps: Caps) => void;
  onSave: () => void;
  onReset: () => void;
};
```

Render grouped rows (Screens / Agent / HITL) and columns Super Admin, Owner, Enterer. Cell button cycles `allow -> confirm -> deny -> allow`, except Super Admin `screen.admin` stays allow (no click). Super Admin other cells may cycle. Call `onChange(forceSuperAdminAdmin(next))`.

Cycle helper:

```ts
function nextCell(cell: Cell): Cell {
  if (cell === "allow") return "confirm";
  if (cell === "confirm") return "deny";
  return "allow";
}
```

- [ ] **Step 4: Owner Settings screen**

`frontend/src/screens/Settings.tsx`:

```ts
export const OWNER_CARDS: { id: string; labelKey: CopyKey; keys: string[] }[] = [
  { id: "sales", labelKey: "sale", keys: ["screen.sale", "agent.sale"] },
  { id: "catalog", labelKey: "catalog", keys: ["screen.catalog"] },
  { id: "ledger", labelKey: "ledger", keys: ["screen.ledger", "agent.reminder"] },
  { id: "warehouse", labelKey: "warehouse", keys: ["screen.warehouse", "screen.landed"] },
  { id: "spoilage", labelKey: "spoilage", keys: ["screen.spoilage", "agent.spoilage", "hitl.write_off"] },
  { id: "shift", labelKey: "shift", keys: ["screen.shift", "hitl.shift_close"] },
  { id: "credit", labelKey: "hitlTitle", keys: ["hitl.credit_override"] },
];
```

Props: `lang`, `capsEnterer: Record<string, Cell>`, `owner: Record<string, Cell>`, `onChange(owner)`, `onSave`.

Each card shows one control for the first key; applying a cell writes that cell to every key in the card via `clipOwner(capsEnterer, nextOwner)`. If chosen cell is stronger than cap, do not apply (parent will banner `capExceeded`).

Display cell = `weaker(capsEnterer[key], owner[key] ?? capsEnterer[key])`.

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc --noEmit`

Expected: PASS

---

### Task 6: Wire App gating, role chip, Home, sync header

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/screens/Home.tsx`
- Modify: `frontend/src/store/sync.ts`

**Interfaces:**
- Consumes: `can`, `cellOf`, `visibleScreens`, `voiceKey`, `forceSuperAdminAdmin`, `clipOwner`, `defaultCaps`, `defaultPermissions` from rbac
- Produces: gated POS + dashboards

- [ ] **Step 1: Home accepts `canGo` and optional settings**

Change `Home` props:

```ts
type HomeProps = {
  lang: Lang;
  kpis: Kpis;
  go: (s: Screen) => void;
  canGo: (screen: Screen) => boolean;
  showSettings: boolean;
};
```

Wrap each KPI/`go("shift")` so it renders only if `canGo` is true. If `showSettings`, add `<button className="btn ghost wide" onClick={() => go("settings")}>{t.settings}</button>`.

- [ ] **Step 2: sync.ts send X-Role**

Add optional `role` argument to `fetchBootstrap` and `pushQueue` and `postJson`:

```ts
headers: { "Content-Type": "application/json", "X-Role": role ?? "enterer" }
```

`fetchBootstrap` GET also sends `X-Role`.

- [ ] **Step 3: App.tsx wiring**

Imports: screens `AdminMatrix`, `Settings`; rbac helpers.

Helpers inside App:

```ts
const role = state.session.role;
const allowed = (key: string) => can(state.permissions.caps, state.permissions.owner, role, key);
const goGuarded = (next: Screen) => {
  if (next === "wizard") {
    setScreen("wizard");
    return;
  }
  if (!allowed(`screen.${next}`)) {
    setBanner(t.forbidden);
    setScreen(allowed("screen.home") ? "home" : allowed("screen.sale") ? "sale" : "home");
    return;
  }
  setScreen(next);
};
```

Topbar: add role chip button that cycles `enterer -> owner -> super_admin -> enterer` and `save({ ...state, session: { role: next } })`. Label uses lang.

Tab bar: filter `tabs` with `allowed(\`screen.${id}\`)`. Super Admin also sees an extra button to `admin` if allowed; Owner sees settings if allowed. Do not put admin in the 5-tab bar; add a topbar or Home entry. Home `showSettings={allowed("screen.settings")}`; if `allowed("screen.admin")` also add admin button on Home.

Voice `runVoice`: after parse, `const key = voiceKey(parsed.intent)`; if key and `!allowed(key)`, `setBanner(t.forbidden)` and return. Do not open confirm sheet.

`commitSale` HITL: if `cellOf(..., "hitl.credit_override") === "deny"` and result.hitl, banner forbidden and return (do not show override sheet). Existing confirm sheet still used when cell is confirm or allow.

Shift close: if `!allowed("hitl.shift_close")` and cell is deny, banner forbidden.

Admin save:

```ts
const caps = forceSuperAdminAdmin(state.permissions.caps);
const owner = clipOwner(caps.enterer, state.permissions.owner);
save({
  ...state,
  permissions: { caps, owner, occurredAt: Date.now() },
});
```

Queue event `permissions` / `caps` as existing `queueEvent` pattern if you expose it; otherwise save local state and `postJson("/api/permissions/caps", { caps }, role)`.

Owner Settings save: `postJson("/api/permissions/owner", ownerMap, role)`; on 403 CAP_EXCEEDED banner `t.capExceeded` and do not save.

Hydrate merge in bootstrap effect: if `remote.permissions` and `(remote.permissions.occurredAt ?? 0) >= persisted.permissions.occurredAt`, take server permissions then `clipOwner`. Never overwrite `session.role` from bootstrap.

Denied screen already open: when role changes, if current screen not allowed, `goGuarded("home")`.

- [ ] **Step 4: Frontend tests + typecheck**

Run:

```
cd frontend && npx vitest run && npx tsc --noEmit
PYTHONPATH=backend python3 -m pytest -q
```

Expected: all existing tests pass, rbac tests pass, tsc clean.

- [ ] **Step 5: Manual API check**

```
curl -sS http://127.0.0.1:8000/api/permissions
curl -sS -X POST http://127.0.0.1:8000/api/sales \
  -H 'Content-Type: application/json' -H 'X-Role: enterer' \
  -d '{"sku_id":"fuji","customer_id":"salma","crates_sold":1,"on_credit":false}'
```

After denying sale in store (via PUT caps), second sales call must 403.

Restart uvicorn if it was started before this change.

- [ ] **Step 6: Do not commit** unless the user asks.

---

### Task 7: Verification and preview

**Files:** none new

- [ ] **Step 1: Full suite**

```
PYTHONPATH=backend python3 -m pytest -q
cd frontend && npx vitest run && npx tsc --noEmit
```

Expected: 0 failures.

- [ ] **Step 2: Success criteria checklist**

- Role chip Enterer: Settings and Admin hidden.
- Owner Settings deny warehouse: Enterer tab bar loses warehouse; `POST /api/landed-cost` with X-Role enterer returns 403.
- Super Admin deny `agent.sale` on Enterer: typed/voice sale does not commit (`t.forbidden`).
- Owner cannot set `hitl.credit_override` allow while cap is confirm (`capExceeded`).
- Previous sale / outbox / split / shift tests still pass.

- [ ] **Step 3: Preview**

If frontend `:5173` and backend `:8000` already listen, request preview for 5173. Otherwise start them with background terminals as in `start.sh`.

---

## Spec coverage

| Spec section | Task |
| --- | --- |
| 4 Roles + chip | 6 |
| 5.1–5.4 model/defaults/clip | 1, 2 |
| 6.1 Admin matrix | 5, 6 |
| 6.2 Owner cards | 5, 6 |
| 6.3 Enterer gating + HITL deny | 6 |
| 7 API + bootstrap merge | 4, 6 |
| 8 Errors | 4, 6 |
| 9 Copy | 5 |
| 10 Tests | 1, 2, 4, 6, 7 |
| Non-goals (no JWT/PIN/custom roles) | omitted |

## Self-review

- No TBD/TODO placeholders.
- Names are consistent: `weaker`, `clip_owner` / `clipOwner`, `force_super_admin_admin` / `forceSuperAdminAdmin`, `effective`, `CATALOG`.
- `Permissions.occurredAt` client vs `occurred_at` server: API tests use snake_case store; client hydrate maps `occurredAt: raw.permissions?.occurredAt ?? raw.permissions?.occurred_at ?? 0` — implement that mapping in Task 3 hydrate to avoid a silent bug.
