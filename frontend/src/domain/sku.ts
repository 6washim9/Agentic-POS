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
