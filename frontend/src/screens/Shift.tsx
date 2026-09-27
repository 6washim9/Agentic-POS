import { copy, type Lang } from "../i18n/copy";
import type { ShiftState } from "../store/types";

type ShiftProps = {
  lang: Lang;
  shift: ShiftState;
  onOpen: () => void;
  onClose: () => void;
};

export function ShiftScreen({ lang, shift, onOpen, onClose }: ShiftProps) {
  const t = copy[lang];
  return (
    <div className="panel stack">
      <header className="panel-head">
        <h2>{t.zReport}</h2>
        <span className={`badge ${shift.status === "open" ? "paid" : "due"}`}>{shift.status}</span>
      </header>
      <div className="list-item">
        <span>{t.shift}</span>
        <strong>{shift.status}</strong>
      </div>
      <div className="list-item">
        <span>{t.floatAmt}</span>
        <strong>{shift.floatAmount.toLocaleString()}</strong>
      </div>
      <div className="list-item">
        <span>{t.cash}</span>
        <strong>{shift.cashCollected.toLocaleString()}</strong>
      </div>
      <div className="list-item">
        <span>{t.joma}</span>
        <strong>{shift.collectionCash.toLocaleString()}</strong>
      </div>
      <div className="list-item">
        <span>{t.baki}</span>
        <strong>{shift.creditIssued.toLocaleString()}</strong>
      </div>
      <div className="list-item">
        <span>{t.drawer}</span>
        <strong>{shift.expectedDrawer.toLocaleString()}</strong>
      </div>
      {shift.status === "open" ? (
        <button type="button" className="btn danger wide" onClick={onClose}>
          {t.closeShift}
        </button>
      ) : (
        <button type="button" className="btn primary wide" onClick={onOpen}>
          {t.openShift}
        </button>
      )}
    </div>
  );
}
