# Role-Based Dashboards and Permission Matrix

Date: 2026-09-11
Status: Approved for user review
Scope: Super Admin control surface, Owner shop settings, Enterer POS gating

## 1. Problem

Arat POS is a single-role voice-first yard app. Every operator sees every screen (sale, ledger, warehouse, spoilage, shift) and the voice agent can run every intent. There is no way for a platform operator to cap features, or for a shop owner (mahajon) to tailor what the enterer (cashier) and the AI Agent may do.

This spec adds three roles, a permission matrix, and two dashboards so Super Admin templates the product, Owner customizes the shop without exceeding those caps, and Enterer gets a filtered POS.

## 2. Goals

- Super Admin can set allow / deny / confirm for every screen, agent intent, and HITL override, per role.
- Owner can tighten (never expand) what Enterer may do, using a simple settings dashboard rather than the full matrix.
- Enterer POS hides denied screens, refuses denied voice intents, and forces confirm sheets when a cell is `confirm`.
- Backend APIs reject unauthorized actions with 403 so the UI is not the only gate.
- Offline-first: matrix lives in encrypted local state and syncs like other events.
- No JWT, no multi-tenant IAM, no named user directory in this slice.

## 3. Non-goals

- Passwords, OAuth, or PIN on role switch.
- Custom roles beyond the three fixed roles.
- Per-user overrides (permissions are per role, not per person).
- Separate admin hostname or second Vite app.
- Multi-shop tenancy.
- Audit log UI (denied attempts may banner locally; they are not persisted as an audit product).

## 4. Roles

Exactly three roles. Warehouse and manager are not logins; they are permission keys if needed later.

| Role | Who | Surface |
| --- | --- | --- |
| `super_admin` | Platform operator | Desktop `/admin` matrix. May also use POS. |
| `owner` | Shop mahajon | Mobile Settings dashboard plus POS features they are allowed. Cannot open `/admin`. |
| `enterer` | Yard cashier / data-entry | Existing voice POS. No Settings, no Admin. |

Session role is stored as `state.session.role`. A topbar chip cycles roles for demo and development. Production PIN is out of scope.

## 5. Permission model

### 5.1 Cell values

Ordered weakest to strongest:

1. `deny` — hide UI, refuse agent, 403 on API.
2. `confirm` — UI may show the action but must open the existing HITL / confirm sheet before commit. API requires `confirm_override=true` (already used for credit HITL).
3. `allow` — run without an extra confirm, except voice sales still use the existing spoken confirm-before-commit loop (that loop is a safety UX, not an RBAC cell).

Voice confirm-before-commit (`buildConfirmPrompt` / `parseConfirmReply`) is independent of RBAC. RBAC `confirm` is an extra HITL gate for dangerous mutations (credit override, write-off, shift close).

### 5.2 Catalog (matrix rows)

Keys are stable strings. Adding a key requires a default in Super Admin caps.

Screens:

- `screen.home`
- `screen.catalog`
- `screen.sale`
- `screen.ledger`
- `screen.warehouse`
- `screen.landed`
- `screen.spoilage`
- `screen.receipt`
- `screen.shift`
- `screen.settings`
- `screen.admin`

Agent intents (voice / typed command):

- `agent.sale`
- `agent.spoilage`
- `agent.reminder`
- `agent.confirm_reply`

HITL / overrides:

- `hitl.credit_override`
- `hitl.shift_close`
- `hitl.write_off`

### 5.3 Two-layer store

```
permissions = {
  caps: Record<Role, Record<Key, Cell>>,   // Super Admin template
  owner: Record<Key, Cell>                 // overrides for enterer only
}
```

`caps.super_admin` and `caps.owner` are edited only by Super Admin.
`owner` overrides apply only to `enterer`.
Owner cannot write `caps` or any non-enterer column.

Resolver (`deny` is weaker than `confirm` is weaker than `allow`). `min` means the weaker cell wins.

```
effective(role, key):
  if role == enterer:
    cap = caps.enterer[key] ?? deny
    override = owner[key]
    if override is missing: return cap
    return weaker(cap, override)
  return caps[role][key] ?? deny
```

When Super Admin tightens `caps.enterer[key]`, any `owner[key]` stronger than the new cap is clipped to the cap on save.

Owner save that would make `owner[key]` stronger than `caps.enterer[key]` is rejected (`403 CAP_EXCEEDED`).

### 5.4 Defaults

Super Admin: every key `allow`.

Owner: every key `allow` except `screen.admin` = `deny`.

Enterer:

| Key | Cell |
| --- | --- |
| `screen.home` | allow |
| `screen.catalog` | allow |
| `screen.sale` | allow |
| `screen.ledger` | allow |
| `screen.warehouse` | allow |
| `screen.landed` | allow |
| `screen.spoilage` | allow |
| `screen.receipt` | allow |
| `screen.shift` | allow |
| `screen.settings` | deny |
| `screen.admin` | deny |
| `agent.sale` | allow |
| `agent.spoilage` | allow |
| `agent.reminder` | allow |
| `agent.confirm_reply` | allow |
| `hitl.credit_override` | confirm |
| `hitl.shift_close` | confirm |
| `hitl.write_off` | confirm |

Missing key in any map resolves to `deny`.

## 6. Surfaces

### 6.1 Super Admin `/admin`

Desktop-first page in the same Vite app (`screen === "admin"`). Not in the mobile tab bar.

Layout:

- Page title and shop name.
- Matrix: rows = catalog keys grouped by Screens / Agent / HITL; columns = Super Admin, Owner, Enterer.
- Each cell is a three-state control cycling allow (green) / confirm (yellow) / deny (red).
- Super Admin column is locked to `allow` (cannot lock themselves out of admin).
- Save writes `permissions.caps`. Clips owner Enterer overrides.
- Reset-to-defaults restores section 5.4.

Owner and Enterer navigating to admin without `screen.admin=allow` redirect to home with TTS fallback.

### 6.2 Owner Settings

Mobile Settings screen (`screen.settings`), opened from Home (button) and topbar when role is owner.

Not a matrix. Feature cards that write only `permissions.owner` keys for Enterer:

| Card | Keys written |
| --- | --- |
| Sales | `screen.sale`, `agent.sale` |
| Catalog | `screen.catalog` |
| Baki / ledger | `screen.ledger`, `agent.reminder` |
| Warehouse | `screen.warehouse`, `screen.landed` |
| Spoilage | `screen.spoilage`, `agent.spoilage`, `hitl.write_off` |
| Shifts | `screen.shift`, `hitl.shift_close` |
| Credit override | `hitl.credit_override` |

Each card offers the same three cells for the mapped keys (one control if keys must stay in lockstep: Sales toggles both `screen.sale` and `agent.sale` together). Credit override and write-off and shift close default to confirm and may be set to deny; Owner cannot set them to allow if Super Admin cap is confirm.

Owner cannot grant Enterer `screen.settings` or `screen.admin`.

### 6.3 Enterer POS

Existing App shell. Changes:

- Tab bar and Home KPI buttons omit screens where `effective(enterer, screen.*)` is deny.
- Voice / typed `runVoice`: if intent maps to a denied agent key, do not commit; show fallback copy and stay on an allowed screen.
- `hitl.credit_override=deny` blocks override even if the operator taps Confirm on the existing credit sheet.
- `hitl.credit_override=confirm` or `allow`: if projected credit exceeds limit, show the existing credit HITL sheet. RBAC never skips that business stop; `deny` is the only extra lock (blocks the override button).
- Role chip in topbar; pending-sync pill unchanged.

## 7. Data flow

### 7.1 Client state

Extend `AppState`:

```
session: { role: "super_admin" | "owner" | "enterer" }
permissions: {
  caps: { super_admin: Cells, owner: Cells, enterer: Cells },
  owner: Cells
}
```

`hydrateState` fills missing session/permissions from defaults so old AES snapshots still load.

`can(state, key)` = `effective(state.session.role, key)`.

### 7.2 Persistence

Encrypted snapshot already persists whole `AppState`. Permissions are included.

Queue permission changes as outbox events:

- Super Admin save: `{ entityType: "permissions", action: "caps", payload: caps }`
- Owner save: `{ entityType: "permissions", action: "owner", payload: ownerOverrides }`

### 7.3 API

Headers: `X-Role: super_admin|owner|enterer`. Missing header defaults to `enterer`.

Endpoints:

- `GET /api/permissions` — snapshot of caps + owner overrides + defaults.
- `PUT /api/permissions/caps` — Super Admin only. Body = full caps object. Clips owner overrides. 403 if role is not super_admin.
- `PUT /api/permissions/owner` — Owner or Super Admin. Body = Enterer override map. 403 `CAP_EXCEEDED` if any cell is stronger than `caps.enterer`. 403 if role is enterer.

Gating existing mutations (check `X-Role` against enterer-effective keys when role is enterer; against `caps[role]` otherwise):

| Endpoint | Required key |
| --- | --- |
| `POST /api/sales` | `screen.sale` or `agent.sale` is not deny |
| `POST /api/sales` with credit over limit | Business HITL always applies (`confirm_override` required). Additionally `hitl.credit_override` must not be deny. RBAC `allow` does not skip the credit-limit sheet. |
| `POST /api/spoilage` | `screen.spoilage` or `agent.spoilage` |
| `POST /api/spoilage` write_off | `hitl.write_off` not deny |
| `POST /api/reminders` | `agent.reminder` or `screen.ledger` |
| `POST /api/landed-cost` | `screen.landed` |
| `POST /api/shift/close` | `screen.shift` and `hitl.shift_close` not deny |
| `POST /api/config` | `screen.settings` or `screen.admin` |
| `POST /api/sync` | always allowed (sync is infrastructure) |

403 body: `{ "code": "FORBIDDEN", "key": "screen.sale" }`.

Client does not enqueue a rejected mutation as a poison outbox record. Local apply still happens offline only if `can()` passed before persist.

### 7.4 Bootstrap

`GET /api/bootstrap` includes `permissions`. Client session role stays local (default `enterer`); bootstrap does not overwrite the role chip.

Merge on hydrate: if local `permissions.occurredAt` is greater than server `permissions.occurredAt`, keep local caps and owner maps; otherwise take server. After applying that document, always clip `owner` to `caps.enterer` so a Super Admin tighten cannot be undone by a stale owner overlay.

Caps writes from Super Admin always win over owner writes on the same enterer key (server clip).

## 8. Error handling

- Denied screen navigation: set screen to `home` if home allowed, else `sale` if allowed, else a locked empty panel with fallback copy.
- Denied agent intent: `setBanner(t.fallback)` / existing fallback string; do not open confirm sheet.
- API 403: banner with forbidden copy; do not mark the local event synced; do not retry as success.
- `CAP_EXCEEDED`: Owner Settings reverts the control and TTS-explains that Super Admin capped the feature.
- Unknown role header: treat as enterer.
- Unknown permission key in PUT body: 400 `UNKNOWN_KEY`.

## 9. UI copy (bn + en)

Add keys: `role`, `settings`, `admin`, `allow`, `deny`, `confirmCell`, `forbidden`, `capExceeded`, `resetDefaults`. Bangla labels for the three roles: সুপার অ্যাডমিন, মালিক, এন্ট্রি.

Admin matrix is English-primary with bn toggle already in the app.

Owner cards use existing feature names (sale, ledger, warehouse, spoilage, shift) plus the new settings strings.

## 10. Testing

Domain (frontend + backend, TDD):

- `effective(enterer)` returns min(cap, owner override).
- Owner override allow clipped when cap is confirm or deny.
- Super Admin cannot be denied `screen.admin` (save forces allow).
- Enterer cannot PUT owner overrides (403).
- Owner PUT allow on `hitl.credit_override` while cap is confirm returns 403 CAP_EXCEEDED.
- Missing key is deny.
- `can()` false hides screen id from tab list helper.

API:

- Enterer `POST /api/sales` with `X-Role: enterer` and `screen.sale=deny` and `agent.sale=deny` returns 403.
- Super Admin PUT caps then GET bootstrap shows clipped owner map.

UI helpers (unit, not full React mount required):

- `visibleScreens(role, permissions)` omits denied ids.
- `voiceAllowed(intent)` maps sale/spoilage/reminder to agent keys.

No change to landed-cost / crate / NLP numeric tests except adding the permission module.

## 11. File plan

Backend:

- `backend/app/domain/rbac.py` — cells, catalog, effective, clip, validate.
- `backend/tests/test_rbac.py`
- `backend/app/main.py` — Store.permissions, endpoints, X-Role dependency.

Frontend:

- `frontend/src/domain/rbac.ts` + `rbac.test.ts` (same rules as Python).
- `frontend/src/store/types.ts` — session, permissions.
- `frontend/src/store/offline.ts` — hydrate defaults.
- `frontend/src/screens/AdminMatrix.tsx` — Super Admin matrix.
- `frontend/src/screens/Settings.tsx` — Owner cards.
- `frontend/src/App.tsx` — role chip, can() gates, admin/settings screens.
- `frontend/src/i18n/copy.ts` — new strings.

## 12. Implementation order

1. RBAC domain + tests (Python and TypeScript, same fixtures).
2. Store + API + hydrate.
3. Gate App screens and voice.
4. Admin matrix UI.
5. Owner Settings UI.
6. Wire copy, role chip, preview.

## 13. Success criteria

- Switching to enterer hides Settings and Admin.
- Owner can deny Enterer warehouse; enterer tab bar loses warehouse; landed API 403.
- Super Admin deny `agent.sale` on Enterer: voice sale does not commit.
- Owner cannot flip Enterer `hitl.credit_override` to allow if Super Admin left it at confirm.
- Existing sale / outbox / split-tender / shift tests still pass.
