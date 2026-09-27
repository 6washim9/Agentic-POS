import pytest

from app.domain.collection import apply_collection, derive_khata


def test_collection_reduces_balance():
    result = apply_collection(150000, 50000)
    assert result.new_balance == 100000
    assert result.is_advance is False
    assert result.advance_delta == 0


def test_exact_settle_to_zero_is_not_advance():
    result = apply_collection(3000, 3000)
    assert result.new_balance == 0
    assert result.is_advance is False


def test_overpay_without_override_raises():
    with pytest.raises(ValueError, match="advance exceeds dues"):
        apply_collection(3000, 5000)


def test_overpay_with_override_goes_negative():
    result = apply_collection(3000, 5000, confirm_override=True)
    assert result.new_balance == -2000
    assert result.is_advance is True
    assert result.advance_delta == 2000


def test_non_positive_amount_rejected():
    with pytest.raises(ValueError, match="amount must be positive"):
        apply_collection(3000, 0)
    with pytest.raises(ValueError, match="amount must be positive"):
        apply_collection(3000, -100)


def test_collecting_against_negative_balance_requires_override():
    with pytest.raises(ValueError, match="advance exceeds dues"):
        apply_collection(-2000, 500)
    result = apply_collection(-2000, 500, confirm_override=True)
    assert result.new_balance == -2500
    assert result.is_advance is True


def test_khata_debits_only_the_sale_remainder():
    khata = derive_khata(
        600,
        sales=[
            {"id": "s1", "amount": 1000, "cash_paid": 400, "on_credit": True, "created_at": "2026-09-15T10:00:00"},
            {"id": "s2", "amount": 800, "cash_paid": 800, "on_credit": False, "created_at": "2026-09-15T11:00:00"},
        ],
        collections=[],
    )
    sale_lines = [line for line in khata.lines if line.kind == "sale"]
    assert len(sale_lines) == 1
    assert sale_lines[0].amount == 600


def test_khata_opening_is_the_seed_balance():
    khata = derive_khata(150000, sales=[], collections=[])
    assert khata.opening == 150000
    assert khata.lines == []
    assert khata.balance == 150000


def test_khata_running_balance_ends_at_credit_balance():
    khata = derive_khata(
        5300,
        sales=[
            {"id": "s1", "amount": 1000, "cash_paid": 400, "on_credit": True, "created_at": "2026-09-15T10:00:00"},
            {"id": "s2", "amount": 5000, "cash_paid": 0, "on_credit": True, "created_at": "2026-09-15T12:00:00"},
        ],
        collections=[
            {"id": "c1", "amount": 300, "is_advance": False, "created_at": "2026-09-15T11:00:00"},
        ],
    )
    assert [line.kind for line in khata.lines] == ["sale", "collection", "sale"]
    assert khata.lines[0].balance == 600
    assert khata.lines[1].balance == 300
    assert khata.lines[2].balance == 5300
    assert khata.balance == 5300


def test_khata_marks_advance_collection():
    khata = derive_khata(
        -2000,
        sales=[],
        collections=[
            {"id": "c1", "amount": 5000, "is_advance": True, "created_at": "2026-09-15T10:00:00"},
        ],
    )
    assert khata.lines[0].is_advance is True
    assert khata.lines[0].balance == -2000
