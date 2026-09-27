import { AlertIcon, BoxIcon, CartIcon, CashIcon, ClockIcon, FlameIcon, GridIcon, SnowIcon } from "../components/Icons";
import { duesShare, formatTaka, paymentStatus, recentSales, salesByDay, topProducts } from "../domain/dashboard";
import { copy, type Lang } from "../i18n/copy";
import type { Collection, Kpis, Sale, Screen } from "../store/types";

type HomeProps = {
  lang: Lang;
  kpis: Kpis;
  sales: Sale[];
  collections: Collection[];
  shopName: string;
  roleLabel: string;
  go: (s: Screen) => void;
  canGo: (screen: Screen) => boolean;
  showSettings: boolean;
  showAdmin?: boolean;
};

function statusLabel(status: ReturnType<typeof paymentStatus>, t: (typeof copy)[Lang]): string {
  if (status === "paid") return t.paid;
  if (status === "partial") return t.partial;
  return t.due;
}

export function Home({
  lang,
  kpis,
  sales,
  collections,
  shopName,
  roleLabel,
  go,
  canGo,
  showSettings,
  showAdmin,
}: HomeProps) {
  const t = copy[lang];
  const collected = collections.reduce((n, c) => n + c.amount, 0);
  const share = duesShare(Math.max(kpis.outstanding_dues, 0), collected);
  const trend = salesByDay(sales, 7, new Date());
  const maxTrend = Math.max(...trend.map((d) => d.total), 1);
  const recent = recentSales(sales, 6);
  const products = topProducts(sales).slice(0, 5);
  const totalSales = kpis.cash_today + kpis.credit_today;
  const net = kpis.cash_today;

  return (
    <div className="dash">
      <section className="welcome-bar">
        <div>
          <h1>
            {t.welcome} {roleLabel}
          </h1>
          <p>
            {t.shop}: {shopName}
          </p>
        </div>
        <div className="welcome-pills">
          <span className="chip magenta">{t.dashboard}</span>
          {kpis.pending_events > 0 && canGo("shift") && (
            <button type="button" className="chip yellow" onClick={() => go("shift")}>
              {kpis.pending_events} {t.pendingSync}
            </button>
          )}
        </div>
      </section>

      <section className="today-hero" aria-label={t.todaySales}>
        <span>{t.todaySales}</span>
        <strong>Tk {formatTaka(totalSales)}</strong>
      </section>

      <section className="kpi-grid">
        {canGo("sale") && (
          <button type="button" className="kpi-card" onClick={() => go("sale")}>
            <div className="kpi-icon green">
              <CartIcon />
            </div>
            <div>
              <small>{t.totalSales}</small>
              <strong>Tk {formatTaka(totalSales)}</strong>
            </div>
          </button>
        )}
        {canGo("ledger") && (
          <button type="button" className="kpi-card" onClick={() => go("ledger")}>
            <div className="kpi-icon red">
              <AlertIcon />
            </div>
            <div>
              <small>{t.invoiceDue}</small>
              <strong>Tk {formatTaka(kpis.outstanding_dues)}</strong>
            </div>
          </button>
        )}
        {canGo("sale") && (
          <button type="button" className="kpi-card" onClick={() => go("sale")}>
            <div className="kpi-icon magenta">
              <CashIcon />
            </div>
            <div>
              <small>{t.net}</small>
              <strong>Tk {formatTaka(net)}</strong>
            </div>
          </button>
        )}
        {canGo("warehouse") && (
          <button type="button" className="kpi-card" onClick={() => go("warehouse")}>
            <div className="kpi-icon yellow">
              <SnowIcon />
            </div>
            <div>
              <small>{t.warehouse}</small>
              <strong>{formatTaka(kpis.warehouse_stock)}</strong>
            </div>
          </button>
        )}
        {canGo("spoilage") && (
          <button type="button" className="kpi-card" onClick={() => go("spoilage")}>
            <div className="kpi-icon orange">
              <FlameIcon />
            </div>
            <div>
              <small>{t.spoilage}</small>
              <strong>{formatTaka(kpis.spoilage_qty)}</strong>
            </div>
          </button>
        )}
        {canGo("shift") && (
          <button type="button" className="kpi-card" onClick={() => go("shift")}>
            <div className="kpi-icon blue">
              <ClockIcon />
            </div>
            <div>
              <small>{t.pendingSync}</small>
              <strong>{kpis.pending_events}</strong>
            </div>
          </button>
        )}
      </section>

      <section className="action-grid mobile-only">
        {canGo("sale") && (
          <button type="button" className="action-tile" onClick={() => go("sale")}>
            <CartIcon />
            {t.sale}
          </button>
        )}
        {canGo("ledger") && (
          <button type="button" className="action-tile" onClick={() => go("ledger")}>
            <CashIcon />
            {t.collect}
          </button>
        )}
        {canGo("catalog") && (
          <button type="button" className="action-tile" onClick={() => go("catalog")}>
            <GridIcon />
            {t.catalog}
          </button>
        )}
        {canGo("warehouse") && (
          <button type="button" className="action-tile" onClick={() => go("warehouse")}>
            <BoxIcon />
            {t.warehouse}
          </button>
        )}
      </section>

      <section className="chart-row">
        <article className="panel">
          <header className="panel-head">
            <h2>{t.salesTrend}</h2>
          </header>
          <div className="bar-chart" role="img" aria-label={t.salesTrend}>
            {trend.map((day) => (
              <div key={day.date} className="bar-col">
                <div className="bar" style={{ height: `${Math.max((day.total / maxTrend) * 100, 4)}%` }} />
                <small>{day.date.slice(8)}</small>
              </div>
            ))}
          </div>
        </article>
        <article className="panel">
          <header className="panel-head">
            <h2>{t.duesVsCollected}</h2>
          </header>
          <div className="donut-wrap">
            <div
              className="donut"
              style={{
                background: `conic-gradient(var(--magenta) 0 ${share.due}%, var(--green) ${share.due}% 100%)`,
              }}
              aria-label={`${t.baki} ${share.due}%, ${t.joma} ${share.collected}%`}
            />
            <ul className="legend">
              <li>
                <i className="swatch magenta" /> {t.baki} {share.due}%
              </li>
              <li>
                <i className="swatch green" /> {t.joma} {share.collected}%
              </li>
            </ul>
          </div>
        </article>
      </section>

      <section className="split-row">
        <article className="panel table-panel">
          <header className="panel-head">
            <h2>{t.recentSales}</h2>
            {canGo("sale") && (
              <button type="button" className="btn primary sm" onClick={() => go("sale")}>
                {t.add}
              </button>
            )}
          </header>
          {recent.length === 0 ? (
            <p className="empty">{t.empty}</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t.date}</th>
                    <th>{t.invoiceNo}</th>
                    <th>{t.customerName}</th>
                    <th>{t.paymentStatus}</th>
                    <th>{t.totalAmount}</th>
                    <th>{t.sellDue}</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((sale) => {
                    const status = paymentStatus(sale);
                    return (
                      <tr key={sale.id}>
                        <td>{sale.created_at.replace("T", " ").slice(0, 16)}</td>
                        <td>{sale.id.slice(0, 8)}</td>
                        <td>{sale.customer_name}</td>
                        <td>
                          <span className={`badge ${status}`}>{statusLabel(status, t)}</span>
                        </td>
                        <td>Tk {formatTaka(sale.amount)}</td>
                        <td>Tk {formatTaka(Math.max(sale.amount - (sale.cash_paid ?? 0), 0))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </article>
        <article className="panel">
          <header className="panel-head">
            <h2>{t.topProducts}</h2>
          </header>
          {products.length === 0 ? (
            <p className="empty">{t.empty}</p>
          ) : (
            <ul className="product-list">
              {products.map((item) => (
                <li key={item.skuId}>
                  <span>
                    {item.name}
                    <small>
                      {t.qty}: {item.qty}
                    </small>
                  </span>
                  <strong>Tk {formatTaka(item.amount)}</strong>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <div className="row wrap">
        {canGo("shift") && (
          <button type="button" className="btn ghost" onClick={() => go("shift")}>
            {t.zReport}
          </button>
        )}
        {showSettings && (
          <button type="button" className="btn ghost" onClick={() => go("settings")}>
            {t.settings}
          </button>
        )}
        {showAdmin && (
          <button type="button" className="btn ghost" onClick={() => go("admin")}>
            {t.admin}
          </button>
        )}
      </div>
    </div>
  );
}
