import { CATALOG, forceSuperAdminAdmin, type Caps, type Cell, type Role } from "../domain/rbac";
import { copy, type Lang } from "../i18n/copy";

type Props = {
  lang: Lang;
  shopName: string;
  caps: Caps;
  onChange: (caps: Caps) => void;
  onSave: () => void;
  onReset: () => void;
};

const ROLES: Role[] = ["super_admin", "owner", "enterer"];

const GROUPS: { id: string; labelBn: string; labelEn: string; keys: readonly string[] }[] = [
  { id: "screens", labelBn: "স্ক্রিন", labelEn: "Screens", keys: CATALOG.filter((key) => key.startsWith("screen.")) },
  { id: "agent", labelBn: "এজেন্ট", labelEn: "Agent", keys: CATALOG.filter((key) => key.startsWith("agent.")) },
  { id: "hitl", labelBn: "HITL", labelEn: "HITL", keys: CATALOG.filter((key) => key.startsWith("hitl.")) },
];

function nextCell(cell: Cell): Cell {
  if (cell === "allow") return "confirm";
  if (cell === "confirm") return "deny";
  return "allow";
}

function roleLabel(role: Role, lang: Lang): string {
  if (role === "super_admin") return lang === "bn" ? "সুপার অ্যাডমিন" : "Super Admin";
  if (role === "owner") return lang === "bn" ? "মালিক" : "Owner";
  return lang === "bn" ? "এন্ট্রি" : "Enterer";
}

function cellLabel(cell: Cell, t: (typeof copy)[Lang]): string {
  if (cell === "allow") return t.allow;
  if (cell === "confirm") return t.confirmCell;
  return t.deny;
}

export function AdminMatrix({ lang, shopName, caps, onChange, onSave, onReset }: Props) {
  const t = copy[lang];

  const cycle = (role: Role, key: string, cell: Cell) => {
    if (role === "super_admin" && key === "screen.admin") return;
    const next: Caps = {
      super_admin: { ...caps.super_admin },
      owner: { ...caps.owner },
      enterer: { ...caps.enterer },
    };
    next[role] = { ...next[role], [key]: nextCell(cell) };
    onChange(forceSuperAdminAdmin(next));
  };

  return (
    <div className="panel stack">
      <header className="panel-head">
        <h2>
          {t.admin} · {shopName}
        </h2>
      </header>
      {GROUPS.map((group) => (
        <div key={group.id} className="stack">
          <h3>{lang === "bn" ? group.labelBn : group.labelEn}</h3>
          <table className="matrix">
            <thead>
              <tr>
                <th>{t.role}</th>
                {ROLES.map((role) => (
                  <th key={role}>{roleLabel(role, lang)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {group.keys.map((key) => (
                <tr key={key}>
                  <td>{key}</td>
                  {ROLES.map((role) => {
                    const cell: Cell = caps[role]?.[key] ?? "deny";
                    const locked = role === "super_admin" && key === "screen.admin";
                    return (
                      <td key={role}>
                        <button
                          type="button"
                          className={`btn ghost cell-${cell}`}
                          disabled={locked}
                          onClick={() => cycle(role, key, cell)}
                        >
                          {cellLabel(cell, t)}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div className="row">
        <button type="button" className="btn primary" onClick={onSave}>
          {t.saved}
        </button>
        <button type="button" className="btn ghost" onClick={onReset}>
          {t.resetDefaults}
        </button>
      </div>
    </div>
  );
}
