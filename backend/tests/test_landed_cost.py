from decimal import Decimal

from app.domain.landed_cost import LandedCostInput, compute_landed_cost


def test_aggregates_procurement_duties_freight_and_clearance():
    result = compute_landed_cost(
        LandedCostInput(
            crates=100,
            base_procurement=Decimal("40000"),
            customs_duty=Decimal("5000"),
            freight=Decimal("3000"),
            port_clearance=Decimal("2000"),
            transport=Decimal("1000"),
        )
    )
    assert result.total_landed == Decimal("51000")
    assert result.unit_cost_per_crate == Decimal("510.00")


def test_raises_when_crate_count_is_zero():
    try:
        compute_landed_cost(
            LandedCostInput(
                crates=0,
                base_procurement=Decimal("1000"),
                customs_duty=Decimal("0"),
                freight=Decimal("0"),
                port_clearance=Decimal("0"),
                transport=Decimal("0"),
            )
        )
    except ValueError as exc:
        assert "crates" in str(exc).lower()
    else:
        raise AssertionError("expected ValueError")


def test_rejects_negative_cost_components():
    try:
        compute_landed_cost(
            LandedCostInput(
                crates=10,
                base_procurement=Decimal("-1"),
                customs_duty=Decimal("0"),
                freight=Decimal("0"),
                port_clearance=Decimal("0"),
                transport=Decimal("0"),
            )
        )
    except ValueError as exc:
        assert "negative" in str(exc).lower()
    else:
        raise AssertionError("expected ValueError")
