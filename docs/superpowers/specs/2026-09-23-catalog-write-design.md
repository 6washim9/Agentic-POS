# Catalog Write (Super Admin and Owner)

Date: 2026-09-23
Status: Approved for user review
Scope: Super Admin and Owner add and edit product listings on the existing Catalog screen. Enterer remains view-only and can still pick a SKU for sale.

## 1. Problem

Arat POS Catalog is a photo grid. Every role can open it and tap a SKU to start a sale. Nobody can add or change a product listing. Super Admin and Owner need to enhance offerings (names, photo, price, stock, grade, location) without giving Enterer write access.

This slice adds add/edit on the existing Catalog screen, gated by a hard role check, persisted in the local AES snapshot.

## 2. Goals

- Super Admin and Owner can add a product and edit an existing SKU on Catalog.
- Enterer can still open Catalog (`screen.catalog`) and pick a SKU for sale. No Add/Edit controls.
- Persist core listing fields in encrypted local `AppState.skus`.
- Hard gate: write only when `session.role` is `super_admin` or `owner`. Super Admin cannot grant Enterer catalog write via the matrix.
- Bangla default copy. No emoji.
- Creating or editing a SKU does not change `session.role`.

## 3. Non-goals

- New RBAC catalog key (`catalog.write` or `screen.products`).
- Separate Products screen or card-overlay / FAB UX.
- Backend `POST /api/skus` or outbox events for SKU upsert.
- Password, PIN, HRM, payroll, or extra product cards.
- Editing `unit_cost` on the form (landed cost owns it).
- Adjusting lots when stock is edited (add seeds a lot; edit updates the SKU only).
- Deleting SKUs.
- Voice entry for catalog write.
- Changing who may open Catalog. Enterer keeps `screen.catalog` allow.

## 4. Domain model

### 4.1 SKU record

Existing `Sku` is unchanged:

```
Sku = {
  id: string,
  name: string,
  name_bn: string,
  photo: string,
  unit: string,
  stock: number,
  grade: string,
  location: string,
  unit_price: number,
  unit_cost: number,
  color: string,
}
```

Form edits the core listing: `name`, `name_bn`, `photo`, `unit_price`, `stock`, `grade`, `location`.

Hidden defaults:

- `unit` is always `"crate"` on create; edit does not change `unit`.
- `unit_cost` is `0` on create; edit keeps the existing `unit_cost`.
- `color` is derived: grade `C` or location `spoil` -> `"orange"`; location `cold` -> `"yellow"`; else `"green"`.

### 4.2 Write gate

```
canWriteCatalog(role: Role) -> boolean
```

True only for `super_admin` and `owner`. False for `enterer`. Not a CATALOG key. Missing-key-deny does not apply.

### 4.3 Pure function `upsertSku`

```
upsertSku(existing: Sku[], draft: SkuDraft, now: string, id?: string) -> Sku
```

`SkuDraft` = `{ id?: string, name, name_bn, photo, unit_price, stock, grade, location }`.

`id` present means edit; omitted means add.

Rules:

1. Trim `name` and `name_bn`. If either is empty after trim, throw `name required`.
2. `unit_price` and `stock` must be finite numbers `>= 0`. Else throw `invalid price` or `invalid stock`.
3. `grade` must be `A` | `B` | `C`. Else throw `invalid grade`.
4. `location` must be `cold` | `yard` | `gudam` | `spoil`. Else throw `invalid location`.
5. `photo` must be `apple` | `mango` | `banana` | `orange` | `grape` | `pomegranate`. Else throw `invalid photo`.
6. Add: if any existing SKU has the same `name` ignoring case, throw `duplicate name`.
7. Edit: if no SKU has `draft.id`, throw `sku not found`. Same name as the row being edited is allowed. Duplicate against a different SKU is rejected.
8. Add returns a new `Sku` with new `id` (or the optional `id` argument), `unit: "crate"`, `unit_cost: 0`, derived `color`. Do not mutate `existing`.
9. Edit returns a new `Sku` copying `unit` and `unit_cost` from the previous row. Do not mutate `existing`.

`now` is accepted for symmetry with `createUser` and for a future `updated_at`; this slice does not persist timestamps on SKU.

### 4.4 Lot on add

After a successful add, App appends one lot so sales can allocate:

```
{ sku_id, challan: "CH-NEW-<id>", remaining: stock, unit_cost: 0, received_at: Date.now() }
```

Edit does not create or resize lots. Warehouse / landed / spoilage remain the operational stock paths after create.

### 4.5 Session

`Session` stays `{ role }`. Catalog write never writes `session.role`. The demo chip remains the only session switcher.

## 5. Persistence

Local AES snapshot only. `AppState.skus` (and `lots` on add) hydrate and persist with the rest of the app. No outbox event and no `/api/skus` in this slice. Writes are available offline immediately.

Hydrate stays `skus: raw.skus ?? base.skus`. This slice does not change seed SKUs except through cashier add/edit.

## 6. RBAC

No new catalog keys. `screen.catalog` stays allow for all three default roles so Enterer can view and pick.

Write UI and the App save handler use `canWriteCatalog(role)`, not `can(..., "screen.catalog")`.

If Enterer's `screen.catalog` is later denied in the matrix, Catalog hides as today. That is unrelated to write.

Owner already has `screen.admin` deny; Owner still writes catalog because the gate is role, not admin.

## 7. UI

Reuse the dark magenta Catalog chrome. Do not add extra product-info cards.

### 7.1 Navigation

No new sidebar item. No new `Screen` value. Catalog remains the existing sidebar / tab entry gated by `screen.catalog`.

Not added to or removed from the five-item mobile tab bar.

### 7.2 List

Existing photo grid.

Enterer: tap card picks SKU and goes to Sale (unchanged).

Super Admin / Owner:

- Magenta Add in the panel header opens the add form.
- Each card shows an Edit control that opens the edit form without starting a sale.
- Tap on the card (not Edit) still picks for Sale.

### 7.3 Form (Add / Edit)

Modes on Catalog: `list` | `add` | `edit`.

Title:

- add bn: নতুন পণ্য যোগ করুন / en: Add product
- edit bn: পণ্য সম্পাদনা / en: Edit product

One card, `form-grid` fields:

| Field | Required | Control |
| --- | --- | --- |
| Name / নাম | yes | text |
| Name (Bangla) / বাংলা নাম | yes | text |
| Photo / ছবি | yes | select: apple, mango, banana, orange, grape, pomegranate |
| Unit price / দাম | yes | number, min 0 |
| Stock / স্টক | yes | number, min 0 |
| Grade / গ্রেড | yes | select: A, B, C |
| Location / লোকেশন | yes | select: cold, yard, gudam, spoil |

Reuse `saved` and `back`. Back returns to the list without saving.

Errors sit in `p.field-error` with `role="alert"`. Map thrown messages to copy keys.

### 7.4 Copy

| Key | bn | en |
| --- | --- | --- |
| addProduct | নতুন পণ্য যোগ করুন | Add product |
| editProduct | পণ্য সম্পাদনা | Edit product |
| nameEn | নাম | Name |
| nameBn | বাংলা নাম | Bangla name |
| photo | ছবি | Photo |
| unitPrice | দাম | Unit price |
| stock | স্টক | Stock |
| nameRequired | নাম লাগবে | Name required |
| duplicateName | নাম ইতিমধ্যে আছে | Name already exists |
| invalidPrice | দাম ঠিক নয় | Invalid price |
| invalidStock | স্টক ঠিক নয় | Invalid stock |
| invalidGrade | গ্রেড ঠিক নয় | Invalid grade |
| invalidLocation | লোকেশন ঠিক নয় | Invalid location |
| invalidPhoto | ছবি ঠিক নয় | Invalid photo |

Reuse `add`, `saved`, `back`, `catalog`, `grade`, `location`.

No emoji.

## 8. App save handler

```
onSave(draft: SkuDraft) {
  if (!canWriteCatalog(role)) return;
  const sku = upsertSku(state.skus, draft, new Date().toISOString());
  let next = { ...state, skus: replaceOrAppend(state.skus, sku) };
  if (!draft.id) {
    next = { ...next, lots: [...next.lots, newLot(sku)] };
  }
  save(next);
}
```

`replaceOrAppend`: if a row with `sku.id` exists, map-replace; else append.

Enterer `onSave` is a no-op (no persist). Catalog does not pass a write callback when `canWriteCatalog` is false, so the form is not mounted.

## 9. Testing

TDD. Failing test first.

Domain:

- Add returns trimmed names, unit crate, unit_cost 0, derived color, does not mutate existing.
- Edit keeps unit_cost and unit; updates core fields.
- Empty name or name_bn rejected.
- Negative or non-finite price/stock rejected.
- Invalid grade, location, photo rejected.
- Duplicate English name case-insensitive rejected on add.
- Edit may keep its own name; duplicate against another SKU rejected.
- Missing id on edit throws `sku not found`.
- `canWriteCatalog` true for super_admin and owner, false for enterer.

Frontend:

- `tsc --noEmit` clean.
- Existing hydrate SKU tests unchanged.
- Existing 69 backend + 61 frontend tests keep passing. No new backend tests.

## 10. File map

Create:

- `frontend/src/domain/sku.ts`
- `frontend/src/domain/sku.test.ts`

Modify:

- `frontend/src/screens/Catalog.tsx` — Add/Edit form, Edit on cards, write-only chrome
- `frontend/src/App.tsx` — pass `canWrite`, save handler, lot on add
- `frontend/src/i18n/copy.ts` — keys in section 7.4
- `frontend/src/domain/rbac.ts` — no CATALOG change; `canWriteCatalog` lives in `sku.ts`

Do not modify seed SKUs, hydrate, or backend.

## 11. Spec coverage

| Requirement | Section |
| --- | --- |
| Super Admin and Owner add/edit | 2, 4.2, 7 |
| Enterer view + pick for sale | 2, 6, 7.2 |
| Core listing fields | 4.1, 7.3 |
| Hard role check, no matrix key | 4.2, 6 |
| Local snapshot only | 5 |
| Lot on add, not on edit | 4.4, 8 |
| Session unchanged | 4.5 |
| Bangla copy, no emoji | 7.4 |
| TDD | 9 |
