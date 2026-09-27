import { FruitArt } from "../components/FruitArt";
import { copy, type Lang } from "../i18n/copy";
import type { Screen, Sku } from "../store/types";

type WarehouseProps = {
  lang: Lang;
  skus: Sku[];
  go: (s: Screen) => void;
};

export function Warehouse({ lang, skus, go }: WarehouseProps) {
  const t = copy[lang];
  const stored = skus.filter((s) => s.location === "cold" || s.location === "gudam" || s.location === "yard");
  return (
    <div className="stack">
      <header className="panel-head">
        <h2>{t.warehouse}</h2>
      </header>
      <div className="row">
        <button type="button" className="btn primary" onClick={() => go("landed")}>
          {t.landed}
        </button>
        <button type="button" className="btn ghost" onClick={() => go("spoilage")}>
          {t.spoilage}
        </button>
      </div>
      <div className="photo-grid">
        {stored.map((sku) => (
          <div key={sku.id} className="sku-card">
            <FruitArt kind={sku.photo} className="sku-art" />
            <div className="sku-meta">
              <strong>{lang === "bn" ? sku.name_bn : sku.name}</strong>
              <small>
                {sku.stock} · {t.unitCost} {sku.unit_cost}
              </small>
              <span className={`chip ${sku.color}`}>
                {sku.location} · {sku.grade}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
