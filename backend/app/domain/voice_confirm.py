from dataclasses import dataclass
import re

BN_DIGITS = str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯")


@dataclass(frozen=True)
class ConfirmDraft:
    intent: str
    customer_name: str
    sku_name: str
    qty: int
    amount: int
    on_credit: bool
    lang: str = "bn"


@dataclass(frozen=True)
class ConfirmReply:
    decision: str
    qty: int | None = None


def build_confirm_prompt(draft: ConfirmDraft) -> str:
    qty = str(draft.qty)
    amount = str(draft.amount)
    if draft.lang == "bn":
        qty_bn = qty.translate(BN_DIGITS)
        amount_bn = amount.translate(BN_DIGITS)
        mode = "বাকি" if draft.on_credit else "নগদ"
        return (
            f"{draft.customer_name}, {qty_bn} ক্রেট {draft.sku_name}, "
            f"{amount_bn} টাকা {mode} — ঠিক?"
        )
    mode = "credit" if draft.on_credit else "cash"
    return (
        f"{draft.customer_name}, {qty} crates of {draft.sku_name}, "
        f"{amount} Taka {mode} — correct?"
    )


def parse_confirm_reply(utterance: str) -> ConfirmReply:
    text = utterance.strip().lower()
    qty_match = re.search(r"(\d+)\s*(ক্রেট|crate|crates)?", utterance)
    qty = int(qty_match.group(1)) if qty_match else None
    bn_qty = re.search(r"([০-৯]+)", utterance)
    if bn_qty and qty is None:
        qty = int(bn_qty.group(1).translate(str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")))
    no = any(token in text for token in ("না", "no", "cancel", "বাতিল"))
    yes = any(token in text for token in ("হ্যাঁ", "ha", "yes", "thik", "ঠিক", "confirm"))
    if no and qty is not None:
        return ConfirmReply(decision="revise", qty=qty)
    if no:
        return ConfirmReply(decision="cancel")
    if yes:
        return ConfirmReply(decision="commit")
    if qty is not None:
        return ConfirmReply(decision="revise", qty=qty)
    return ConfirmReply(decision="cancel")
