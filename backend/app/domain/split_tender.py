from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class SplitTender:
    total: Decimal
    cash_paid: Decimal
    credit_limit: int
    current_credit: int


@dataclass(frozen=True)
class SplitResult:
    cash_paid: Decimal
    credit_delta: Decimal
    on_credit: bool


def apply_split_tender(payload: SplitTender) -> SplitResult:
    if payload.cash_paid < 0:
        raise ValueError("cash cannot be negative")
    if payload.cash_paid > payload.total:
        raise ValueError("cash exceeds sale total")
    credit = payload.total - payload.cash_paid
    projected = payload.current_credit + int(credit)
    if credit > 0 and projected > payload.credit_limit:
        raise ValueError("credit limit exceeded")
    return SplitResult(cash_paid=payload.cash_paid, credit_delta=credit, on_credit=credit > 0)
