export type Role = "super_admin" | "owner" | "enterer";
export type Cell = "deny" | "confirm" | "allow";

export const CATALOG: readonly string[] = [
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
];

const RANK: Record<Cell, number> = { deny: 0, confirm: 1, allow: 2 };

export type Caps = Record<Role, Record<string, Cell>>;
export type Permissions = { caps: Caps; owner: Record<string, Cell>; occurredAt: number };

function fill(cell: Cell): Record<string, Cell> {
  return Object.fromEntries(CATALOG.map((key) => [key, cell]));
}

export function defaultCaps(): Caps {
  const super_admin = fill("allow");
  const owner = fill("allow");
  owner["screen.admin"] = "deny";
  const enterer = fill("allow");
  enterer["screen.settings"] = "deny";
  enterer["screen.admin"] = "deny";
  enterer["hitl.credit_override"] = "confirm";
  enterer["hitl.shift_close"] = "confirm";
  enterer["hitl.write_off"] = "confirm";
  enterer["hitl.advance"] = "confirm";
  return { super_admin, owner, enterer };
}

export function weaker(a: Cell, b: Cell): Cell {
  return RANK[a] <= RANK[b] ? a : b;
}

export function effective(
  caps: Caps,
  owner: Record<string, Cell>,
  role: Role,
  key: string,
): Cell {
  if (!CATALOG.includes(key)) {
    return "deny";
  }
  if (role === "enterer") {
    const cap = caps.enterer?.[key] ?? "deny";
    const override = owner[key];
    if (override === undefined) {
      return cap;
    }
    return weaker(cap, override);
  }
  return caps[role]?.[key] ?? "deny";
}

export function clipOwner(
  capsEnterer: Record<string, Cell>,
  owner: Record<string, Cell>,
): Record<string, Cell> {
  const clipped: Record<string, Cell> = {};
  for (const [key, cell] of Object.entries(owner)) {
    const cap = capsEnterer[key] ?? "deny";
    clipped[key] = weaker(cap, cell);
  }
  return clipped;
}

export function forceSuperAdminAdmin(caps: Caps): Caps {
  const next: Caps = {
    super_admin: { ...caps.super_admin },
    owner: { ...caps.owner },
    enterer: { ...caps.enterer },
  };
  next.super_admin["screen.admin"] = "allow";
  return next;
}

export function cellOf(
  caps: Caps,
  owner: Record<string, Cell>,
  role: Role,
  key: string,
): Cell {
  return effective(caps, owner, role, key);
}

export function can(
  caps: Caps,
  owner: Record<string, Cell>,
  role: Role,
  key: string,
): boolean {
  return cellOf(caps, owner, role, key) !== "deny";
}

const SCREEN_IDS = [
  "home",
  "catalog",
  "sale",
  "ledger",
  "warehouse",
  "landed",
  "spoilage",
  "receipt",
  "shift",
  "settings",
  "admin",
] as const;

export function visibleScreens(
  role: Role,
  caps: Caps,
  owner: Record<string, Cell>,
): string[] {
  return SCREEN_IDS.filter((id) => can(caps, owner, role, `screen.${id}`));
}

export function voiceKey(
  intent: string,
): "agent.sale" | "agent.spoilage" | "agent.reminder" | "agent.collection" | "agent.confirm_reply" | null {
  if (intent === "sale") return "agent.sale";
  if (intent === "spoilage") return "agent.spoilage";
  if (intent === "debt_reminder") return "agent.reminder";
  if (intent === "payment") return "agent.collection";
  if (intent === "confirm") return "agent.confirm_reply";
  return null;
}

export function backfillCaps(caps: Caps): Caps {
  const defaults = defaultCaps();
  const roles: Role[] = ["super_admin", "owner", "enterer"];
  const next = {} as Caps;
  for (const role of roles) {
    next[role] = { ...defaults[role], ...(caps?.[role] ?? {}) };
  }
  return next;
}

export function defaultPermissions(): Permissions {
  return { caps: defaultCaps(), owner: {}, occurredAt: 0 };
}
