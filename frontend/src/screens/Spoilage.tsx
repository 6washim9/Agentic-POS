import { copy, type Lang } from "../i18n/copy";
import type { Sku } from "../store/types";

type SpoilageProps = {
  lang: Lang;
  skus: Sku[];
  skuId: string;
  qty: number;
  grade: string;
  writeOff: boolean;
  onSku: (id: string) => void;
  onQty: (n: number) => void;
  onGrade: (g: string) => void;
  onWriteOff: (v: boolean) => void;
  onSubmit: () => void;
};

export function Spoilage({
  lang,
  skus,
  skuId,
  qty,
  grade,
  writeOff,
  onSku,
  onQty,
  onGrade,
  onWriteOff,
  onSubmit,
}: SpoilageProps) {
  const t = copy[lang];
  return (
    <div className="panel stack">
      <h2>{t.spoilage}</h2>
      <div className="field">
        <label htmlFor="sp-sku">{t.catalog}</label>
        <select id="sp-sku" value={skuId} onChange={(e) => onSku(e.target.value)}>
          {skus.map((s) => (
            <option key={s.id} value={s.id}>
              {lang === "bn" ? s.name_bn : s.name} ({s.stock})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="sp-qty">{t.crates}</label>
        <input id="sp-qty" type="number" min={1} value={qty} onChange={(e) => onQty(Number(e.target.value))} />
      </div>
      <div className="field">
        <label htmlFor="sp-grade">{t.grade}</label>
        <select id="sp-grade" value={grade} onChange={(e) => onGrade(e.target.value)}>
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
        </select>
      </div>
      <button type="button" className={`btn ${writeOff ? "danger" : "ghost"}`} onClick={() => onWriteOff(!writeOff)}>
        {t.writeOff}: {writeOff ? t.yes : t.no}
      </button>
      <button type="button" className="btn primary wide" onClick={onSubmit}>
        {t.logSpoilage}
      </button>
    </div>
  );
}
