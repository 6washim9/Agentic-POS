from dataclasses import dataclass, field
import re
from typing import Any


TRADE_TERMS = {
    "arat": "wholesale_yard",
    "aratdar": "wholesaler",
    "mahajon": "financier",
    "crate": "crate",
    "challan": "dispatch_note",
    "baki": "credit",
    "gudam": "warehouse",
}

SKU_ALIASES = {
    "fuji": "Fuji Apples",
    "apple": "Fuji Apples",
    "am": "Mango",
    "mango": "Mango",
    "kola": "Banana",
    "banana": "Banana",
    "komola": "Orange",
    "orange": "Orange",
    "angur": "Grapes",
    "grape": "Grapes",
}


@dataclass
class VoiceParseResult:
    intent: str
    confidence: float
    entities: dict[str, Any] = field(default_factory=dict)
    needs_fallback: bool = False
    original: str = ""


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def parse_voice_command(utterance: str) -> VoiceParseResult:
    original = utterance
    text = _normalize(utterance)
    entities: dict[str, Any] = {}

    qty_match = re.search(r"(\d+)\s*(crates?|box(?:es)?)", text)
    if not qty_match:
        qty_match = re.search(r"(\d+)\s+(?:crate|box)", text)
    if qty_match:
        entities["qty"] = int(qty_match.group(1))
        unit_raw = qty_match.group(2) if qty_match.lastindex and qty_match.group(2) else "crate"
        entities["unit"] = "crate" if "crate" in unit_raw else "box"

    amount_match = re.search(
        r"(?:for|taka|tk|bdt)\s*(\d[\d,]*)|(\d[\d,]*)\s*(?:taka|tk|bdt)",
        text,
    )
    if amount_match:
        raw = (amount_match.group(1) or amount_match.group(2) or "0").replace(",", "")
        entities["amount"] = int(raw)

    for alias, sku in SKU_ALIASES.items():
        if alias in text:
            entities["sku"] = sku
            break

    customer_match = re.search(r"(?:to|ke)\s+([a-z]+)", text)
    if customer_match:
        entities["customer"] = customer_match.group(1).title()
    elif "rahim" in text:
        entities["customer"] = "Rahim"

    on_credit = any(term in text for term in ("credit", "baki", "udhar"))
    if on_credit:
        entities["on_credit"] = True
    elif any(term in text for term in ("cash", "nogod", "paid")):
        entities["on_credit"] = False

    grade_match = re.search(r"grade\s*([abc])", text)
    if grade_match:
        entities["grade"] = grade_match.group(1).upper()

    intent = "unknown"
    confidence = 0.35
    if any(w in text for w in ("sold", "sale", "dilam", "bikri", "sell")):
        intent = "sale"
        confidence = 0.92 if entities.get("qty") else 0.72
    elif any(w in text for w in ("spoil", "wastage", "noshto", "rotten")):
        intent = "spoilage"
        confidence = 0.9 if entities.get("qty") else 0.7
        entities.setdefault("grade", "C")
    elif any(w in text for w in ("remind", "reminder", "sms", "whatsapp")):
        intent = "debt_reminder"
        confidence = 0.88
    elif any(w in text for w in ("receive", "payment", "joma")):
        intent = "payment"
        confidence = 0.9
    elif any(w in text for w in ("warehouse", "gudam", "cold")):
        intent = "warehouse_move"
        confidence = 0.85

    needs_fallback = confidence < 0.8
    return VoiceParseResult(
        intent=intent,
        confidence=confidence,
        entities=entities,
        needs_fallback=needs_fallback,
        original=original,
    )
