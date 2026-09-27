import { describe, expect, it } from "vitest";
import { buildConfirmPrompt, parseConfirmReply } from "./voiceConfirm";

describe("voice confirm", () => {
  it("asks before committing a credit sale", () => {
    const prompt = buildConfirmPrompt({
      intent: "sale",
      customerName: "রহিম আড়তদার",
      skuName: "ফুজি আপেল",
      qty: 100,
      amount: 50000,
      onCredit: true,
      lang: "bn",
    });
    expect(prompt).toContain("রহিম");
    expect(prompt).toContain("বাকি");
    expect(prompt).toContain("ঠিক");
  });

  it("parses yes no and qty revision", () => {
    expect(parseConfirmReply("হ্যাঁ").decision).toBe("commit");
    expect(parseConfirmReply("না").decision).toBe("cancel");
    expect(parseConfirmReply("না, ৮০ ক্রেট")).toEqual({ decision: "revise", qty: 80 });
  });
});
