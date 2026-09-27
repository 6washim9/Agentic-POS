import { describe, expect, it } from "vitest";
import { parseVoiceCommand } from "./nlp";

describe("parseVoiceCommand", () => {
  it("parses an English credit sale with trade jargon", () => {
    const result = parseVoiceCommand(
      "Sold 100 crates of Fuji Apples to Rahim Aratdar for 50000 Taka on credit.",
    );
    expect(result.intent).toBe("sale");
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.entities.qty).toBe(100);
    expect(result.entities.unit).toBe("crate");
    expect(String(result.entities.sku).toLowerCase()).toContain("fuji");
    expect(String(result.entities.customer).toLowerCase()).toContain("rahim");
    expect(result.entities.amount).toBe(50000);
    expect(result.entities.on_credit).toBe(true);
  });

  it("falls back below 80 percent confidence", () => {
    const result = parseVoiceCommand("hmm maybe something later");
    expect(result.confidence).toBeLessThan(0.8);
    expect(result.needsFallback).toBe(true);
  });

  it("parses a Bangla joma payment with amount and customer", () => {
    const result = parseVoiceCommand("রহিম কে 5000 টাকা জমা নিলাম");
    expect(result.intent).toBe("payment");
    expect(result.entities.amount).toBe(5000);
    expect(String(result.entities.customer).toLowerCase()).toContain("rahim");
  });
});
