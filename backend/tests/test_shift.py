from app.domain.shift import SaleLine, close_shift, open_shift


def test_open_shift_records_float():
    shift = open_shift(cashier="Karim", float_amount=5000, opened_at=1000)
    assert shift.status == "open"
    assert shift.float_amount == 5000
    assert shift.cashier == "Karim"


def test_z_report_matches_cash_collected_not_list_price():
    shift = open_shift(cashier="Karim", float_amount=2000, opened_at=1)
    closed = close_shift(
        shift,
        sales=[
            SaleLine(amount=1000, cash_paid=400, on_credit=True, recorded_price=500),
            SaleLine(amount=800, cash_paid=800, on_credit=False, recorded_price=800),
        ],
        closed_at=2,
    )
    assert closed.cash_collected == 1200
    assert closed.credit_issued == 600
    assert closed.z_total == 1800
    assert closed.status == "closed"
    assert closed.expected_drawer == 3200


def test_collection_cash_joins_drawer():
    shift = open_shift(cashier="Karim", float_amount=2000, opened_at=1)
    closed = close_shift(
        shift,
        sales=[SaleLine(amount=1000, cash_paid=400, on_credit=True, recorded_price=1000)],
        closed_at=2,
        collections=[5000, 2000],
    )
    assert closed.collection_cash == 7000
    assert closed.cash_collected == 7400
    assert closed.expected_drawer == 9400
    assert closed.z_total == 1000
    assert closed.credit_issued == 600


def test_shift_without_collections_has_zero_collection_cash():
    shift = open_shift(cashier="Karim", float_amount=2000, opened_at=1)
    closed = close_shift(shift, sales=[], closed_at=2)
    assert closed.collection_cash == 0
    assert closed.expected_drawer == 2000
