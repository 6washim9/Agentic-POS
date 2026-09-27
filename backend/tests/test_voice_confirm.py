from app.domain.voice_confirm import (
    ConfirmDraft,
    build_confirm_prompt,
    parse_confirm_reply,
)


def test_builds_bangla_confirm_prompt_before_commit():
    prompt = build_confirm_prompt(
        ConfirmDraft(
            intent="sale",
            customer_name="রহিম আড়তদার",
            sku_name="ফুজি আপেল",
            qty=100,
            amount=50000,
            on_credit=True,
            lang="bn",
        )
    )
    assert "রহিম" in prompt
    assert "১০০" in prompt or "100" in prompt
    assert "বাকি" in prompt
    assert "ঠিক" in prompt


def test_yes_commits_and_no_cancels():
    assert parse_confirm_reply("হ্যাঁ").decision == "commit"
    assert parse_confirm_reply("thik").decision == "commit"
    assert parse_confirm_reply("না").decision == "cancel"
    assert parse_confirm_reply("no").decision == "cancel"


def test_qty_revision_keeps_draft_open():
    result = parse_confirm_reply("না, ৮০ ক্রেট")
    assert result.decision == "revise"
    assert result.qty == 80
