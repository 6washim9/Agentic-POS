from app.domain.lot import LotReceipt, apply_lot_receipt, allocate_sale_from_lots


def test_lot_receipt_tracks_challan_and_unit_cost():
    lots = apply_lot_receipt(
        [],
        LotReceipt(
            sku_id="fuji",
            challan="CH-778",
            crates=100,
            unit_cost=510,
            received_at=1,
        ),
    )
    assert lots[0].challan == "CH-778"
    assert lots[0].remaining == 100
    assert lots[0].unit_cost == 510


def test_sales_allocate_fifo_across_lots():
    lots = apply_lot_receipt([], LotReceipt("fuji", "A", 40, 380, 1))
    lots = apply_lot_receipt(lots, LotReceipt("fuji", "B", 60, 510, 2))
    remaining, consumed = allocate_sale_from_lots(lots, "fuji", 50)
    assert consumed[0] == ("A", 40)
    assert consumed[1] == ("B", 10)
    assert sum(lot.remaining for lot in remaining if lot.sku_id == "fuji") == 50


def test_catalog_price_change_does_not_reprice_recorded_sale():
    from app.domain.catalog import apply_catalog, recorded_sale_total

    sale_total = recorded_sale_total(qty=10, unit_price_at_sale=500, new_catalog_price=550)
    assert sale_total == 5000
    catalog = apply_catalog({"fuji": 500}, {"fuji": 550}, version=2)
    assert catalog.version == 2
    assert catalog.prices["fuji"] == 550
