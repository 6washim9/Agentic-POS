import { describe, expect, it } from "vitest";
import {
  duesShare,
  formatTaka,
  paymentMethod,
  paymentStatus,
  recentSales,
  saleDue,
  salePaid,
  salesByDay,
  topProducts,
} from "./dashboard";
import type { Sale } from "../store/types";

function sale(partial: Partial<Sale> & Pick<Sale, "id">): Sale {
  return {
    sku_id: "fuji",
    sku_name: "Fuji Apples",
    customer_id: "rahim",
    customer_name: "Rahim",
    qty: 1,
    crates_returned: 0,
    amount: 1000,
    cash_paid: 1000,
    on_credit: false,
    created_at: "2026-09-21T10:00:00",
    receipt: "",
    ...partial,
  };
}

describe("salePaid / saleDue / paymentStatus", () => {
  it("marks a fully paid cash sale as paid", () => {
    const s = sale({ id: "1", amount: 900, cash_paid: 900, on_credit: false });
    expect(salePaid(s)).toBe(900);
    expect(saleDue(s)).toBe(0);
    expect(paymentStatus(s)).toBe("paid");
    expect(paymentMethod(s)).toBe("cash");
  });

  it("marks a credit sale with no cash as due", () => {
    const s = sale({ id: "2", amount: 4400, cash_paid: 0, on_credit: true });
    expect(saleDue(s)).toBe(4400);
    expect(paymentStatus(s)).toBe("due");
    expect(paymentMethod(s)).toBe("baki");
  });

  it("marks split tender as partial", () => {
    const s = sale({ id: "3", amount: 1000, cash_paid: 400, on_credit: true });
    expect(salePaid(s)).toBe(400);
    expect(saleDue(s)).toBe(600);
    expect(paymentStatus(s)).toBe("partial");
    expect(paymentMethod(s)).toBe("split");
  });
});

describe("recentSales", () => {
  it("returns newest first and respects the limit", () => {
    const rows = recentSales(
      [
        sale({ id: "a", created_at: "2026-09-20T08:00:00" }),
        sale({ id: "b", created_at: "2026-09-22T08:14:00" }),
        sale({ id: "c", created_at: "2026-09-21T10:01:00" }),
      ],
      2,
    );
    expect(rows.map((row) => row.id)).toEqual(["b", "c"]);
  });
});

describe("salesByDay", () => {
  it("buckets amounts into the last N calendar days ending at asOf", () => {
    const buckets = salesByDay(
      [
        sale({ id: "1", amount: 90, created_at: "2026-09-22T08:14:00" }),
        sale({ id: "2", amount: 4400, created_at: "2026-09-22T10:01:00" }),
        sale({ id: "3", amount: 741, created_at: "2026-09-21T15:02:00" }),
      ],
      3,
      new Date("2026-09-22T23:00:00"),
    );
    expect(buckets.map((b) => b.total)).toEqual([0, 741, 4490]);
    expect(buckets[2].date).toBe("2026-09-22");
  });
});

describe("topProducts", () => {
  it("ranks SKUs by amount descending", () => {
    const ranked = topProducts([
      sale({ id: "1", sku_id: "fuji", sku_name: "Fuji", qty: 2, amount: 1000 }),
      sale({ id: "2", sku_id: "mango", sku_name: "Mango", qty: 1, amount: 1200 }),
      sale({ id: "3", sku_id: "fuji", sku_name: "Fuji", qty: 1, amount: 500 }),
    ]);
    expect(ranked[0]).toMatchObject({ skuId: "fuji", qty: 3, amount: 1500 });
    expect(ranked[1]).toMatchObject({ skuId: "mango", qty: 1, amount: 1200 });
  });
});

describe("formatTaka / duesShare", () => {
  it("formats taka with a grouping separator", () => {
    expect(formatTaka(4400)).toBe("4,400");
    expect(formatTaka(90)).toBe("90");
  });

  it("returns zero shares when dues are empty", () => {
    expect(duesShare(0, 0)).toEqual({ due: 0, collected: 0 });
  });

  it("splits due vs collected as percents that sum to 100", () => {
    expect(duesShare(150000, 50000)).toEqual({ due: 75, collected: 25 });
  });
});
