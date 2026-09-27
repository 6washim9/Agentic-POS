from app.domain.rbac import (
    clip_owner,
    default_caps,
    effective,
    force_super_admin_admin,
    owner_exceeds_cap,
    validate_keys,
    weaker,
)


def test_weaker_prefers_deny():
    assert weaker("allow", "deny") == "deny"
    assert weaker("confirm", "allow") == "confirm"


def test_enterer_uses_min_of_cap_and_owner_override():
    caps = default_caps()
    caps["enterer"]["screen.warehouse"] = "allow"
    owner = {"screen.warehouse": "deny"}
    assert effective(caps, owner, "enterer", "screen.warehouse") == "deny"


def test_missing_key_is_deny():
    caps = default_caps()
    assert effective(caps, {}, "enterer", "screen.unknown") == "deny"


def test_owner_allow_is_clipped_to_confirm_cap():
    cap = {"hitl.credit_override": "confirm"}
    owner = {"hitl.credit_override": "allow"}
    clipped = clip_owner(cap, owner)
    assert clipped["hitl.credit_override"] == "confirm"


def test_owner_exceeds_cap_detected():
    cap = {"hitl.credit_override": "confirm"}
    owner = {"hitl.credit_override": "allow"}
    assert owner_exceeds_cap(cap, owner) == "hitl.credit_override"


def test_super_admin_screen_admin_forced_allow():
    caps = default_caps()
    caps["super_admin"]["screen.admin"] = "deny"
    forced = force_super_admin_admin(caps)
    assert forced["super_admin"]["screen.admin"] == "allow"


def test_unknown_key_rejected():
    assert validate_keys({"not.a.key": "allow"}) == "UNKNOWN_KEY"
    assert validate_keys({"screen.sale": "allow"}) is None


def test_enterer_defaults():
    caps = default_caps()
    assert caps["enterer"]["screen.settings"] == "deny"
    assert caps["enterer"]["screen.admin"] == "deny"
    assert caps["enterer"]["agent.sale"] == "allow"
    assert caps["enterer"]["hitl.credit_override"] == "confirm"
    assert caps["owner"]["screen.admin"] == "deny"
    assert caps["super_admin"]["screen.admin"] == "allow"


def test_collection_keys_are_in_catalog():
    from app.domain.rbac import CATALOG

    assert "agent.collection" in CATALOG
    assert "hitl.advance" in CATALOG


def test_collection_defaults():
    caps = default_caps()
    assert caps["super_admin"]["agent.collection"] == "allow"
    assert caps["owner"]["agent.collection"] == "allow"
    assert caps["enterer"]["agent.collection"] == "allow"
    assert caps["enterer"]["hitl.advance"] == "confirm"
    assert caps["owner"]["hitl.advance"] == "allow"


def test_unknown_collection_key_still_denies():
    caps = default_caps()
    assert effective(caps, {}, "enterer", "agent.nope") == "deny"
