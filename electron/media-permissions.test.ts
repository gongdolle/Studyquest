import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createMediaPermissionPolicy } = require("./media-permissions.cjs") as {
  createMediaPermissionPolicy(options: {
    isTrusted(value: unknown): boolean;
    isTrustedFrame?(details: Record<string, unknown>): boolean;
    now(): number;
    ttlMs?: number;
  }): {
    arm(): { ok: boolean };
    canRequest(value: unknown, permission: string, details?: { mediaTypes?: string[]; isMainFrame?: boolean }): boolean;
    canCheck(value: unknown, permission: string, details?: { mediaType?: string; isMainFrame?: boolean }): boolean;
  };
};

describe("microphone permission policy", () => {
  it("allows only a freshly armed audio request from the trusted main contents", () => {
    let clock = 1_000;
    const trusted = {};
    const policy = createMediaPermissionPolicy({
      isTrusted: (value) => value === trusted,
      now: () => clock,
      ttlMs: 100,
    });

    expect(policy.canRequest(trusted, "media", { mediaTypes: ["audio"], isMainFrame: true })).toBe(false);
    policy.arm();
    expect(policy.canCheck(trusted, "media", { mediaType: "audio", isMainFrame: true })).toBe(true);
    expect(policy.canRequest(trusted, "media", { mediaTypes: ["audio"], isMainFrame: true })).toBe(true);
    expect(policy.canRequest(trusted, "media", { mediaTypes: ["audio"], isMainFrame: false })).toBe(false);
    expect(policy.canCheck(trusted, "media", { mediaType: "audio", isMainFrame: false })).toBe(false);
    expect(policy.canRequest(trusted, "media", { mediaTypes: ["audio", "video"], isMainFrame: true })).toBe(false);
    expect(policy.canRequest({}, "media", { mediaTypes: ["audio"], isMainFrame: true })).toBe(false);
    expect(policy.canRequest(trusted, "camera", { mediaTypes: ["audio"], isMainFrame: true })).toBe(false);
    clock += 101;
    expect(policy.canRequest(trusted, "media", { mediaTypes: ["audio"], isMainFrame: true })).toBe(false);
  });
});
