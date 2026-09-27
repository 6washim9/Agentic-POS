import { copy, type Lang } from "../i18n/copy";
import type { Sku } from "../store/types";

type LandedProps = {
  lang: Lang;
  skus: Sku[];
  skuId: string;
  crates: number;
  base: number;
  duty: number;
  freight: number;
  clearance: number;
  transport: number;
  challan: string;
  onSku: (id: string) => void;
  onNum: (key: string, n: number) => void;
  onChallan: (value: string) => void;
  onSubmit: () => void;
};

export function Landed({
  lang,
  skus,
  skuId,
  crates,
  base,
  duty,
  freight,
  clearance,
  transport,
  challan,
  onSku,
  onNum,
  onChallan,
  onSubmit,
}: LandedProps) {
  const t = copy[lang];
  return (
    <div className="panel stack">
      <h2>{t.landed}</h2>
      <div className="field">
        <label htmlFor="lot-sku">{t.catalog}</label>
        <select id="lot-sku" value={skuId} onChange={(e) => onSku(e.target.value)}>
          {skus.map((s) => (
            <option key={s.id} value={s.id}>
              {lang === "bn" ? s.name_bn : s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="challan">{t.challan}</label>
        <input id="challan" value={challan} onChange={(e) => onChallan(e.target.value)} />
      </div>
      {[
        ["crates", t.crates, crates],
        ["base", t.base, base],
        ["duty", t.duty, duty],
        ["freight", t.freight, freight],
        ["clearance", t.clearance, clearance],
        ["transport", t.transport, transport],
      ].map(([key, label, value]) => (
        <div className="field" key={String(key)}>
          <label htmlFor={String(key)}>{label}</label>
          <input
            id={String(key)}
            type="number"
            min={0}
            value={Number(value)}
            onChange={(e) => onNum(String(key), Number(e.target.value))}
          />
        </div>
      ))}
      <button type="button" className="btn primary wide" onClick={onSubmit}>
        {t.calculate}
      </button>
    </div>
  );
}
