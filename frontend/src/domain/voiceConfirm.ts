export type ConfirmDraft = {
  intent: string;
  customerName: string;
  skuName: string;
  qty: number;
  amount: number;
  onCredit: boolean;
  lang: "bn" | "en";
};

export type ConfirmReply = {
  decision: "commit" | "cancel" | "revise";
  qty?: number;
};

const BN = "০১২৩৪৫৬৭৮৯";

function toBnDigits(value: number): string {
  return String(value).replace(/\d/g, (d) => BN[Number(d)]);
}

export function buildConfirmPrompt(draft: ConfirmDraft): string {
  if (draft.lang === "bn") {
    const mode = draft.onCredit ? "বাকি" : "নগদ";
    return `${draft.customerName}, ${toBnDigits(draft.qty)} ক্রেট ${draft.skuName}, ${toBnDigits(draft.amount)} টাকা ${mode} — ঠিক?`;
  }
  const mode = draft.onCredit ? "credit" : "cash";
  return `${draft.customerName}, ${draft.qty} crates of ${draft.skuName}, ${draft.amount} Taka ${mode} — correct?`;
}

export function parseConfirmReply(utterance: string): ConfirmReply {
  const text = utterance.trim().toLowerCase();
  const qtyMatch = utterance.match(/(\d+)\s*(ক্রেট|crate|crates)?/);
  let qty = qtyMatch ? Number(qtyMatch[1]) : undefined;
  const bnQty = utterance.match(/([০-৯]+)/);
  if (bnQty && qty === undefined) {
    qty = Number(bnQty[1].replace(/[০-৯]/g, (d) => String(BN.indexOf(d))));
  }
  const no = /(না|no|cancel|বাতিল)/.test(text);
  const yes = /(হ্যাঁ|ha|yes|thik|ঠিক|confirm)/.test(text);
  if (no && qty !== undefined) return { decision: "revise", qty };
  if (no) return { decision: "cancel" };
  if (yes) return { decision: "commit" };
  if (qty !== undefined) return { decision: "revise", qty };
  return { decision: "cancel" };
}
