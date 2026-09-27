# Baki Collection and Running Khata

Date: 2026-09-15
Status: Implemented
Scope: Cash baki collection with advance overpay, running khata view, voice entry, shift cash

## 1. Problem

The Ledger screen shows each customer's current `credit_balance` and can queue an SMS or WhatsApp reminder, but it cannot take money. A yard cashier has no way to record that an Arotder paid part or all of their baki, so dues only ever grow. There is also no per-customer history: the screen shows one number with no way to see how it got there.

This slice adds first-class cash collections against a running khata, using the same offline, event-sourced, RBAC-gated patterns as sales.

## 2. Goals

- Record a cash collection against a customer; reduce `credit_balance`.
- Allow overpayment as an advance: confirm first, then balance may go negative.
- Show a per-customer khata: sale remainder (debit) and collection (credit) lines with a running balance.
- Accept voice or typed entry (`joma`, `receive`, `payment`) with the existing confirm-before-commit loop.
- Count collection cash in the open shift drawer and the Home cash KPI.
- Persist offline in the AES snapshot, queue in the outbox, and gate both client and API with the existing RBAC keys.

## 3. Non-goals

- Invoice-level allocation (FIFO or pick-invoice). Collections apply to the running balance only.
- Mobile tender (bKash, Nagad). Cash only in this slice.
- Collection receipt or printout.
- Crate settlement or crate payment.
- GPT/Whisper cloud transcription. The existing local NLP stays.
- Multi-outlet, multi-shop, JWT, or per-user permissions.
- Collection audit product beyond the stored record and the existing local banner.

## 4. Domain model

### 4.1 Collection record

```
Collection = {
  id: string,            // uuid, or local_id when replayed
  customer_id: string,
  customer_name: string,
  amount: number,        // positive integer Taka, cash only
  note?: string,         // optional free text
  is_advance: boolean,   // true iff the new balance is negative
  created_at: string,    // ISO timestamp
}
```

A collection is never stored as a sale. It touches no SKU, lot, crate, or stock value.

### 4.2 Pure function `apply_collection`

```
apply_collection(current_balance: int, amount: int, confirm_override: bool = False) -> CollectionResult
```

Rules:

1. `amount <= 0` raises `ValueError("amount must be positive")`.
2. If `amount > current_balance` and `confirm_override` is false, raise `ValueError("advance exceeds dues")`.
3. Otherwise `new_balance = current_balance - amount` and `is_advance = new_balance < 0`.
4. `amount == current_balance` settles exactly: `new_balance = 0`, `is_advance = false`.
5. A customer already in advance (negative balance) always requires the advance override for any further collection, because `amount > current_balance` is true.

`CollectionResult` carries `new_balance`, `is_advance`, and `advance_delta = amount - current_balance` when overpaid.

Backend and frontend implement the same rules independently, as they already do for split tender and shift.

### 4.3 Khata derivation (read-only, not stored)

For one customer:

- Debit line: each sale with `remainder = amount - cash_paid` and `remainder > 0`. Only the remainder is debited.
- Credit line: each collection, `amount`.
- Sort all lines by `created_at` ascending, ties broken by id.
- `opening = credit_balance - sum(debits) + sum(credits)`.
- Emit an `opening` line only when `opening != 0`. Seeded customers with no sales and no collections get an opening line equal to their seed balance.
- Running balance starts at `opening`, applies each line, and the final value MUST equal `credit_balance`.

### 4.4 Shift and KPIs

- `close_shift` gains collection cash. `cash_collected = sum(sale.cash_paid) + sum(collection.amount)`. `expected_drawer = float_amount + cash_collected`. `z_total` stays sales-only. `credit_issued` stays sales-only.
- A new `collection_cash` field on the shift state carries the collection portion for the Z-report display.
- Home `cash_today` includes collections: `sum(sale cash paid) + sum(collection.amount)`.
- `credit_today` and `outstanding_dues` follow `credit_balance` and therefore drop as collections land.

### 4.5 Sync and conflict resolution

- The outbox event is `entity_type: "ledger"`, `action: "payment"`, `entity_id: customer_id`, `payload: { amount }`, so conflict replay understands it.
- `resolve_events` gains a `ledger` + `payment` branch that subtracts `amount` from the running balance. The existing `ledger` + `credit` branch keeps adding.
- Replay is idempotent through the existing outbox dedupe.

## 5. API

### 5.1 `POST /api/collections`

Request:

```json
{
  "customer_id": "rahim",
  "amount": 5000,
  "note": "optional",
  "confirm_override": false,
  "local_id": "optional-uuid"
}
```

Header `X-Role` selects the role, default `enterer`.

Behavior:

1. Gate on `require_any(role, ["screen.ledger", "agent.collection"])`. If both are `deny`, return 403 `{ code: "FORBIDDEN", key: "screen.ledger" }`.
2. Load the customer; unknown id returns 404.
3. If the collection would overpay and `effective(..., "hitl.advance") == "deny"`, return 403 `{ code: "FORBIDDEN", key: "hitl.advance" }`.
4. Run `apply_collection`. On `advance exceeds dues` without override, return 409:

```json
{ "code": "HITL_REQUIRED", "reason": "advance", "projected": -2000, "current": 3000 }
```

5. On success, append to `store.collections`, `enqueue("ledger", customer_id, "payment", { "amount": amount })`, and return:

```json
{ "collection": { ... }, "customer": { ... }, "tts": { "bn": "...", "en": "..." } }
```

### 5.2 Bootstrap

`GET /api/bootstrap` snapshot adds `"collections": store.collections[-50:]` so a fresh client can render khata history.

### 5.3 Shift close

`POST /api/shift/close` passes collection amounts into `close_shift` and returns the updated shift including `collection_cash`.

### 5.4 Untouched

`/api/sync` needs no new gate. Existing `POST /api/reminders`, `/api/sales`, and other endpoints are unchanged.

## 6. RBAC

CATALOG additions only. No new roles, no new cells.

| Key | super_admin | owner | enterer |
| --- | --- | --- | --- |
| `agent.collection` | allow | allow | allow |
| `hitl.advance` | allow | allow | confirm |

- `CATALOG` in both `backend/app/domain/rbac.py` and `frontend/src/domain/rbac.ts` adds `agent.collection` and `hitl.advance`, after `agent.reminder` and after `hitl.credit_override` respectively.
- The Admin matrix picks both up automatically from CATALOG into the Agent and HITL groups.
- The Owner Baki card list becomes `screen.ledger`, `agent.reminder`, `agent.collection`.
- Missing keys still resolve to `deny`.
- `hitl.advance` follows the same rule as `hitl.credit_override`: RBAC may only deny the override, never bypass the confirm sheet.

### 6.1 Cap migration for existing snapshots

Persisted snapshots predate the two new keys, so `effective` would resolve them to `deny` and silently hide the feature. On hydrate, backfill any CATALOG key missing from each role's caps with its `defaultCaps` value before resolving. Backend starts with fresh `default_caps()`, so only the client needs the backfill.

## 7. UI

### 7.1 Ledger screen

The existing `screen.ledger` gains collection, with no new tab.

- Customer row keeps the dues chip and SMS/WhatsApp buttons, and adds a `Collect` control: an amount input (required, positive), an optional note, and a submit button.
- Dues chip color: red when balance `> 0`, green when `0`, yellow when `< 0` (advance).
- Tapping the customer name expands the khata, newest last:
  - `opening` line, only when `opening != 0`
  - sale remainder lines (debit)
  - collection lines (credit), tagged `advance` when `is_advance`
  - running balance after every line
- Collections show a banner and TTS. No receipt screen.

### 7.2 Confirm and HITL sheets

1. Voice confirm-before-commit always runs for a collection, independent of RBAC.
2. If the collection overpays and `hitl.advance` is `confirm` or `allow`, open the HITL sheet, then apply with `confirm_override = true`.
3. If `hitl.advance` is `deny`, show `t.forbidden` and do not apply.
4. A manual Collect submit uses the same two sheets. The advance sheet only appears for an overpay.

### 7.3 Voice and typed entry

- `parseVoiceCommand` keeps returning intent `payment` for `receive`, `payment`, and `joma`, with `entities.amount` (Taka) and the matched customer. `amount` parsing follows the existing numeric entity extraction.
- `voiceKey` maps `"payment"` to `"agent.collection"`.
- On deny: banner, no sheet, no form change.
- On low confidence: fallback copy, open the ledger when allowed (not the sale screen).
- On success: prefill the collect form, open the ledger, and open the confirm sheet.
- `agent.confirm_reply` still governs the confirm loop.

## 8. Copy

Added to both `bn` and `en` in `frontend/src/i18n/copy.ts`:

| Key | bn | en |
| --- | --- | --- |
| `collect` | জমা নিন | Collect |
| `joma` | জমা | Deposit |
| `advance` | অগ্রিম | Advance |
| `khata` | খাতা | Khata |
| `opening` | আগের বাকি | Opening due |
| `hitlAdvance` | এই জমা বাকির চেয়ে বেশি। অগ্রিম রাখবেন? | This deposit exceeds dues. Keep as advance? |
| `note` | নোট | Note |

No emoji.

## 9. Errors

| Status | Condition | Body |
| --- | --- | --- |
| 400 | `amount <= 0` | `{ code: "BAD_AMOUNT" }` |
| 403 | ledger and collection both deny | `{ code: "FORBIDDEN", key: "screen.ledger" }` |
| 403 | overpay with `hitl.advance` deny | `{ code: "FORBIDDEN", key: "hitl.advance" }` |
| 404 | unknown customer | existing not-found detail |
| 409 | overpay without override | `{ code: "HITL_REQUIRED", reason: "advance", projected, current }` |

## 10. Testing

TDD for every behavior. Failing test first, then minimal implementation.

Backend (`pytest`):

- `apply_collection`: reduces balance; exact settle to 0 is not an advance; overpay without override raises; overpay with override sets a negative balance and `is_advance`; `amount <= 0` rejected; collecting against a negative balance requires override.
- Khata derivation: debit is the sale remainder only; opening line appears only when nonzero; running balance ends at `credit_balance`.
- `resolve_events`: `ledger` + `payment` subtracts; a mixed credit and payment stream nets correctly; duplicate event ids stay idempotent.
- `close_shift`: collection cash joins `cash_collected` and `expected_drawer`; `z_total` stays sales-only.
- API: happy path 200 and balance drops; enterer with both keys deny returns 403; overpay with `hitl.advance` deny returns 403; overpay without override returns 409; bootstrap includes `collections`.
- Existing suite keeps passing.

Frontend (`vitest`):

- `applyCollection` mirrors the Python rules, including exact settle and advance.
- Khata running balance matches the final `credit_balance`.
- `voiceKey("payment") === "agent.collection"`.
- NLP amount/customer parse for a `জমা` / `joma` utterance.
- `closeShift` includes collection cash.
- `tsc --noEmit` clean.

## 11. File map

Create:

- `backend/app/domain/collection.py`
- `backend/tests/test_collection.py`
- `frontend/src/domain/collection.ts`
- `frontend/src/domain/collection.test.ts`

Modify:

- `backend/app/domain/conflict.py` — `payment` ledger branch
- `backend/app/domain/shift.py` — collection cash in `close_shift`
- `backend/app/domain/rbac.py` — CATALOG and enterer defaults
- `backend/app/main.py` — Store.collections, `POST /api/collections`, snapshot, shift close
- `backend/tests/test_rbac.py` — new defaults
- `backend/tests/test_shift.py` — collection cash
- `frontend/src/domain/rbac.ts` — CATALOG and enterer defaults
- `frontend/src/domain/conflict.ts` — payment branch
- `frontend/src/domain/shift.ts` — collection cash
- `frontend/src/domain/nlp.ts` — amount entity for `payment`
- `frontend/src/store/types.ts` — `Collection`, `AppState.collections`, shift `collectionCash`
- `frontend/src/store/seed.ts` — empty collections
- `frontend/src/store/offline.ts` — hydrate, `applyLocalCollection`, recalc cash
- `frontend/src/store/sync.ts` — no signature change; role header already present
- `frontend/src/i18n/copy.ts` — new keys
- `frontend/src/screens/Ledger.tsx` — collect control and khata
- `frontend/src/screens/Shift.tsx` — collection cash row
- `frontend/src/screens/Settings.tsx` — Baki card keys
- `frontend/src/App.tsx` — collection confirm/HITL flow, voice routing
- `frontend/src/domain/rbac.test.ts` and `frontend/src/domain/nlp.test.ts` — new assertions

## 12. Spec coverage

| Requirement | Section |
| --- | --- |
| Collection record and rules | 4.1, 4.2 |
| Running khata | 4.3, 7.1 |
| Advance overpay HITL | 4.2, 5.1, 7.2 |
| Shift and KPI cash | 4.4 |
| Offline and sync | 4.5, 5.2 |
| API gate and errors | 5, 9 |
| RBAC keys and migration | 6 |
| Voice and typed entry | 7.3 |
| Copy | 8 |

## 13. As-built notes

Implemented 2026-09-15. Domain, API, offline replay, shift cash, RBAC keys, Ledger collect/khata, and voice `payment` routing match this spec.

Verification at ship:

- Backend `python3 -m pytest -q`: 69 passed
- Frontend `npx vitest run`: 54 passed (includes dashboard helpers added in the POS restyle)
- `npx tsc --noEmit`: clean

## 14. UX appendix (POS restyle)

Visual restyle only. No new collection, RBAC, or sync behavior.

Desktop (>=961px):

- Dark magenta admin chrome: left sidebar, magenta top bar, dense cards and tables
- Home is a dashboard: welcome strip, KPI cards, 7-day sales bars, due/collected donut, recent sales table, top products
- Ledger is a cashier table: search, collect inline, expandable khata

Mobile (<=960px):

- Magenta header with menu / back / POS
- Home shows Today's Sales hero plus a 2x2 action grid
- Bottom tab bar stays for the five primary screens
- Sidebar becomes a drawer

Tokens live in `frontend/src/styles/global.css`. Dashboard math lives in `frontend/src/domain/dashboard.ts`.
| Tests | 10 |
