from dataclasses import dataclass


@dataclass(frozen=True)
class LotReceipt:
    sku_id: str
    challan: str
    crates: int
    unit_cost: float
    received_at: int


@dataclass
class Lot:
    sku_id: str
    challan: str
    remaining: int
    unit_cost: float
    received_at: int


def apply_lot_receipt(lots: list[Lot], receipt: LotReceipt) -> list[Lot]:
    if receipt.crates <= 0:
        raise ValueError("crates must be greater than zero")
    next_lots = list(lots)
    next_lots.append(
        Lot(
            sku_id=receipt.sku_id,
            challan=receipt.challan,
            remaining=receipt.crates,
            unit_cost=receipt.unit_cost,
            received_at=receipt.received_at,
        )
    )
    return next_lots


def allocate_sale_from_lots(lots: list[Lot], sku_id: str, qty: int) -> tuple[list[Lot], list[tuple[str, int]]]:
    remaining_need = qty
    consumed: list[tuple[str, int]] = []
    next_lots: list[Lot] = []
    for lot in sorted(lots, key=lambda item: (item.sku_id != sku_id, item.received_at)):
        if lot.sku_id != sku_id or remaining_need <= 0:
            next_lots.append(lot)
            continue
        take = min(lot.remaining, remaining_need)
        consumed.append((lot.challan, take))
        leftover = lot.remaining - take
        remaining_need -= take
        if leftover > 0:
            next_lots.append(Lot(lot.sku_id, lot.challan, leftover, lot.unit_cost, lot.received_at))
    if remaining_need > 0:
        raise ValueError("insufficient lot stock")
    return next_lots, consumed
