from decimal import Decimal

from app.domain.crate_ledger import DualAssetSale, apply_dual_asset_sale


def test_atomically_tracks_product_volume_and_returnable_crates():
    result = apply_dual_asset_sale(
        DualAssetSale(
            product_stock_before=500,
            crate_balance_before=40,
            crates_sold=100,
            crates_returned=20,
            unit_price=Decimal("500"),
            on_credit=True,
        )
    )
    assert result.product_stock_after == 400
    assert result.crate_balance_after == 120
    assert result.sale_amount == Decimal("50000")
    assert result.credit_delta == Decimal("50000")


def test_cash_sale_does_not_increase_credit():
    result = apply_dual_asset_sale(
        DualAssetSale(
            product_stock_before=50,
            crate_balance_before=0,
            crates_sold=10,
            crates_returned=10,
            unit_price=Decimal("200"),
            on_credit=False,
        )
    )
    assert result.crate_balance_after == 0
    assert result.credit_delta == Decimal("0")
    assert result.sale_amount == Decimal("2000")


def test_rejects_oversell():
    try:
        apply_dual_asset_sale(
            DualAssetSale(
                product_stock_before=5,
                crate_balance_before=0,
                crates_sold=6,
                crates_returned=0,
                unit_price=Decimal("100"),
                on_credit=False,
            )
        )
    except ValueError as exc:
        assert "stock" in str(exc).lower()
    else:
        raise AssertionError("expected ValueError")
