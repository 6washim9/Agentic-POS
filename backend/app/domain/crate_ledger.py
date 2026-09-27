from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class DualAssetSale:
    product_stock_before: int
    crate_balance_before: int
    crates_sold: int
    crates_returned: int
    unit_price: Decimal
    on_credit: bool


@dataclass(frozen=True)
class DualAssetResult:
    product_stock_after: int
    crate_balance_after: int
    sale_amount: Decimal
    credit_delta: Decimal


def apply_dual_asset_sale(sale: DualAssetSale) -> DualAssetResult:
    if sale.crates_sold < 0 or sale.crates_returned < 0:
        raise ValueError("crate quantities cannot be negative")
    if sale.crates_sold > sale.product_stock_before:
        raise ValueError("insufficient stock for this sale")
    amount = sale.unit_price * Decimal(sale.crates_sold)
    return DualAssetResult(
        product_stock_after=sale.product_stock_before - sale.crates_sold,
        crate_balance_after=sale.crate_balance_before + sale.crates_sold - sale.crates_returned,
        sale_amount=amount,
        credit_delta=amount if sale.on_credit else Decimal("0"),
    )
