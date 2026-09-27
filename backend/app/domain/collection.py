from dataclasses import dataclass

from typing import Any


@dataclass(frozen=True)
class CollectionResult:
    new_balance: int
    is_advance: bool
    advance_delta: int


def apply_collection(
    current_balance: int,
    amount: int,
    confirm_override: bool = False,
) -> CollectionResult:
    if amount <= 0:
        raise ValueError("amount must be positive")
    if amount > current_balance and not confirm_override:
        raise ValueError("advance exceeds dues")
    new_balance = current_balance - amount
    return CollectionResult(
        new_balance=new_balance,
        is_advance=new_balance < 0,
        advance_delta=max(amount - current_balance, 0),
    )


@dataclass(frozen=True)
class KhataLine:
    id: str
    kind: str
    amount: int
    created_at: str
    is_advance: bool
    balance: int


@dataclass(frozen=True)
class Khata:
    opening: int
    lines: list[KhataLine]
    balance: int


def derive_khata(
    credit_balance: int,
    sales: list[dict[str, Any]],
    collections: list[dict[str, Any]],
) -> Khata:
    ledger: list[tuple[str, str, int, bool, str]] = []
    debits = 0
    credits = 0
    for sale in sales:
        paid = sale.get("cash_paid")
        if paid is None:
            paid = 0 if sale.get("on_credit") else sale["amount"]
        remainder = int(sale["amount"]) - int(paid)
        if remainder <= 0:
            continue
        debits += remainder
        ledger.append((str(sale["created_at"]), str(sale["id"]), remainder, False, "sale"))
    for collection in collections:
        amount = int(collection["amount"])
        credits += amount
        ledger.append(
            (
                str(collection["created_at"]),
                str(collection["id"]),
                -amount,
                bool(collection.get("is_advance")),
                "collection",
            )
        )
    opening = credit_balance - debits + credits
    ledger.sort(key=lambda row: (row[0], row[1]))
    lines: list[KhataLine] = []
    running = opening
    for created_at, line_id, delta, is_advance, kind in ledger:
        running += delta
        lines.append(
            KhataLine(
                id=line_id,
                kind=kind,
                amount=abs(delta),
                created_at=created_at,
                is_advance=is_advance,
                balance=running,
            )
        )
    return Khata(opening=opening, lines=lines, balance=running)
