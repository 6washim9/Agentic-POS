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
