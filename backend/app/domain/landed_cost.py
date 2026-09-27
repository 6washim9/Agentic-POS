from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP


@dataclass(frozen=True)
class LandedCostInput:
    crates: int
    base_procurement: Decimal
    customs_duty: Decimal
    freight: Decimal
    port_clearance: Decimal
    transport: Decimal


@dataclass(frozen=True)
class LandedCostResult:
    total_landed: Decimal
    unit_cost_per_crate: Decimal


def compute_landed_cost(payload: LandedCostInput) -> LandedCostResult:
    if payload.crates <= 0:
        raise ValueError("crates must be greater than zero")
    components = (
        payload.base_procurement,
        payload.customs_duty,
        payload.freight,
        payload.port_clearance,
        payload.transport,
    )
    if any(value < 0 for value in components):
        raise ValueError("negative cost components are not allowed")
    total = sum(components, Decimal("0"))
    unit = (total / Decimal(payload.crates)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return LandedCostResult(total_landed=total, unit_cost_per_crate=unit)
