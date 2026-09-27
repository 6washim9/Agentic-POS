import { useEffect, useState } from "react";
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
  const view = canWrite ? mode : "list";

  const closeForm = () => {
    setMode("list");
    setDraft(emptyDraft);
    setError("");
  };

  useEffect(() => {
    if (!canWrite) closeForm();
  }, [canWrite]);

  if (view === "add" || view === "edit") {
    return (
      <div className="stack">
        <header className="panel-head">
          <h2>{view === "edit" ? t.editProduct : t.addProduct}</h2>
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
