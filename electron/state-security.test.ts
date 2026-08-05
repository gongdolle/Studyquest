import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { assertNoCredentialFields } = require("./state-security.cjs") as {
  assertNoCredentialFields(value: unknown): void;
};

describe("learning state credential boundary", () => {
  it("accepts normal evidence text but rejects nested credential fields", () => {
    expect(() => assertNoCredentialFields({ evidence: [{ content: "Explain API key safety" }] })).not.toThrow();
    expect(() => assertNoCredentialFields({ preferences: { apiKey: "test-secret" } })).toThrow("Credentials");
    expect(() => assertNoCredentialFields({ nested: [{ authorization: "Bearer secret" }] })).toThrow("Credentials");
  });
});
