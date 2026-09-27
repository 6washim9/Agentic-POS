import { copy, type Lang } from "../i18n/copy";
import type { ShopConfig } from "../store/types";

type WizardProps = {
  lang: Lang;
  config: ShopConfig;
  onChange: (next: Partial<ShopConfig>) => void;
  onDone: () => void;
};

function Choice({
  label,
  value,
  yes,
  no,
  onChange,
}: {
  label: string;
  value: boolean;
  yes: string;
  no: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="row">
        <button type="button" className={`btn ${value ? "primary" : "ghost"}`} onClick={() => onChange(true)}>
          {yes}
        </button>
        <button type="button" className={`btn ${!value ? "primary" : "ghost"}`} onClick={() => onChange(false)}>
          {no}
        </button>
      </div>
    </div>
  );
}

export function Wizard({ lang, config, onChange, onDone }: WizardProps) {
  const t = copy[lang];
  return (
    <div className="stack">
      <header className="panel-head">
        <h2>{t.wizardTitle}</h2>
      </header>
      <div className="panel stack">
        <div className="field">
          <label htmlFor="shop">{t.shopName}</label>
          <input
            id="shop"
            value={config.shop_name}
            onChange={(e) => onChange({ shop_name: e.target.value })}
          />
        </div>
        <Choice label={t.qCrates} value={config.manage_crates} yes={t.yes} no={t.no} onChange={(v) => onChange({ manage_crates: v })} />
        <Choice label={t.qCredit} value={config.extend_credit} yes={t.yes} no={t.no} onChange={(v) => onChange({ extend_credit: v })} />
        <Choice label={t.qCold} value={config.cold_storage} yes={t.yes} no={t.no} onChange={(v) => onChange({ cold_storage: v })} />
        <button type="button" className="btn primary wide" onClick={onDone}>
          {t.start}
        </button>
      </div>
    </div>
  );
}
