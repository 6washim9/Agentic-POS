from app.domain.nlp import parse_voice_command


def test_parses_english_credit_sale_with_trade_jargon():
    result = parse_voice_command(
        "Sold 100 crates of Fuji Apples to Rahim Aratdar for 50000 Taka on credit."
    )
    assert result.intent == "sale"
    assert result.confidence >= 0.8
    assert result.entities["qty"] == 100
    assert result.entities["unit"] == "crate"
    assert "fuji" in result.entities["sku"].lower()
    assert "rahim" in result.entities["customer"].lower()
    assert result.entities["amount"] == 50000
    assert result.entities["on_credit"] is True


def test_parses_bangla_baki_and_gudam_jargon():
    result = parse_voice_command("Rahim ke 50 crate am baki dilam")
    assert result.intent == "sale"
    assert result.entities["on_credit"] is True
    assert result.entities["qty"] == 50


def test_low_confidence_falls_back_below_eighty():
    result = parse_voice_command("hmm maybe something later")
    assert result.confidence < 0.8
    assert result.needs_fallback is True


def test_parses_spoilage_logging():
    result = parse_voice_command("Log 8 crates of mango as spoilage grade C")
    assert result.intent == "spoilage"
    assert result.entities["qty"] == 8
    assert result.entities["grade"] == "C"
