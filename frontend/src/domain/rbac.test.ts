import { describe, expect, it } from "vitest";
import {
  CATALOG,
  backfillCaps,
  clipOwner,
  defaultCaps,
  effective,
  forceSuperAdminAdmin,
  visibleScreens,
  voiceKey,
  weaker,
} from "./rbac";

describe("rbac", () => {
  it("weaker prefers deny", () => {
    expect(weaker("allow", "deny")).toBe("deny");
  });

  it("enterer effective is min of cap and owner override", () => {
    const caps = defaultCaps();
    caps.enterer["screen.warehouse"] = "allow";
    expect(effective(caps, { "screen.warehouse": "deny" }, "enterer", "screen.warehouse")).toBe("deny");
  });

  it("clips owner allow down to confirm cap", () => {
    const clipped = clipOwner({ "hitl.credit_override": "confirm" }, { "hitl.credit_override": "allow" });
    expect(clipped["hitl.credit_override"]).toBe("confirm");
  });

  it("forces super admin screen.admin allow", () => {
    const caps = defaultCaps();
    caps.super_admin["screen.admin"] = "deny";
    expect(forceSuperAdminAdmin(caps).super_admin["screen.admin"]).toBe("allow");
  });

  it("hides denied screens from tab list", () => {
    const caps = defaultCaps();
    caps.enterer["screen.warehouse"] = "deny";
    const ids = visibleScreens("enterer", caps, {});
    expect(ids).not.toContain("warehouse");
    expect(ids).toContain("sale");
    expect(ids).not.toContain("settings");
    expect(ids).not.toContain("admin");
  });

  it("maps voice intents to agent keys", () => {
    expect(voiceKey("sale")).toBe("agent.sale");
    expect(voiceKey("spoilage")).toBe("agent.spoilage");
    expect(voiceKey("debt_reminder")).toBe("agent.reminder");
    expect(voiceKey("unknown")).toBeNull();
  });

  it("includes collection catalog keys and defaults", () => {
    const caps = defaultCaps();
    expect(CATALOG).toContain("agent.collection");
    expect(CATALOG).toContain("hitl.advance");
    expect(caps.enterer["agent.collection"]).toBe("allow");
    expect(caps.enterer["hitl.advance"]).toBe("confirm");
  });

  it("maps payment voice intent to agent.collection", () => {
    expect(voiceKey("payment")).toBe("agent.collection");
  });

  it("backfills missing catalog keys from defaults", () => {
    const caps = defaultCaps();
    delete caps.enterer["agent.collection"];
    delete caps.enterer["hitl.advance"];
    const restored = backfillCaps(caps);
    expect(restored.enterer["agent.collection"]).toBe("allow");
    expect(restored.enterer["hitl.advance"]).toBe("confirm");
  });
});
