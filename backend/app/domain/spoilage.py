from dataclasses import dataclass
from decimal import Decimal


GRADES = ("A", "B", "C")


@dataclass(frozen=True)
class SpoilageEntry:
    sku: str
    qty: int
    from_grade: str
    to_grade: str
    unit_cost: Decimal
    is_write_off: bool


@dataclass(frozen=True)
class SpoilageResult:
    pnl_loss: Decimal
    remaining_qty: int
    grade: str


def apply_spoilage(stock_qty: int, entry: SpoilageEntry) -> SpoilageResult:
    if entry.qty <= 0:
        raise ValueError("spoilage quantity must be positive")
    if entry.qty > stock_qty:
        raise ValueError("cannot spoil more than available stock")
    if entry.to_grade not in GRADES or entry.from_grade not in GRADES:
        raise ValueError("grade must be A, B, or C")
    loss = entry.unit_cost * Decimal(entry.qty) if entry.is_write_off else Decimal("0")
    remaining = stock_qty - entry.qty if entry.is_write_off else stock_qty
    return SpoilageResult(pnl_loss=loss, remaining_qty=remaining, grade=entry.to_grade)
