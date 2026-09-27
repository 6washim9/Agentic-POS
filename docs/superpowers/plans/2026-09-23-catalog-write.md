# Catalog Write Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Super Admin and Owner can add and edit Catalog listings (names, photo, price, stock, grade, location) on the existing Catalog screen; Enterer stays view-only and can still pick a SKU to sell.

**Architecture:** Pure `upsertSku(existing, draft, now, id?)` validates core fields and returns a new `Sku` without mutating the list. `canWriteCatalog(role)` is a hard role check (`super_admin` | `owner` only), not an RBAC CATALOG key. Catalog keeps `screen.catalog` for all roles. App persist replaces/appends `state.skus` and seeds one lot on add. No `/api/skus`.

**Tech Stack:** React 18 + TypeScript + Vitest. Encrypted local `AppState`. No new backend endpoints.

## Global Constraints

- Bangla default copy; no emoji in UI or docs.
- TDD: failing test first for every domain behavior.
- Do not commit unless the user explicitly asks. Replace every "commit" checkpoint with a full test run.
- Core listing only: name, name_bn, photo, unit_price, stock, grade, location. No unit_cost on the form.
- Hard write gate: `canWriteCatalog(role)` true only for `super_admin` and `owner`. No `catalog.write` key.
- Enterer still opens Catalog and picks a SKU for sale.
- Session chip remains the only live-role switcher.
- Frontend commands run from `frontend/`.
- Spec: `docs/superpowers/specs/2026-09-23-catalog-write-design.md`.
- `npx tsc --noEmit` uses `noUnusedParameters`: unused `now` must be named `_now`.
- Annotate `id: string = crypto.randomUUID()` so test ids like `"sku-1"` typecheck (same as `createUser`).

## File map

Create:

- `frontend/src/domain/sku.ts`
- `frontend/src/domain/sku.test.ts`

Modify:

- `frontend/src/screens/Catalog.tsx`
- `frontend/src/App.tsx`
- `frontend/src/i18n/copy.ts`
- `frontend/src/styles/global.css`

Do not modify seed SKUs, hydrate, RBAC CATALOG, or backend.

---

### Task 1: `upsertSku` domain and write gate

**Files:**
- Create: `frontend/src/domain/sku.ts`
- Test: `frontend/src/domain/sku.test.ts`

**Interfaces:**
- Consumes: `Role` from `frontend/src/domain/rbac.ts`; `Sku` from `frontend/src/store/types.ts`
- Produces:
  - `Photo = "apple" | "mango" | "banana" | "orange" | "grape" | "pomegranate"`
  - `Grade = "A" | "B" | "C"`
  - `SkuLocation = "cold" | "yard" | "gudam" | "spoil"`
  - `SkuDraft = { id?: string, name, name_bn, photo: Photo, unit_price: number, stock: number, grade: Grade, location: SkuLocation }`
  - `canWriteCatalog(role: Role): boolean`
  - `upsertSku(existing: Sku[], draft: SkuDraft, now: string, id?: string): Sku`
  - `skuColor(grade: Grade, location: SkuLocation): string`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/domain/sku.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canWriteCatalog, skuColor, upsertSku, type SkuDraft } from "./sku";
import type { Sku } from "../store/types";

const now = "2026-09-23T10:00:00.000Z";

const fuji: Sku = {
  id: "fuji",
  name: "Fuji Apples",
  name_bn: "ফুজি আপেল",
  photo: "apple",
  unit: "crate",
  stock: 420,
  grade: "A",
  location: "cold",
  unit_price: 500,
  unit_cost: 380,
  color: "yellow",
};

const draft: SkuDraft = {
  name: "  Lychee  ",
  name_bn: "  লিচু  ",
  photo: "grape",
  unit_price: 800,
  stock: 12,
  grade: "A",
  location: "yard",
};

describe("canWriteCatalog", () => {
  it("allows super_admin and owner only", () => {
    expect(canWriteCatalog("super_admin")).toBe(true);
    expect(canWriteCatalog("owner")).toBe(true);
    expect(canWriteCatalog("enterer")).toBe(false);
  });
});

describe("skuColor", () => {
  it("maps spoil or grade C to orange, cold to yellow, else green", () => {
    expect(skuColor("C", "yard")).toBe("orange");
    expect(skuColor("A", "spoil")).toBe("orange");
    expect(skuColor("A", "cold")).toBe("yellow");
    expect(skuColor("B", "gudam")).toBe("green");
  });
});

describe("upsertSku", () => {
  it("adds a trimmed crate sku without mutating existing", () => {
    const copy = [fuji];
    const sku = upsertSku(copy, draft, now, "sku-1");
    expect(sku).toMatchObject({
      id: "sku-1",
      name: "Lychee",
      name_bn: "লিচু",
      photo: "grape",
      unit: "crate",
      stock: 12,
      grade: "A",
      location: "yard",
      unit_price: 800,
      unit_cost: 0,
      color: "green",
    });
    expect(copy).toHaveLength(1);
  });

  it("edits core fields and keeps unit_cost and unit", () => {
    const sku = upsertSku(
      [fuji],
      {
        id: "fuji",
        name: "Fuji Apples",
        name_bn: "ফুজি আপেল",
        photo: "apple",
        unit_price: 550,
        stock: 400,
        grade: "B",
        location: "gudam",
      },
      now,
    );
    expect(sku.unit_price).toBe(550);
    expect(sku.stock).toBe(400);
    expect(sku.grade).toBe("B");
    expect(sku.location).toBe("gudam");
    expect(sku.unit).toBe("crate");
    expect(sku.unit_cost).toBe(380);
    expect(sku.color).toBe("green");
  });

  it("rejects empty names", () => {
    expect(() => upsertSku([fuji], { ...draft, name: "  " }, now)).toThrow("name required");
    expect(() => upsertSku([fuji], { ...draft, name_bn: "  " }, now)).toThrow("name required");
  });

  it("rejects invalid price or stock", () => {
    expect(() => upsertSku([fuji], { ...draft, unit_price: -1 }, now)).toThrow("invalid price");
    expect(() => upsertSku([fuji], { ...draft, stock: Number.NaN }, now)).toThrow("invalid stock");
  });

  it("rejects invalid grade, location, or photo", () => {
    expect(() => upsertSku([fuji], { ...draft, grade: "D" as "A" }, now)).toThrow("invalid grade");
    expect(() => upsertSku([fuji], { ...draft, location: "shop" as "yard" }, now)).toThrow("invalid location");
    expect(() => upsertSku([fuji], { ...draft, photo: "pear" as "apple" }, now)).toThrow("invalid photo");
  });

  it("rejects a duplicate English name case-insensitively on add", () => {
    expect(() => upsertSku([fuji], { ...draft, name: "fuji apples" }, now)).toThrow("duplicate name");
  });

  it("allows edit to keep its own name and rejects a clash", () => {
    const mango: Sku = { ...fuji, id: "mango", name: "Himsagar Mango" };
    const kept = upsertSku(
      [fuji, mango],
      {
        id: "fuji",
        name: "Fuji Apples",
        name_bn: "ফুজি আপেল",
        photo: "apple",
        unit_price: 500,
        stock: 420,
        grade: "A",
        location: "cold",
      },
      now,
    );
    expect(kept.id).toBe("fuji");
    expect(() =>
      upsertSku(
        [fuji, mango],
        {
          id: "fuji",
          name: "Himsagar Mango",
          name_bn: "ফুজি আপেল",
          photo: "apple",
          unit_price: 500,
          stock: 420,
          grade: "A",
          location: "cold",
        },
        now,
      ),
    ).toThrow("duplicate name");
  });

  it("rejects edit when id is missing from the list", () => {
    expect(() =>
      upsertSku(
        [fuji],
        {
          id: "missing",
          name: "X",
          name_bn: "ওয়াই",
          photo: "apple",
          unit_price: 1,
          stock: 1,
          grade: "A",
          location: "yard",
        },
        now,
      ),
    ).toThrow("sku not found");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/domain/sku.test.ts`

Expected: FAIL, `Failed to load url ./sku`

- [ ] **Step 3: Write the minimal implementation**

Create `frontend/src/domain/sku.ts`:

```ts
import type { Role } from "./rbac";
import type { Sku } from "../store/types";

export type Photo = "apple" | "mango" | "banana" | "orange" | "grape" | "pomegranate";
export type Grade = "A" | "B" | "C";
export type SkuLocation = "cold" | "yard" | "gudam" | "spoil";

export type SkuDraft = {
  id?: string;
  name: string;
  name_bn: string;
  photo: Photo;
  unit_price: number;
  stock: number;
  grade: Grade;
  location: SkuLocation;
};

const PHOTOS: Photo[] = ["apple", "mango", "banana", "orange", "grape", "pomegranate"];
const GRADES: Grade[] = ["A", "B", "C"];
const LOCATIONS: SkuLocation[] = ["cold", "yard", "gudam", "spoil"];

export function canWriteCatalog(role: Role): boolean {
  return role === "super_admin" || role === "owner";
}

export function skuColor(grade: Grade, location: SkuLocation): string {
  if (grade === "C" || location === "spoil") return "orange";
  if (location === "cold") return "yellow";
  return "green";
}

export function upsertSku(existing: Sku[], draft: SkuDraft, _now: string, id: string = crypto.randomUUID()): Sku {
  const name = draft.name.trim();
  const name_bn = draft.name_bn.trim();
  if (!name || !name_bn) throw new Error("name required");
  if (!Number.isFinite(draft.unit_price) || draft.unit_price < 0) throw new Error("invalid price");
  if (!Number.isFinite(draft.stock) || draft.stock < 0) throw new Error("invalid stock");
  if (!GRADES.includes(draft.grade)) throw new Error("invalid grade");
  if (!LOCATIONS.includes(draft.location)) throw new Error("invalid location");
  if (!PHOTOS.includes(draft.photo)) throw new Error("invalid photo");
  const clash = existing.some(
    (sku) => sku.id !== draft.id && sku.name.toLowerCase() === name.toLowerCase(),
  );
  if (clash) throw new Error("duplicate name");
  if (draft.id) {
    const prev = existing.find((sku) => sku.id === draft.id);
    if (!prev) throw new Error("sku not found");
    return {
      ...prev,
      name,
      name_bn,
      photo: draft.photo,
      unit_price: draft.unit_price,
      stock: draft.stock,
      grade: draft.grade,
      location: draft.location,
      color: skuColor(draft.grade, draft.location),
    };
  }
  return {
    id,
    name,
    name_bn,
    photo: draft.photo,
    unit: "crate",
    stock: draft.stock,
    grade: draft.grade,
    location: draft.location,
    unit_price: draft.unit_price,
    unit_cost: 0,
    color: skuColor(draft.grade, draft.location),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/domain/sku.test.ts`

Expected: PASS, 11 tests (1 canWrite + 1 skuColor + 8 upsertSku)

- [ ] **Step 5: Checkpoint (do not commit)**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`

Expected: existing suite still green plus the new sku tests.

---

### Task 2: Copy, Catalog list + form

**Files:**
- Modify: `frontend/src/i18n/copy.ts`
- Modify: `frontend/src/screens/Catalog.tsx`
- Modify: `frontend/src/styles/global.css`

**Interfaces:**
- Consumes: `upsertSku` is not called here; parent `onSave(draft)` throws. `canWrite: boolean`, `SkuDraft`, `Photo`, `Grade`, `SkuLocation`
- Produces: Catalog with modes `list` | `add` | `edit`. Enterer (`canWrite` false) has no Add/Edit. Writers get Add in the header and Edit on each card. Card tap still calls `onPick`.

- [ ] **Step 1: Add copy keys**

Append to both `bn` and `en` in `frontend/src/i18n/copy.ts` (keep both objects in sync), after the existing user keys, before the closing of each object:

bn:

```ts
    addProduct: "নতুন পণ্য যোগ করুন",
    editProduct: "পণ্য সম্পাদনা",
    nameEn: "নাম",
    nameBn: "বাংলা নাম",
    photo: "ছবি",
    unitPrice: "দাম",
    stock: "স্টক",
    nameRequired: "নাম লাগবে",
    duplicateName: "নাম ইতিমধ্যে আছে",
    invalidPrice: "দাম ঠিক নয়",
    invalidStock: "স্টক ঠিক নয়",
    invalidGrade: "গ্রেড ঠিক নয়",
    invalidLocation: "লোকেশন ঠিক নয়",
    invalidPhoto: "ছবি ঠিক নয়",
```

en:

```ts
    addProduct: "Add product",
    editProduct: "Edit product",
    nameEn: "Name",
    nameBn: "Bangla name",
    photo: "Photo",
    unitPrice: "Unit price",
    stock: "Stock",
    nameRequired: "Name required",
    duplicateName: "Name already exists",
    invalidPrice: "Invalid price",
    invalidStock: "Invalid stock",
    invalidGrade: "Invalid grade",
    invalidLocation: "Invalid location",
    invalidPhoto: "Invalid photo",
```

Reuse `add`, `saved`, `back`, `catalog`, `grade`, `location`.

- [ ] **Step 2: Replace `Catalog.tsx`**

Nested buttons are invalid. Change the card to an `<article>` with an inner pick `<button>` and an optional Edit `<button>`.

Write `frontend/src/screens/Catalog.tsx` as:

```tsx
import { useState } from "react";
import { FruitArt } from "../components/FruitArt";
import type { Grade, Photo, SkuDraft, SkuLocation } from "../domain/sku";
import { copy, type Lang } from "../i18n/copy";
import type { Sku } from "../store/types";

type CatalogProps = {
  lang: Lang;
  skus: Sku[];
  canWrite: boolean;
  onPick: (sku: Sku) => void;
  onSave: (draft: SkuDraft) => void;
};

const PHOTOS: Photo[] = ["apple", "mango", "banana", "orange", "grape", "pomegranate"];
const GRADES: Grade[] = ["A", "B", "C"];
const LOCATIONS: SkuLocation[] = ["cold", "yard", "gudam", "spoil"];

function errorCopy(message: string, t: (typeof copy)[Lang]): string {
  if (message === "name required") return t.nameRequired;
  if (message === "duplicate name") return t.duplicateName;
  if (message === "invalid price") return t.invalidPrice;
  if (message === "invalid stock") return t.invalidStock;
  if (message === "invalid grade") return t.invalidGrade;
  if (message === "invalid location") return t.invalidLocation;
  if (message === "invalid photo") return t.invalidPhoto;
  return message;
}

const emptyDraft: SkuDraft = {
  name: "",
  name_bn: "",
  photo: "apple",
  unit_price: 0,
  stock: 0,
  grade: "A",
  location: "yard",
};

export function Catalog({ lang, skus, canWrite, onPick, onSave }: CatalogProps) {
  const t = copy[lang];
  const [mode, setMode] = useState<"list" | "add" | "edit">("list");
  const [draft, setDraft] = useState<SkuDraft>(emptyDraft);
  const [error, setError] = useState("");

  const closeForm = () => {
    setMode("list");
    setDraft(emptyDraft);
    setError("");
  };

  if (mode === "add" || mode === "edit") {
    return (
      <div className="stack">
        <header className="panel-head">
          <h2>{mode === "edit" ? t.editProduct : t.addProduct}</h2>
        </header>
        <form
          className="panel stack"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              onSave({
                ...draft,
                unit_price: Number(draft.unit_price),
                stock: Number(draft.stock),
              });
              closeForm();
            } catch (err) {
              setError(errorCopy(err instanceof Error ? err.message : "", t));
            }
          }}
        >
          <div className="form-grid">
            <div className="field">
              <label htmlFor="sku-name">{t.nameEn}*</label>
              <input
                id="sku-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="sku-name-bn">{t.nameBn}*</label>
              <input
                id="sku-name-bn"
                value={draft.name_bn}
                onChange={(e) => setDraft({ ...draft, name_bn: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="sku-photo">{t.photo}</label>
              <select
                id="sku-photo"
                value={draft.photo}
                onChange={(e) => setDraft({ ...draft, photo: e.target.value as Photo })}
              >
                {PHOTOS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sku-price">{t.unitPrice}*</label>
              <input
                id="sku-price"
                type="number"
                min={0}
                step="1"
                value={draft.unit_price}
                onChange={(e) => setDraft({ ...draft, unit_price: Number(e.target.value) })}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="sku-stock">{t.stock}*</label>
              <input
                id="sku-stock"
                type="number"
                min={0}
                step="1"
                value={draft.stock}
                onChange={(e) => setDraft({ ...draft, stock: Number(e.target.value) })}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="sku-grade">{t.grade}*</label>
              <select
                id="sku-grade"
                value={draft.grade}
                onChange={(e) => setDraft({ ...draft, grade: e.target.value as Grade })}
              >
                {GRADES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sku-location">{t.location}*</label>
              <select
                id="sku-location"
                value={draft.location}
                onChange={(e) => setDraft({ ...draft, location: e.target.value as SkuLocation })}
              >
                {LOCATIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <div className="row wrap">
            <button type="submit" className="btn primary">
              {t.saved}
            </button>
            <button type="button" className="btn ghost" onClick={closeForm}>
              {t.back}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="stack">
      <header className="panel-head">
        <h2>{t.catalog}</h2>
        {canWrite && (
          <button type="button" className="btn primary sm" onClick={() => setMode("add")}>
            {t.add}
          </button>
        )}
      </header>
      <div className="photo-grid">
        {skus.map((sku) => (
          <article key={sku.id} className="sku-card">
            <button type="button" className="sku-pick" onClick={() => onPick(sku)}>
              <FruitArt kind={sku.photo} className="sku-art" />
              <div className="sku-meta">
                <strong>{lang === "bn" ? sku.name_bn : sku.name}</strong>
                <small>
                  {sku.stock} crate · {sku.unit_price} Tk
                </small>
                <span className={`chip ${sku.color}`}>
                  {sku.grade} · {sku.location}
                </span>
              </div>
            </button>
            {canWrite && (
              <button
                type="button"
                className="btn sm sku-edit"
                onClick={() => {
                  setDraft({
                    id: sku.id,
                    name: sku.name,
                    name_bn: sku.name_bn,
                    photo: sku.photo as Photo,
                    unit_price: sku.unit_price,
                    stock: sku.stock,
                    grade: sku.grade as Grade,
                    location: sku.location as SkuLocation,
                  });
                  setError("");
                  setMode("edit");
                }}
              >
                {t.editProduct}
              </button>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
```

Do not add password, HRM, or extra cards. Do not call `upsertSku` inside Catalog; let `onSave` throw.

- [ ] **Step 3: Card CSS**

Append to `frontend/src/styles/global.css`:

```css
.sku-pick {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
}

.sku-edit {
  margin: 0 12px 12px;
  width: calc(100% - 24px);
}
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`

Expected: FAIL until Task 3 passes `canWrite` and `onSave` into `<Catalog />`. If you typecheck in isolation after Task 3 wiring, skip this failure and continue. Prefer implementing Task 3 immediately after this file write if tsc blocks.

If you need tsc green at this checkpoint before App wiring, temporarily keep compiling by updating App in Task 3 in the same sitting. Task 3 is the official App change.

- [ ] **Step 5: Checkpoint (do not commit)**

If App is not yet wired, do not run the full suite expecting tsc green. Proceed to Task 3.

---

### Task 3: Wire App save handler

**Files:**
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `canWriteCatalog`, `upsertSku`, `SkuDraft` from Task 1; Catalog props from Task 2
- Produces: Catalog receives `canWrite={canWriteCatalog(role)}` and `onSave` that upserts, replace-or-appends `skus`, seeds a lot on add, and never writes `session.role`

- [ ] **Step 1: Import**

Add next to the other domain imports in `frontend/src/App.tsx`:

```ts
import { canWriteCatalog, upsertSku, type SkuDraft } from "./domain/sku";
```

- [ ] **Step 2: Replace the Catalog render**

Replace the existing catalog block:

```tsx
        {screen === "catalog" && (
          <Catalog
            lang={lang}
            skus={state.skus}
            onPick={(sku) => {
              setSaleForm((f) => ({ ...f, skuId: sku.id }));
              goGuarded("sale");
            }}
          />
        )}
```

with:

```tsx
        {screen === "catalog" && (
          <Catalog
            lang={lang}
            skus={state.skus}
            canWrite={canWriteCatalog(role)}
            onPick={(sku) => {
              setSaleForm((f) => ({ ...f, skuId: sku.id }));
              goGuarded("sale");
            }}
            onSave={(draft: SkuDraft) => {
              if (!canWriteCatalog(role)) return;
              const sku = upsertSku(state.skus, draft, new Date().toISOString());
              const skus = state.skus.some((row) => row.id === sku.id)
                ? state.skus.map((row) => (row.id === sku.id ? sku : row))
                : [...state.skus, sku];
              const lots = draft.id
                ? state.lots
                : [
                    ...state.lots,
                    {
                      sku_id: sku.id,
                      challan: `CH-NEW-${sku.id}`,
                      remaining: sku.stock,
                      unit_cost: 0,
                      received_at: Date.now(),
                    },
                  ];
              save({ ...state, skus, lots });
            }}
          />
        )}
```

Do not assign `session.role`. Do not add a sidebar item. Do not add Catalog write to the tab bar.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`

Expected: clean

- [ ] **Step 4: Checkpoint (do not commit)**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`

Expected: previous 61 + 11 sku tests = 72 frontend tests, tsc clean.

---

### Task 4: Full verification

**Files:** none new

- [ ] **Step 1: Frontend suite**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`

Expected: all pass, tsc clean.

- [ ] **Step 2: Backend suite (no changes expected)**

Run: `cd backend && PYTHONPATH=. python3 -m pytest -q`

Expected: 69 passed

- [ ] **Step 3: Manual UI check**

Cycle the top-bar chip to Super Admin. Open Catalog. Confirm Add is visible and cards show Edit. Add a product with a unique English name. Confirm the grid grows and a sale can pick it. Edit Fuji price. Confirm the chip role did not change.

Cycle to Owner. Confirm Add/Edit still visible.

Cycle to Enterer. Confirm Add and Edit are hidden. Tap a card still opens Sale.

- [ ] **Step 4: Checkpoint (do not commit)**

Leave git dirty unless the user asks to commit.

---

## Spec coverage

| Spec section | Task |
| --- | --- |
| 4.1 SKU + derived color + crate/unit_cost defaults | 1 |
| 4.2 canWriteCatalog | 1, 3 |
| 4.3 upsertSku rules | 1 |
| 4.4 Lot on add only | 3 |
| 4.5 Session unchanged | 3 |
| 5 Local snapshot | 3 |
| 6 No new RBAC key; Enterer keeps screen.catalog | 1, 3 |
| 7.1 No new nav | 3 |
| 7.2 List + Add + Edit on cards; tap still sells | 2 |
| 7.3 Form fields | 2 |
| 7.4 Copy | 2 |
| 8 App save handler | 3 |
| 9 Tests | 1, 4 |
| No PIN/HRM/delete/API | 2, 3 (omitted) |
