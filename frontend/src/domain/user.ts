import type { Role } from "./rbac";

export type Prefix = "mr" | "mrs" | "miss";

export type ShopUser = {
  id: string;
  prefix: Prefix;
  first_name: string;
  email: string;
  active: boolean;
  role: Role;
  created_at: string;
};

export type UserDraft = {
  prefix: Prefix;
  first_name: string;
  email: string;
  active?: boolean;
  role: Role;
};

const PREFIXES: Prefix[] = ["mr", "mrs", "miss"];
const ROLES: Role[] = ["enterer", "owner", "super_admin"];

export function createUser(existing: ShopUser[], draft: UserDraft, now: string, id: string = crypto.randomUUID()): ShopUser {
  const first_name = draft.first_name.trim();
  const email = draft.email.trim();
  if (!first_name || !email) throw new Error("name and email required");
  if (!email.includes("@")) throw new Error("invalid email");
  if (!PREFIXES.includes(draft.prefix)) throw new Error("invalid prefix");
  if (!ROLES.includes(draft.role)) throw new Error("invalid role");
  if (existing.some((user) => user.email.toLowerCase() === email.toLowerCase())) {
    throw new Error("email already exists");
  }
  return {
    id,
    prefix: draft.prefix,
    first_name,
    email,
    active: draft.active ?? true,
    role: draft.role,
    created_at: now,
  };
}
