from dataclasses import dataclass


@dataclass(frozen=True)
class SaleLine:
    amount: int
    cash_paid: int
    on_credit: bool
    recorded_price: int


@dataclass(frozen=True)
class Shift:
    cashier: str
    float_amount: int
    opened_at: int
    status: str
    cash_collected: int = 0
    credit_issued: int = 0
    z_total: int = 0
    expected_drawer: int = 0
    collection_cash: int = 0
    closed_at: int | None = None


def open_shift(cashier: str, float_amount: int, opened_at: int) -> Shift:
    if float_amount < 0:
        raise ValueError("float cannot be negative")
    return Shift(cashier=cashier, float_amount=float_amount, opened_at=opened_at, status="open")


def close_shift(
    shift: Shift,
    sales: list[SaleLine],
    closed_at: int,
    collections: list[int] | None = None,
) -> Shift:
    collection_cash = sum(collections or [])
    cash = sum(line.cash_paid for line in sales) + collection_cash
    credit = sum(max(line.amount - line.cash_paid, 0) for line in sales)
    z_total = sum(line.amount for line in sales)
    return Shift(
        cashier=shift.cashier,
        float_amount=shift.float_amount,
        opened_at=shift.opened_at,
        status="closed",
        cash_collected=cash,
        credit_issued=credit,
        z_total=z_total,
        expected_drawer=shift.float_amount + cash,
        collection_cash=collection_cash,
        closed_at=closed_at,
    )
