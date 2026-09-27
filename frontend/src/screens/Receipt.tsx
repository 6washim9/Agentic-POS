import { copy, type Lang } from "../i18n/copy";
import type { Customer, Sale } from "../store/types";

type ReceiptProps = {
  lang: Lang;
  sale: Sale | null;
  customers: Customer[];
  onClose: () => void;
};

function shareUrl(channel: "sms" | "whatsapp", phone: string, text: string): string {
  const encoded = encodeURIComponent(text);
  if (channel === "whatsapp") {
    const digits = phone.replace(/[^\d]/g, "");
    return `https://wa.me/${digits}?text=${encoded}`;
  }
  return `sms:${phone}?body=${encoded}`;
}

export function Receipt({ lang, sale, customers, onClose }: ReceiptProps) {
  const t = copy[lang];
  if (!sale) return <p>{t.empty}</p>;
  const customer = customers.find((c) => c.id === sale.customer_id);
  const phone = customer?.phone ?? "";
  return (
    <div className="stack">
      <pre className="receipt">{sale.receipt}</pre>
      <button type="button" className="btn primary wide" onClick={() => window.print()}>
        {t.print}
      </button>
      <div className="row">
        <a className="btn ghost wide" href={shareUrl("sms", phone, sale.receipt)}>
          {t.sendSms}
        </a>
        <a className="btn ghost wide" href={shareUrl("whatsapp", phone, sale.receipt)} target="_blank" rel="noreferrer">
          {t.sendWa}
        </a>
      </div>
      <button type="button" className="btn ghost wide" onClick={onClose}>
        {t.cancel}
      </button>
    </div>
  );
}
