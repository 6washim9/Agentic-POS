import { useState } from "react";
import type { Prefix, UserDraft } from "../domain/user";
import { copy, type Lang } from "../i18n/copy";
import type { Role } from "../domain/rbac";
import type { User } from "../store/types";

type Props = {
  lang: Lang;
  users: User[];
  onCreate: (draft: UserDraft) => void;
};

const PREFIXES: Prefix[] = ["mr", "mrs", "miss"];
const ROLES: Role[] = ["enterer", "owner", "super_admin"];

function prefixLabel(prefix: Prefix, t: (typeof copy)[Lang]): string {
  if (prefix === "mrs") return t.prefixMrs;
  if (prefix === "miss") return t.prefixMiss;
  return t.prefixMr;
}

function roleLabel(role: Role, lang: Lang): string {
  if (role === "super_admin") return lang === "bn" ? "সুপার অ্যাডমিন" : "Super Admin";
  if (role === "owner") return lang === "bn" ? "মালিক" : "Owner";
  return lang === "bn" ? "এন্ট্রি" : "Enterer";
}

function errorCopy(message: string, t: (typeof copy)[Lang]): string {
  if (message === "email already exists") return t.emailExists;
  if (message === "invalid email") return t.invalidEmail;
  if (message === "name and email required") return t.nameEmailRequired;
  return message;
}

export function Users({ lang, users, onCreate }: Props) {
  const t = copy[lang];
  const [mode, setMode] = useState<"list" | "add">("list");
  const [prefix, setPrefix] = useState<Prefix>("mr");
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [active, setActive] = useState(true);
  const [role, setRole] = useState<Role>("enterer");
  const [error, setError] = useState("");

  if (mode === "add") {
    return (
      <div className="stack">
        <header className="panel-head">
          <h2>{t.addUser}</h2>
        </header>
        <form
          className="panel stack"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              onCreate({ prefix, first_name: firstName, email, active, role });
              setFirstName("");
              setEmail("");
              setActive(true);
              setPrefix("mr");
              setRole("enterer");
              setError("");
              setMode("list");
            } catch (err) {
              setError(errorCopy(err instanceof Error ? err.message : "", t));
            }
          }}
        >
          <div className="form-grid">
            <div className="field">
              <label htmlFor="user-prefix">{t.prefix}</label>
              <select id="user-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value as Prefix)}>
                {PREFIXES.map((item) => (
                  <option key={item} value={item}>
                    {prefixLabel(item, t)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="user-name">{t.firstName}*</label>
              <input id="user-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="user-email">{t.email}*</label>
              <input id="user-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="user-role">{t.role}*</label>
              <select id="user-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLES.map((item) => (
                  <option key={item} value={item}>
                    {roleLabel(item, lang)}
                  </option>
                ))}
              </select>
            </div>
            <label className="check-field">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              {t.active}
            </label>
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
            <button type="button" className="btn ghost" onClick={() => setMode("list")}>
              {t.back}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="panel table-panel">
      <header className="panel-head">
        <h2>{t.users}</h2>
        <button type="button" className="btn primary sm" onClick={() => setMode("add")}>
          {t.add}
        </button>
      </header>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t.firstName}</th>
              <th>{t.email}</th>
              <th>{t.role}</th>
              <th>{t.active}</th>
              <th>{t.date}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  {prefixLabel(user.prefix, t)} {user.first_name}
                </td>
                <td>{user.email}</td>
                <td>{roleLabel(user.role, lang)}</td>
                <td>
                  <span className={`badge ${user.active ? "paid" : "due"}`}>{user.active ? t.active : t.inactive}</span>
                </td>
                <td>{user.created_at.replace("T", " ").slice(0, 16)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
