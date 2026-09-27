import { Fragment, useMemo, useState } from "react";
import { deriveKhata } from "../domain/collection";
import { formatTaka } from "../domain/dashboard";
import { copy, type Lang } from "../i18n/copy";
import type { Collection, Customer, Sale } from "../store/types";

type LedgerProps = {
  lang: Lang;
  customers: Customer[];
  sales: Sale[];
  collections: Collection[];
  onRemind: (id: string, channel: "sms" | "whatsapp") => void;
  onCollect: (id: string, amount: number, note: string) => void;
};

export function Ledger({ lang, customers, sales, collections, onRemind, onCollect }: LedgerProps) {
  const t = copy[lang];
  const [openId, setOpenId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");

  const chipClass = (balance: number) => (balance > 0 ? "due" : balance === 0 ? "paid" : "partial");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter((c) => {
      if (!q) return true;
      return [c.name, c.name_bn, c.phone].some((value) => value.toLowerCase().includes(q));
    });
  }, [customers, query]);

  return (
    <div className="panel table-panel">
      <header className="panel-head">
        <h2>{t.ledger}</h2>
        <div className="toolbar">
          <input
            className="search"
            value={query}
            placeholder={t.search}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t.search}
          />
        </div>
      </header>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t.actions}</th>
              <th>{t.customerName}</th>
              <th>{t.contact}</th>
              <th>{t.dues}</th>
              <th>{t.crateBal}</th>
              <th>{t.collect}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const khata = deriveKhata(
                c.credit_balance,
                sales
                  .filter((sale) => sale.customer_id === c.id)
                  .map((sale) => ({
                    id: sale.id,
                    amount: sale.amount,
                    cash_paid: sale.cash_paid ?? (sale.on_credit ? 0 : sale.amount),
                    on_credit: sale.on_credit,
                    created_at: sale.created_at,
                  })),
                collections.filter((entry) => entry.customer_id === c.id),
              );
              const open = openId === c.id;
              return (
                <Fragment key={c.id}>
                  <tr>
                    <td>
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => setOpenId(open ? null : c.id)}
                      >
                        {t.khata}
                      </button>
                    </td>
                    <td>
                      <strong>{lang === "bn" ? c.name_bn : c.name}</strong>
                    </td>
                    <td>{c.phone}</td>
                    <td>
                      <span className={`badge ${chipClass(c.credit_balance)}`}>
                        Tk {formatTaka(c.credit_balance)}
                      </span>
                    </td>
                    <td>{c.crate_balance}</td>
                    <td>
                      <div className="collect-inline">
                        <input
                          type="number"
                          min={1}
                          placeholder={t.collect}
                          value={open ? amount : ""}
                          onChange={(e) => {
                            setOpenId(c.id);
                            setAmount(e.target.value);
                          }}
                        />
                        <input
                          type="text"
                          placeholder={t.note}
                          value={open ? note : ""}
                          onChange={(e) => {
                            setOpenId(c.id);
                            setNote(e.target.value);
                          }}
                        />
                        <button
                          type="button"
                          className="btn primary sm"
                          onClick={() => {
                            const value = Number(amount);
                            if (!Number.isFinite(value) || value <= 0) return;
                            onCollect(c.id, value, note);
                            setAmount("");
                            setNote("");
                          }}
                        >
                          {t.collect}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {open && (
                    <tr key={`${c.id}-khata`} className="khata-row">
                      <td colSpan={6}>
                        <div className="khata">
                          <div className="row wrap">
                            <button
                              type="button"
                              className="btn ghost sm"
                              disabled={c.credit_balance <= 0}
                              onClick={() => onRemind(c.id, "sms")}
                            >
                              {t.sendSms}
                            </button>
                            <button
                              type="button"
                              className="btn ghost sm"
                              disabled={c.credit_balance <= 0}
                              onClick={() => onRemind(c.id, "whatsapp")}
                            >
                              {t.sendWa}
                            </button>
                          </div>
                          <strong>{t.khata}</strong>
                          {khata.opening !== 0 && (
                            <div className="list-item">
                              <span>{t.opening}</span>
                              <strong>Tk {formatTaka(khata.opening)}</strong>
                            </div>
                          )}
                          {khata.lines.map((line) => (
                            <div key={`${line.kind}-${line.id}`} className="list-item">
                              <span>
                                {line.kind === "sale" ? t.baki : t.joma}
                                {line.isAdvance ? ` · ${t.advance}` : ""}
                              </span>
                              <span>
                                {line.kind === "sale" ? "-" : "+"}
                                {formatTaka(line.amount)} · {formatTaka(line.balance)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
