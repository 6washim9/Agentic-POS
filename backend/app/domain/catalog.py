from dataclasses import dataclass


@dataclass(frozen=True)
class Catalog:
    prices: dict[str, int]
    version: int


def recorded_sale_total(qty: int, unit_price_at_sale: int, new_catalog_price: int) -> int:
    _ = new_catalog_price
    return qty * unit_price_at_sale


def apply_catalog(current: dict[str, int], incoming: dict[str, int], version: int) -> Catalog:
    return Catalog(prices={**current, **incoming}, version=version)
