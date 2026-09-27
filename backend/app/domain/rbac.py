from typing import Literal

Role = Literal["super_admin", "owner", "enterer"]
Cell = Literal["deny", "confirm", "allow"]

CATALOG: tuple[str, ...] = (
    "screen.home",
    "screen.catalog",
    "screen.sale",
    "screen.ledger",
    "screen.warehouse",
    "screen.landed",
    "screen.spoilage",
    "screen.receipt",
    "screen.shift",
    "screen.settings",
    "screen.admin",
    "agent.sale",
    "agent.spoilage",
    "agent.reminder",
    "agent.collection",
    "agent.confirm_reply",
    "hitl.credit_override",
    "hitl.advance",
    "hitl.shift_close",
    "hitl.write_off",
)

RANK = {"deny": 0, "confirm": 1, "allow": 2}


def weaker(a: Cell, b: Cell) -> Cell:
    return a if RANK[a] <= RANK[b] else b


def _fill(cell: Cell) -> dict[str, Cell]:
    return {key: cell for key in CATALOG}


def default_caps() -> dict[str, dict[str, Cell]]:
    super_admin = _fill("allow")
    owner = _fill("allow")
    owner["screen.admin"] = "deny"
    enterer = _fill("allow")
    enterer["screen.settings"] = "deny"
    enterer["screen.admin"] = "deny"
    enterer["hitl.credit_override"] = "confirm"
    enterer["hitl.shift_close"] = "confirm"
    enterer["hitl.write_off"] = "confirm"
    enterer["hitl.advance"] = "confirm"
    return {"super_admin": super_admin, "owner": owner, "enterer": enterer}


def effective(
    caps: dict[str, dict[str, Cell]],
    owner_overrides: dict[str, Cell],
    role: str,
    key: str,
) -> Cell:
    if key not in CATALOG:
        return "deny"
    if role == "enterer":
        cap = caps.get("enterer", {}).get(key, "deny")
        override = owner_overrides.get(key)
        if override is None:
            return cap
        return weaker(cap, override)
    return caps.get(role, {}).get(key, "deny")


def clip_owner(caps_enterer: dict[str, Cell], owner_overrides: dict[str, Cell]) -> dict[str, Cell]:
    clipped: dict[str, Cell] = {}
    for key, cell in owner_overrides.items():
        cap = caps_enterer.get(key, "deny")
        clipped[key] = weaker(cap, cell)
    return clipped


def force_super_admin_admin(caps: dict[str, dict[str, Cell]]) -> dict[str, dict[str, Cell]]:
    next_caps = {role: dict(cells) for role, cells in caps.items()}
    next_caps.setdefault("super_admin", {})["screen.admin"] = "allow"
    return next_caps


def validate_keys(mapping: dict[str, Cell]) -> str | None:
    for key in mapping:
        if key not in CATALOG:
            return "UNKNOWN_KEY"
    return None


def owner_exceeds_cap(caps_enterer: dict[str, Cell], owner_overrides: dict[str, Cell]) -> str | None:
    for key, cell in owner_overrides.items():
        cap = caps_enterer.get(key, "deny")
        if RANK[cell] > RANK[cap]:
            return key
    return None
