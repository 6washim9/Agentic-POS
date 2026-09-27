from decimal import Decimal

from app.domain.split_tender import SplitTender, apply_split_tender


def test_partial_cash_remainder_goes_to_baki():
    result = apply_split_tender(
        SplitTender(total=Decimal("50000"), cash_paid=Decimal("20000"), credit_limit=300000, current_credit=150000)
    )
    assert result.cash_paid == Decimal("20000")
    assert result.credit_delta == Decimal("30000")
    assert result.on_credit is True


def test_full_cash_has_zero_credit():
    result = apply_split_tender(
        SplitTender(total=Decimal("2000"), cash_paid=Decimal("2000"), credit_limit=80000, current_credit=0)
    )
    assert result.credit_delta == Decimal("0")
    assert result.on_credit is False


def test_overpay_is_rejected():
    try:
        apply_split_tender(
            SplitTender(total=Decimal("100"), cash_paid=Decimal("150"), credit_limit=1, current_credit=0)
        )
    except ValueError as exc:
        assert "cash" in str(exc).lower()
    else:
        raise AssertionError("expected ValueError")
