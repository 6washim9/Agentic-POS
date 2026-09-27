import { copy, type Lang } from "../i18n/copy";
import type { Customer, Sku } from "../store/types";

type SaleProps = {
  lang: Lang;
  skus: Sku[];
  customers: Customer[];
  manageCrates: boolean;
  extendCredit: boolean;
  skuId: string;
  customerId: string;
  qty: number;
  returned: number;
  onCredit: boolean;
  cashPaid: number;
  onSku: (id: string) => void;
  onCustomer: (id: string) => void;
  onQty: (n: number) => void;
  onReturned: (n: number) => void;
  onCreditChange: (v: boolean) => void;
  onCashPaid: (n: number) => void;
  onSubmit: () => void;
};

export function SaleForm({
  lang,
  skus,
  customers,
  manageCrates,
  extendCredit,
  skuId,
  customerId,
  qty,
  returned,
  onCredit,
  cashPaid,
  onSku,
  onCustomer,
  onQty,
  onReturned,
  onCreditChange,
  onCashPaid,
  onSubmit,
}: SaleProps) {
  const t = copy[lang];
  const sku = skus.find((s) => s.id === skuId);
  const total = (sku?.unit_price ?? 0) * qty;
  const remainder = Math.max(total - cashPaid, 0);
  return (
    <div className="panel stack">
      <header className="panel-head">
        <h2>{t.recordSale}</h2>
        <span className="chip magenta">{t.pos}</span>
      </header>
      <div className="field">
        <label htmlFor="sku">{t.catalog}</label>
        <select id="sku" value={skuId} onChange={(e) => onSku(e.target.value)}>
          {skus.map((s) => (
            <option key={s.id} value={s.id}>
              {lang === "bn" ? s.name_bn : s.name} ({s.stock})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="cust">{t.ledger}</label>
        <select id="cust" value={customerId} onChange={(e) => onCustomer(e.target.value)}>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {lang === "bn" ? c.name_bn : c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="qty">{t.crates}</label>
        <input id="qty" type="number" min={1} value={qty} onChange={(e) => onQty(Number(e.target.value))} />
      </div>
      {manageCrates && (
        <div className="field">
          <label htmlFor="ret">{t.returned}</label>
          <input id="ret" type="number" min={0} value={returned} onChange={(e) => onReturned(Number(e.target.value))} />
        </div>
      )}
      {extendCredit && (
        <div className="row">
          <button type="button" className={`btn ${!onCredit ? "primary" : "ghost"}`} onClick={() => onCreditChange(false)}>
            {t.cash}
          </button>
          <button type="button" className={`btn ${onCredit ? "danger" : "ghost"}`} onClick={() => onCreditChange(true)}>
            {t.baki}
          </button>
        </div>
      )}
      {extendCredit && (
        <div className="field">
          <label htmlFor="cashPaid">{t.cashPaid}</label>
          <input
            id="cashPaid"
            type="number"
            min={0}
            max={total}
            value={cashPaid}
            onChange={(e) => onCashPaid(Number(e.target.value))}
          />
          <small>
            {t.remainingBaki}: {remainder.toLocaleString()}
          </small>
        </div>
      )}
      <button type="button" className="btn primary wide" onClick={onSubmit}>
        {t.recordSale}
      </button>
    </div>
  );
}
