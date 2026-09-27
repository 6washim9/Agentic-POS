from decimal import Decimal

from app.domain.spoilage import SpoilageEntry, apply_spoilage


def test_write_off_logs_loss_into_pnl():
    result = apply_spoilage(
        40,
        SpoilageEntry(
            sku="Mango",
            qty=8,
            from_grade="A",
            to_grade="C",
            unit_cost=Decimal("120"),
            is_write_off=True,
        ),
    )
    assert result.pnl_loss == Decimal("960")
    assert result.remaining_qty == 32
    assert result.grade == "C"


def test_regrade_without_write_off_keeps_stock():
    result = apply_spoilage(
        40,
        SpoilageEntry(
            sku="Mango",
            qty=10,
            from_grade="A",
            to_grade="B",
            unit_cost=Decimal("120"),
            is_write_off=False,
        ),
    )
    assert result.pnl_loss == Decimal("0")
    assert result.remaining_qty == 40
    assert result.grade == "B"
