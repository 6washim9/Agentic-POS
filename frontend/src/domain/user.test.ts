import { describe, expect, it } from "vitest";
import { createUser, type ShopUser } from "./user";

const now = "2026-09-22T10:00:00.000Z";

const seed: ShopUser[] = [
  {
    id: "user-enterer",
    prefix: "mr",
    first_name: "Enterer",
    email: "enterer@arat.local",
    active: true,
    role: "enterer",
    created_at: now,
  },
];

describe("createUser", () => {
  it("returns a trimmed active user without mutating existing", () => {
    const copy = [...seed];
    const user = createUser(
      copy,
      { prefix: "mrs", first_name: "  Salma  ", email: "  salma@arat.local  ", role: "owner" },
      now,
      "u-1",
    );
    expect(user).toMatchObject({
      id: "u-1",
      prefix: "mrs",
      first_name: "Salma",
      email: "salma@arat.local",
      active: true,
      role: "owner",
      created_at: now,
    });
    expect(copy).toHaveLength(1);
  });

  it("rejects empty name or email", () => {
    expect(() => createUser(seed, { prefix: "mr", first_name: "  ", email: "a@b.c", role: "enterer" }, now)).toThrow(
      "name and email required",
    );
    expect(() => createUser(seed, { prefix: "mr", first_name: "A", email: "  ", role: "enterer" }, now)).toThrow(
      "name and email required",
    );
  });

  it("rejects an email without @", () => {
    expect(() => createUser(seed, { prefix: "mr", first_name: "A", email: "not-an-email", role: "enterer" }, now)).toThrow(
      "invalid email",
    );
  });

  it("rejects a duplicate email case-insensitively", () => {
    expect(() =>
      createUser(seed, { prefix: "mr", first_name: "A", email: "ENTERER@arat.local", role: "owner" }, now),
    ).toThrow("email already exists");
  });

  it("rejects an invalid prefix or role", () => {
    expect(() =>
      createUser(seed, { prefix: "dr" as "mr", first_name: "A", email: "a@b.c", role: "enterer" }, now),
    ).toThrow("invalid prefix");
    expect(() =>
      createUser(seed, { prefix: "mr", first_name: "A", email: "a@b.c", role: "cashier" as "enterer" }, now),
    ).toThrow("invalid role");
  });
});
