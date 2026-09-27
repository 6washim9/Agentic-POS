from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.domain.collection import apply_collection
from app.domain.conflict import Event, resolve_events
from app.domain.crate_ledger import DualAssetSale, apply_dual_asset_sale
from app.domain.landed_cost import LandedCostInput, compute_landed_cost
from app.domain.lot import Lot, LotReceipt, allocate_sale_from_lots, apply_lot_receipt
from app.domain.nlp import parse_voice_command
from app.domain.outbox import OutboxItem, apply_idempotent_sync
from app.domain.rbac import clip_owner, default_caps, effective, force_super_admin_admin, owner_exceeds_cap, validate_keys
from app.domain.shift import SaleLine, close_shift, open_shift
from app.domain.spoilage import SpoilageEntry, apply_spoilage
from app.domain.split_tender import SplitResult, SplitTender, apply_split_tender
from app.domain.voice_confirm import ConfirmDraft, build_confirm_prompt, parse_confirm_reply

app = FastAPI(title="Arat POS", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SEED_SKUS = [
    {
        "id": "fuji",
        "name": "Fuji Apples",
        "name_bn": "ফুজি আপেল",
        "photo": "apple",
        "unit": "crate",
        "stock": 420,
        "grade": "A",
        "location": "cold",
        "unit_price": 500,
        "unit_cost": 380,
        "color": "yellow",
    },
    {
        "id": "mango",
        "name": "Himsagar Mango",
        "name_bn": "হিমসাগর আম",
        "photo": "mango",
        "unit": "crate",
        "stock": 180,
        "grade": "A",
        "location": "yard",
        "unit_price": 1200,
        "unit_cost": 900,
        "color": "green",
    },
    {
        "id": "banana",
        "name": "Sagor Banana",
        "name_bn": "সাগর কলা",
        "photo": "banana",
        "unit": "crate",
        "stock": 90,
        "grade": "B",
        "location": "gudam",
        "unit_price": 350,
        "unit_cost": 220,
        "color": "yellow",
    },
    {
        "id": "orange",
        "name": "Malta Orange",
        "name_bn": "মাল্টা কমলা",
        "photo": "orange",
        "unit": "crate",
        "stock": 24,
        "grade": "C",
        "location": "spoil",
        "unit_price": 280,
        "unit_cost": 210,
        "color": "orange",
    },
    {
        "id": "grape",
        "name": "Red Grapes",
        "name_bn": "লাল আঙ্গুর",
        "photo": "grape",
        "unit": "crate",
        "stock": 60,
        "grade": "A",
        "location": "cold",
        "unit_price": 900,
        "unit_cost": 640,
        "color": "yellow",
    },
    {
        "id": "pomegranate",
        "name": "Pomegranate",
        "name_bn": "ডালিম",
        "photo": "pomegranate",
        "unit": "crate",
        "stock": 48,
        "grade": "A",
        "location": "yard",
        "unit_price": 1100,
        "unit_cost": 780,
        "color": "green",
    },
]

SEED_CUSTOMERS = [
    {
        "id": "rahim",
        "name": "Rahim Aratdar",
        "name_bn": "রহিম আড়তদার",
        "phone": "+8801711000001",
        "credit_balance": 150000,
        "crate_balance": 40,
        "credit_limit": 300000,
    },
    {
        "id": "karim",
        "name": "Karim Mahajon",
        "name_bn": "করিম মহাজন",
        "phone": "+8801711000002",
        "credit_balance": 42000,
        "crate_balance": 12,
        "credit_limit": 120000,
    },
    {
        "id": "salma",
        "name": "Salma Traders",
        "name_bn": "সালমা ট্রেডার্স",
        "phone": "+8801711000003",
        "credit_balance": 0,
        "crate_balance": 0,
        "credit_limit": 80000,
    },
]


class Store:
    def __init__(self) -> None:
        self.skus = {item["id"]: dict(item) for item in SEED_SKUS}
        self.customers = {item["id"]: dict(item) for item in SEED_CUSTOMERS}
        self.events: list[Event] = []
        self.outbox: list[OutboxItem] = []
        self.sales: list[dict[str, Any]] = []
        self.reminders: list[dict[str, Any]] = []
        self.collections: list[dict[str, Any]] = []
        self.lots: list[Lot] = [
            Lot(sku_id="fuji", challan="CH-100", remaining=420, unit_cost=380, received_at=1),
            Lot(sku_id="mango", challan="CH-200", remaining=180, unit_cost=900, received_at=1),
            Lot(sku_id="banana", challan="CH-300", remaining=90, unit_cost=220, received_at=1),
            Lot(sku_id="orange", challan="CH-400", remaining=24, unit_cost=210, received_at=1),
            Lot(sku_id="grape", challan="CH-500", remaining=60, unit_cost=640, received_at=1),
            Lot(sku_id="pomegranate", challan="CH-600", remaining=48, unit_cost=780, received_at=1),
        ]
        self.shift = open_shift(cashier="Yard", float_amount=5000, opened_at=int(datetime.now(timezone.utc).timestamp() * 1000))
        self.config = {
            "language": "bn",
            "manage_crates": True,
            "extend_credit": True,
            "cold_storage": True,
            "shop_name": "Badamtoli Arat",
        }
        self.pnl = {"spoilage_loss": 0, "cash_in": 0, "credit_out": 0}
        self.permissions = {"caps": default_caps(), "owner": {}, "occurred_at": 0}

    def snapshot(self) -> dict[str, Any]:
        cash_today = sum(
            float(s.get("cash_paid", 0 if s["on_credit"] else s["amount"])) for s in self.sales
        ) + sum(float(c["amount"]) for c in self.collections)
        credit_today = sum(
            max(float(s["amount"]) - float(s.get("cash_paid", 0 if s["on_credit"] else s["amount"])), 0)
            for s in self.sales
        )
        dues = sum(c["credit_balance"] for c in self.customers.values())
        warehouse = sum(s["stock"] for s in self.skus.values() if s["location"] in ("cold", "gudam"))
        spoilage_qty = sum(s["stock"] for s in self.skus.values() if s["location"] == "spoil" or s["grade"] == "C")
        return {
            "config": self.config,
            "skus": list(self.skus.values()),
            "customers": list(self.customers.values()),
            "sales": self.sales[-20:],
            "reminders": self.reminders[-10:],
            "collections": self.collections[-50:],
            "kpis": {
                "cash_today": cash_today,
                "credit_today": credit_today,
                "outstanding_dues": dues,
                "warehouse_stock": warehouse,
                "spoilage_qty": spoilage_qty,
                "spoilage_loss": self.pnl["spoilage_loss"],
                "pending_events": 0,
            },
            "lots": [
                {
                    "sku_id": lot.sku_id,
                    "challan": lot.challan,
                    "remaining": lot.remaining,
                    "unit_cost": lot.unit_cost,
                    "received_at": lot.received_at,
                }
                for lot in self.lots
            ],
            "shift": {
                "cashier": self.shift.cashier,
                "float_amount": self.shift.float_amount,
                "status": self.shift.status,
                "cash_collected": self.shift.cash_collected,
                "credit_issued": self.shift.credit_issued,
                "z_total": self.shift.z_total,
                "expected_drawer": self.shift.expected_drawer,
                "collection_cash": self.shift.collection_cash,
            },
            "permissions": self.permissions,
        }


store = Store()


class VoiceIn(BaseModel):
    text: str
    lang: str = "bn"
    stage: str = "parse"


class ShiftOpenIn(BaseModel):
    cashier: str
    float_amount: float = 0


class LandedIn(BaseModel):
    sku_id: str
    crates: int
    base_procurement: float
    customs_duty: float = 0
    freight: float = 0
    port_clearance: float = 0
    transport: float = 0
    challan: str = "CH-NEW"


class SaleIn(BaseModel):
    sku_id: str
    customer_id: str
    crates_sold: int
    crates_returned: int = 0
    unit_price: float | None = None
    on_credit: bool = False
    cash_paid: float | None = None
    confirm_override: bool = False
    local_id: str | None = None


class SpoilageIn(BaseModel):
    sku_id: str
    qty: int
    to_grade: str = "C"
    write_off: bool = True


class ReminderIn(BaseModel):
    customer_id: str
    channel: str = Field(pattern="^(sms|whatsapp)$")


class CollectionIn(BaseModel):
    customer_id: str
    amount: int
    note: str | None = None
    confirm_override: bool = False
    local_id: str | None = None


class SyncIn(BaseModel):
    events: list[dict[str, Any]]


class ConfigIn(BaseModel):
    language: str | None = None
    manage_crates: bool | None = None
    extend_credit: bool | None = None
    cold_storage: bool | None = None
    shop_name: str | None = None


class ConfirmIn(BaseModel):
    action: str
    payload: dict[str, Any]
    confirmed: bool


class CapsIn(BaseModel):
    caps: dict[str, dict[str, str]]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def enqueue(entity_type: str, entity_id: str, action: str, payload: dict[str, Any]) -> Event:
    event = Event(
        event_id=str(uuid4()),
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        payload=payload,
        device_id="server",
        occurred_at=int(datetime.now(timezone.utc).timestamp() * 1000),
    )
    store.events.append(event)
    return event


def read_role(x_role: str | None = Header(default=None, alias="X-Role")) -> str:
    if x_role in ("super_admin", "owner", "enterer"):
        return x_role
    return "enterer"


def require_any(role: str, keys: list[str]) -> None:
    cells = [effective(store.permissions["caps"], store.permissions["owner"], role, key) for key in keys]
    if all(cell == "deny" for cell in cells):
        raise HTTPException(403, detail={"code": "FORBIDDEN", "key": keys[0]})


def cell_of(role: str, key: str) -> str:
    return effective(store.permissions["caps"], store.permissions["owner"], role, key)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/bootstrap")
def bootstrap() -> dict[str, Any]:
    return store.snapshot()


@app.get("/api/permissions")
def get_permissions() -> dict[str, Any]:
    return store.permissions


@app.put("/api/permissions/caps")
def put_caps(body: CapsIn, x_role: str | None = Header(default=None, alias="X-Role")) -> dict[str, Any]:
    role = x_role if x_role in ("super_admin", "owner", "enterer") else "enterer"
    if role != "super_admin":
        raise HTTPException(403, detail={"code": "FORBIDDEN", "key": "screen.admin"})
    flat = {k: v for cells in body.caps.values() for k, v in cells.items()}
    if validate_keys(flat):
        raise HTTPException(400, detail={"code": "UNKNOWN_KEY"})
    caps = force_super_admin_admin(body.caps)
    owner = clip_owner(caps["enterer"], store.permissions["owner"])
    store.permissions = {
        "caps": caps,
        "owner": owner,
        "occurred_at": int(datetime.now(timezone.utc).timestamp() * 1000),
    }
    return store.permissions


@app.put("/api/permissions/owner")
def put_owner(body: dict[str, str], x_role: str | None = Header(default=None, alias="X-Role")) -> dict[str, Any]:
    role = x_role if x_role in ("super_admin", "owner", "enterer") else "enterer"
    if role == "enterer":
        raise HTTPException(403, detail={"code": "FORBIDDEN", "key": "screen.settings"})
    if validate_keys(body):
        raise HTTPException(400, detail={"code": "UNKNOWN_KEY"})
    exceeded = owner_exceeds_cap(store.permissions["caps"]["enterer"], body)
    if exceeded:
        raise HTTPException(403, detail={"code": "CAP_EXCEEDED", "key": exceeded})
    store.permissions["owner"] = clip_owner(store.permissions["caps"]["enterer"], body)
    store.permissions["occurred_at"] = int(datetime.now(timezone.utc).timestamp() * 1000)
    return store.permissions


@app.post("/api/voice")
def voice(body: VoiceIn) -> dict[str, Any]:
    if body.stage == "confirm":
        reply = parse_confirm_reply(body.text)
        return {"stage": "confirm", "decision": reply.decision, "qty": reply.qty}
    parsed = parse_voice_command(body.text)
    return {
        "intent": parsed.intent,
        "confidence": parsed.confidence,
        "entities": parsed.entities,
        "needs_fallback": parsed.needs_fallback,
        "original": parsed.original,
        "stage": "parse",
    }


@app.post("/api/landed-cost")
def landed(body: LandedIn, role: str = Depends(read_role)) -> dict[str, Any]:
    require_any(role, ["screen.landed"])
    if body.sku_id not in store.skus:
        raise HTTPException(404, "SKU not found")
    result = compute_landed_cost(
        LandedCostInput(
            crates=body.crates,
            base_procurement=Decimal(str(body.base_procurement)),
            customs_duty=Decimal(str(body.customs_duty)),
            freight=Decimal(str(body.freight)),
            port_clearance=Decimal(str(body.port_clearance)),
            transport=Decimal(str(body.transport)),
        )
    )
    sku = store.skus[body.sku_id]
    sku["stock"] += body.crates
    sku["unit_cost"] = float(result.unit_cost_per_crate)
    sku["location"] = "cold" if store.config["cold_storage"] else "gudam"
    sku["color"] = "yellow"
    store.lots = apply_lot_receipt(
        store.lots,
        LotReceipt(
            sku_id=body.sku_id,
            challan=body.challan,
            crates=body.crates,
            unit_cost=float(result.unit_cost_per_crate),
            received_at=int(datetime.now(timezone.utc).timestamp() * 1000),
        ),
    )
    enqueue("lot", body.sku_id, "landed", {"crates": body.crates, "unit_cost": float(result.unit_cost_per_crate), "challan": body.challan})
    return {
        "total_landed": float(result.total_landed),
        "unit_cost_per_crate": float(result.unit_cost_per_crate),
        "sku": sku,
        "challan": body.challan,
    }


@app.post("/api/sales")
def create_sale(body: SaleIn, role: str = Depends(read_role)) -> dict[str, Any]:
    require_any(role, ["screen.sale", "agent.sale"])
    sku = store.skus.get(body.sku_id)
    customer = store.customers.get(body.customer_id)
    if not sku or not customer:
        raise HTTPException(404, "SKU or customer not found")
    price = Decimal(str(body.unit_price if body.unit_price is not None else sku["unit_price"]))
    total = float(price) * body.crates_sold
    cash_paid = body.cash_paid if body.cash_paid is not None else (0 if body.on_credit else total)
    projected_credit = customer["credit_balance"] + total - cash_paid
    if projected_credit > customer["credit_limit"] and cell_of(role, "hitl.credit_override") == "deny":
        raise HTTPException(403, detail={"code": "FORBIDDEN", "key": "hitl.credit_override"})
    try:
        split = apply_split_tender(
            SplitTender(
                total=Decimal(str(total)),
                cash_paid=Decimal(str(cash_paid)),
                credit_limit=customer["credit_limit"],
                current_credit=int(customer["credit_balance"]),
            )
        )
    except ValueError as exc:
        if "credit limit" in str(exc).lower():
            if not body.confirm_override:
                raise HTTPException(
                    409,
                    detail={
                        "code": "HITL_REQUIRED",
                        "reason": "credit_limit_override",
                        "projected": customer["credit_balance"] + total - cash_paid,
                        "limit": customer["credit_limit"],
                    },
                ) from exc
            split = SplitResult(
                cash_paid=Decimal(str(cash_paid)),
                credit_delta=Decimal(str(total - cash_paid)),
                on_credit=(total - cash_paid) > 0,
            )
        else:
            raise HTTPException(400, str(exc)) from exc
    projected_credit = customer["credit_balance"] + float(split.credit_delta)
    if split.on_credit and projected_credit > customer["credit_limit"] and not body.confirm_override:
        raise HTTPException(
            409,
            detail={
                "code": "HITL_REQUIRED",
                "reason": "credit_limit_override",
                "projected": projected_credit,
                "limit": customer["credit_limit"],
            },
        )
    try:
        result = apply_dual_asset_sale(
            DualAssetSale(
                product_stock_before=sku["stock"],
                crate_balance_before=customer["crate_balance"],
                crates_sold=body.crates_sold,
                crates_returned=body.crates_returned,
                unit_price=price,
                on_credit=split.on_credit,
            )
        )
        store.lots, consumed = allocate_sale_from_lots(store.lots, sku["id"], body.crates_sold)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    sku["stock"] = result.product_stock_after
    customer["crate_balance"] = result.crate_balance_after
    customer["credit_balance"] += float(split.credit_delta)
    if sku["stock"] <= 0:
        sku["color"] = "orange"
    elif sku["location"] in ("cold", "gudam"):
        sku["color"] = "yellow"
    else:
        sku["color"] = "green"
    sale_id = body.local_id or str(uuid4())
    sale = {
        "id": sale_id,
        "sku_id": sku["id"],
        "sku_name": sku["name"],
        "customer_id": customer["id"],
        "customer_name": customer["name"],
        "qty": body.crates_sold,
        "crates_returned": body.crates_returned,
        "amount": float(result.sale_amount),
        "cash_paid": float(split.cash_paid),
        "on_credit": split.on_credit,
        "lots": consumed,
        "created_at": now_iso(),
        "receipt": _receipt_text(sku, customer, body.crates_sold, float(result.sale_amount), split.on_credit),
    }
    store.sales.append(sale)
    enqueue("sale", sale["id"], "create", sale)
    tts = _sale_tts(sku, customer, body.crates_sold, float(result.sale_amount), split.on_credit)
    prompt = build_confirm_prompt(
        ConfirmDraft(
            intent="sale",
            customer_name=customer["name_bn"] if store.config["language"] == "bn" else customer["name"],
            sku_name=sku["name_bn"] if store.config["language"] == "bn" else sku["name"],
            qty=body.crates_sold,
            amount=int(result.sale_amount),
            on_credit=split.on_credit,
            lang=store.config["language"],
        )
    )
    return {"sale": sale, "sku": sku, "customer": customer, "tts": tts, "confirm_prompt": prompt}


@app.post("/api/spoilage")
def spoilage(body: SpoilageIn, role: str = Depends(read_role)) -> dict[str, Any]:
    require_any(role, ["screen.spoilage", "agent.spoilage"])
    if body.write_off and cell_of(role, "hitl.write_off") == "deny":
        raise HTTPException(403, detail={"code": "FORBIDDEN", "key": "hitl.write_off"})
    sku = store.skus.get(body.sku_id)
    if not sku:
        raise HTTPException(404, "SKU not found")
    try:
        result = apply_spoilage(
            sku["stock"],
            SpoilageEntry(
                sku=sku["name"],
                qty=body.qty,
                from_grade=sku["grade"],
                to_grade=body.to_grade,
                unit_cost=Decimal(str(sku["unit_cost"])),
                is_write_off=body.write_off,
            ),
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    sku["grade"] = result.grade
    sku["stock"] = result.remaining_qty
    if result.grade == "C" or body.write_off:
        sku["color"] = "orange"
        sku["location"] = "spoil"
    store.pnl["spoilage_loss"] += float(result.pnl_loss)
    enqueue("spoilage", sku["id"], "log", {"qty": body.qty, "grade": result.grade, "loss": float(result.pnl_loss)})
    tts_bn = f"সংরক্ষিত। {body.qty} ক্রেট {sku['name_bn']} গ্রেড {result.grade} হিসেবে লগ হয়েছে। ক্ষতি {int(result.pnl_loss)} টাকা।"
    tts_en = f"Saved. Logged {body.qty} crates of {sku['name']} as grade {result.grade}. Loss {int(result.pnl_loss)} Taka."
    return {"sku": sku, "pnl_loss": float(result.pnl_loss), "tts": {"bn": tts_bn, "en": tts_en}}


@app.post("/api/reminders")
def reminder(body: ReminderIn, role: str = Depends(read_role)) -> dict[str, Any]:
    require_any(role, ["agent.reminder", "screen.ledger"])
    customer = store.customers.get(body.customer_id)
    if not customer:
        raise HTTPException(404, "customer not found")
    if customer["credit_balance"] <= 0:
        raise HTTPException(400, "no outstanding balance")
    note = {
        "id": str(uuid4()),
        "customer_id": customer["id"],
        "channel": body.channel,
        "amount": customer["credit_balance"],
        "created_at": now_iso(),
        "audio_bn": f"{customer['name_bn']}, আপনার বাকি {int(customer['credit_balance'])} টাকা। অনুগ্রহ করে পরিশোধ করুন।",
        "audio_en": f"{customer['name']}, your outstanding baki is {int(customer['credit_balance'])} Taka. Please settle.",
        "status": "queued",
    }
    store.reminders.append(note)
    enqueue("reminder", note["id"], "queue", note)
    return note


@app.post("/api/collections")
def create_collection(body: CollectionIn, role: str = Depends(read_role)) -> dict[str, Any]:
    require_any(role, ["screen.ledger", "agent.collection"])
    customer = store.customers.get(body.customer_id)
    if not customer:
        raise HTTPException(404, "customer not found")
    current = int(customer["credit_balance"])
    if body.amount <= 0:
        raise HTTPException(400, detail={"code": "BAD_AMOUNT"})
    if body.amount > current and cell_of(role, "hitl.advance") == "deny":
        raise HTTPException(403, detail={"code": "FORBIDDEN", "key": "hitl.advance"})
    try:
        result = apply_collection(current, body.amount, body.confirm_override)
    except ValueError as exc:
        if "advance exceeds dues" in str(exc):
            raise HTTPException(
                409,
                detail={
                    "code": "HITL_REQUIRED",
                    "reason": "advance",
                    "projected": current - body.amount,
                    "current": current,
                },
            ) from exc
        raise HTTPException(400, detail={"code": "BAD_AMOUNT"}) from exc
    collection = {
        "id": body.local_id or str(uuid4()),
        "customer_id": customer["id"],
        "customer_name": customer["name"],
        "amount": body.amount,
        "note": body.note,
        "is_advance": result.is_advance,
        "created_at": now_iso(),
    }
    customer["credit_balance"] = result.new_balance
    store.collections.append(collection)
    enqueue("ledger", customer["id"], "payment", {"amount": body.amount})
    if result.is_advance:
        tts = {
            "bn": f"সংরক্ষিত। {customer['name_bn']} এর কাছে {body.amount} টাকা অগ্রিম জমা নেওয়া হয়েছে। ব্যালেন্স {result.new_balance} টাকা।",
            "en": f"Saved. Collected {body.amount} Taka advance from {customer['name']}. Balance {result.new_balance} Taka.",
        }
    else:
        tts = {
            "bn": f"সংরক্ষিত। {customer['name_bn']} এর কাছে {body.amount} টাকা জমা হয়েছে। বাকি {result.new_balance} টাকা।",
            "en": f"Saved. Collected {body.amount} Taka from {customer['name']}. Remaining {result.new_balance} Taka.",
        }
    return {"collection": collection, "customer": customer, "tts": tts}


@app.post("/api/sync")
def sync(body: SyncIn) -> dict[str, Any]:
    incoming_events = []
    incoming_outbox: list[OutboxItem] = []
    for item in body.events:
        local_id = str(item.get("event_id") or item.get("local_id") or uuid4())
        incoming_outbox.append(
            OutboxItem(
                local_id=local_id,
                entity_type=item["entity_type"],
                entity_id=item["entity_id"],
                action=item["action"],
                payload=item.get("payload", {}),
                device_id=item.get("device_id", "client"),
                occurred_at=int(item["occurred_at"]),
            )
        )
        incoming_events.append(
            Event(
                event_id=local_id,
                entity_type=item["entity_type"],
                entity_id=item["entity_id"],
                action=item["action"],
                payload=item.get("payload", {}),
                device_id=item.get("device_id", "client"),
                occurred_at=int(item["occurred_at"]),
            )
        )
    result = apply_idempotent_sync(store.outbox, incoming_outbox)
    store.outbox = result.store
    stock = {sku_id: sku["stock"] for sku_id, sku in store.skus.items()}
    accepted_ids = {ack.local_id for ack in result.accepted}
    accepted_events = [event for event in incoming_events if event.event_id in accepted_ids]
    merged = resolve_events([*store.events, *accepted_events], initial_stock=stock)
    store.events.extend(accepted_events)
    for key, value in merged.items():
        kind, entity_id = key.split(":", 1)
        if kind == "stock" and entity_id in store.skus and "qty" in value:
            store.skus[entity_id]["stock"] = value["qty"]
        if kind == "ledger" and entity_id in store.customers and "balance" in value:
            store.customers[entity_id]["credit_balance"] = value["balance"]
    return {
        "applied": len(result.accepted),
        "accepted": [{"local_id": ack.local_id, "remote_id": ack.remote_id, "duplicate": ack.duplicate} for ack in result.accepted],
        "rejected": [{"local_id": row.local_id, "reason": row.reason} for row in result.rejected],
        "state": store.snapshot(),
    }


@app.post("/api/shift/open")
def shift_open(body: ShiftOpenIn) -> dict[str, Any]:
    store.shift = open_shift(body.cashier, int(body.float_amount), int(datetime.now(timezone.utc).timestamp() * 1000))
    return store.snapshot()["shift"]


@app.post("/api/shift/close")
def shift_close(role: str = Depends(read_role)) -> dict[str, Any]:
    if cell_of(role, "screen.shift") == "deny":
        raise HTTPException(403, detail={"code": "FORBIDDEN", "key": "screen.shift"})
    if cell_of(role, "hitl.shift_close") == "deny":
        raise HTTPException(403, detail={"code": "FORBIDDEN", "key": "hitl.shift_close"})
    lines = [
        SaleLine(
            amount=int(sale["amount"]),
            cash_paid=int(sale.get("cash_paid", 0 if sale["on_credit"] else sale["amount"])),
            on_credit=bool(sale["on_credit"]),
            recorded_price=int(sale["amount"]),
        )
        for sale in store.sales
    ]
    store.shift = close_shift(
        store.shift,
        lines,
        int(datetime.now(timezone.utc).timestamp() * 1000),
        collections=[int(collection["amount"]) for collection in store.collections],
    )
    return store.snapshot()["shift"]


@app.post("/api/config")
def update_config(body: ConfigIn, role: str = Depends(read_role)) -> dict[str, Any]:
    require_any(role, ["screen.settings", "screen.admin"])
    data = body.model_dump(exclude_none=True)
    store.config.update(data)
    return store.config


@app.get("/api/receipt/{sale_id}")
def receipt(sale_id: str) -> dict[str, Any]:
    sale = next((s for s in store.sales if s["id"] == sale_id), None)
    if not sale:
        raise HTTPException(404, "receipt not found")
    return sale


def _receipt_text(sku: dict[str, Any], customer: dict[str, Any], qty: int, amount: float, on_credit: bool) -> str:
    mode = "BAKI / CREDIT" if on_credit else "CASH / নগদ"
    return (
        f"{store.config['shop_name']}\n"
        f"{customer['name']} ({customer['name_bn']})\n"
        f"{qty} crate {sku['name']}\n"
        f"{int(amount)} Taka  {mode}\n"
        f"{now_iso()}\n"
        "Thank you / ধন্যবাদ"
    )


def _sale_tts(sku: dict[str, Any], customer: dict[str, Any], qty: int, amount: float, on_credit: bool) -> dict[str, str]:
    if on_credit:
        bn = (
            f"সংরক্ষিত। {customer['name_bn']} এর খাতায় {qty} ক্রেট {sku['name_bn']} "
            f"এবং {int(amount)} টাকা বাকি যোগ হয়েছে। বর্তমান ব্যালেন্স {int(customer['credit_balance'])} টাকা।"
        )
        en = (
            f"Saved. Added {qty} crates of {sku['name']} and {int(amount)} Taka credit "
            f"to {customer['name']}'s ledger. Current balance is {int(customer['credit_balance'])} Taka."
        )
    else:
        bn = f"সংরক্ষিত। {qty} ক্রেট {sku['name_bn']} নগদ {int(amount)} টাকায় বিক্রি হয়েছে।"
        en = f"Saved. Sold {qty} crates of {sku['name']} for {int(amount)} Taka cash."
    return {"bn": bn, "en": en}
