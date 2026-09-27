import { clipOwner, weaker, type Cell } from "../domain/rbac";
import { copy, type CopyKey, type Lang } from "../i18n/copy";

export const OWNER_CARDS: { id: string; labelKey: CopyKey; keys: string[] }[] = [
  { id: "sales", labelKey: "sale", keys: ["screen.sale", "agent.sale"] },
  { id: "catalog", labelKey: "catalog", keys: ["screen.catalog"] },
  { id: "ledger", labelKey: "ledger", keys: ["screen.ledger", "agent.reminder", "agent.collection"] },
  { id: "warehouse", labelKey: "warehouse", keys: ["screen.warehouse", "screen.landed"] },
  { id: "spoilage", labelKey: "spoilage", keys: ["screen.spoilage", "agent.spoilage", "hitl.write_off"] },
  { id: "shift", labelKey: "shift", keys: ["screen.shift", "hitl.shift_close"] },
  { id: "credit", labelKey: "hitlTitle", keys: ["hitl.credit_override"] },
];

const CELLS: Cell[] = ["allow", "confirm", "deny"];

type Props = {
  lang: Lang;
  capsEnterer: Record<string, Cell>;
  owner: Record<string, Cell>;
  onChange: (owner: Record<string, Cell>) => void;
  onSave: () => void;
  onCapExceeded: () => void;
};

function cellLabel(cell: Cell, t: (typeof copy)[Lang]): string {
  if (cell === "allow") return t.allow;
  if (cell === "confirm") return t.confirmCell;
  return t.deny;
}

export function Settings({ lang, capsEnterer, owner, onChange, onSave, onCapExceeded }: Props) {
  const t = copy[lang];

  const applyCell = (keys: string[], chosen: Cell) => {
    if (keys.some((key) => weaker(capsEnterer[key] ?? "deny", chosen) !== chosen)) {
      onCapExceeded();
      return;
    }
    const next = { ...owner };
    for (const key of keys) {
      next[key] = chosen;
    }
    onChange(clipOwner(capsEnterer, next));
  };

  return (
    <div className="panel stack">
      <header className="panel-head">
        <h2>{t.settings}</h2>
      </header>
      {OWNER_CARDS.map((card) => {
        const key = card.keys[0];
        const cap = capsEnterer[key] ?? "deny";
        const displayed = weaker(cap, owner[key] ?? cap);
        return (
          <div key={card.id} className="settings-card stack">
            <strong>{t[card.labelKey]}</strong>
            <div className="row">
              {CELLS.map((cell) => (
                <button
                  key={cell}
                  type="button"
                  className={`btn ghost cell-${cell}${displayed === cell ? " primary" : ""}`}
                  onClick={() => applyCell(card.keys, cell)}
                >
                  {cellLabel(cell, t)}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <button type="button" className="btn primary wide" onClick={onSave}>
        {t.saved}
      </button>
    </div>
  );
}
