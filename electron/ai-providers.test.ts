import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  AIProviders,
  EMPTY_CLAUDE_MCP_CONFIG,
  cleanMessage,
  parseClaudeJsonOutput,
  providerEnvironment,
  validateInvokeRequest,
} = require("./ai-providers.cjs") as {
  AIProviders: new (options: Record<string, unknown>) => any;
  EMPTY_CLAUDE_MCP_CONFIG: string;
  cleanMessage(value: unknown): string;
  parseClaudeJsonOutput(value: unknown): Record<string, unknown>;
  providerEnvironment(dataRoot: string): Record<string, string>;
  validateInvokeRequest(input: Record<string, unknown>): { provider: string };
};

const lesson = {
  title: "Speak clearly",
  objective: "Explain one idea in English",
  segments: [
    {
      phase: "orient",
      minutes: 4,
      heading: "How the idea is organized",
      content: "A clear explanation begins by separating the central claim from its supporting details and boundary conditions. The learner first reads the complete structure, notices how each part contributes to meaning, and follows the relationship from premise to conclusion without pausing to answer a question or produce an early response.",
      readingGuide: "Notice the claim, its conditions, and the order in which the explanation develops.",
      widget: null,
    },
    {
      phase: "explain",
      minutes: 9,
      heading: "Build a precise explanation",
      content: "Precision comes from naming the subject, stating what changes, and connecting the change to a reason that the listener can inspect. A useful explanation also distinguishes observation from interpretation, keeps related details together, and marks uncertainty honestly when the available evidence does not justify a stronger conclusion.",
      readingGuide: "Track how definitions, evidence, and uncertainty are connected in the explanation.",
      widget: null,
    },
    {
      phase: "example",
      minutes: 8,
      heading: "Follow a worked example",
      content: "Consider an explanation of why a small controller adjustment changes the response of a system. The speaker names the adjusted parameter, describes the observed response before and after the change, and then connects the difference to the governing principle. This sequence makes the reasoning visible instead of presenting only a final result.",
      readingGuide: "Compare the initial condition, the changed parameter, and the resulting observation.",
      widget: null,
    },
    {
      phase: "explore",
      minutes: 9,
      heading: "Explore the sequence",
      content: "The interactive sequence below presents a claim, its supporting reason, and the resulting conclusion as separate states. Moving through the states reveals one relationship at a time so the learner can inspect how the explanation is assembled. The activity is observational and does not request an answer before the complete lesson has been read.",
      readingGuide: "Move through every state and observe which relationship is added at each step.",
      widget: {
        id: "explanation-lab",
        kind: "sandbox-lab",
        title: "Claim to conclusion lab",
        instruction: "Move the structure slider and observe how each part strengthens the explanation.",
        html: "<main><label>Structure <input id=\"structure\" type=\"range\" min=\"0\" max=\"2\" value=\"0\"></label><p id=\"stage\"></p></main>",
        css: "body{font:16px system-ui;margin:0;padding:20px;color:#172033}main{display:grid;gap:16px}input{width:100%}",
        javascript: "const stages=['Claim','Claim + supporting reason','Claim + supporting reason + bounded conclusion'];const input=document.querySelector('#structure');const stage=document.querySelector('#stage');const render=()=>{stage.textContent=stages[Number(input.value)]};input.addEventListener('input',render);render();",
        height: 320,
      },
    },
  ],
  finalCheck: {
    intro: "Complete these checks only after reading all four sections and exploring the widget.",
    questions: [
      {
        id: "structure-check",
        prompt: "Which sequence makes an explanation easiest to inspect?",
        options: [
          "Conclusion, decoration, claim, silence",
          "Claim, supporting reason, applicable conclusion",
          "Unrelated examples without a central claim",
          "A final result without its conditions",
        ],
        correctIndex: 1,
        explanation: "A claim followed by a supporting reason and bounded conclusion exposes the reasoning structure.",
      },
      {
        id: "uncertainty-check",
        prompt: "How should uncertainty be handled when evidence is limited?",
        options: [
          "Hide it to sound more confident",
          "Replace evidence with a stronger adjective",
          "Mark it honestly and avoid a stronger unsupported conclusion",
          "Remove every condition from the explanation",
        ],
        correctIndex: 2,
        explanation: "An honest uncertainty marker keeps the explanation aligned with the strength of its evidence.",
      },
    ],
  },
  successEvidence: "A transcript",
  reviewPrompt: "After the final check, write one claim with its reason and applicable conclusion.",
};

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createProvider(fetchImpl: ReturnType<typeof vi.fn>, models: Partial<Record<string, string>> = {}) {
  const credentialStore = {
    get: vi.fn(async (provider: string) => ({
      apiKey: `test-${provider}-secret-value`,
      model: models[provider] ?? ({
        openai: "gpt-5.6-terra",
        anthropic: "claude-sonnet-5",
        deepseek: "deepseek-v4-flash",
      } as Record<string, string>)[provider],
    })),
  };
  const providers = new AIProviders({
    portableRoot: process.cwd(),
    dataRoot: path.join(process.cwd(), ".tmp"),
    schemasRoot: path.join(process.cwd(), "schemas"),
    credentialStore,
    fetchImpl,
  });
  providers.inspectProviders = vi.fn(async () => ({
    codex: { public: { available: false } },
    claude: { public: { available: false } },
    openai: { public: { available: true }, transport: "api" },
    anthropic: { public: { available: true }, transport: "api" },
    deepseek: { public: { available: true }, transport: "api" },
  }));
  return { providers, credentialStore };
}

function createCliOverrideProvider(cliPaths?: { codex?: string; claude?: string }) {
  return new AIProviders({
    portableRoot: process.cwd(),
    dataRoot: path.join(process.cwd(), ".tmp"),
    schemasRoot: path.join(process.cwd(), "schemas"),
    credentialStore: {
      get: vi.fn(),
      status: vi.fn(async () => ({ providers: {} })),
    },
    fetchImpl: vi.fn(),
    cliPaths,
  });
}

describe("Claude CLI JSON output", () => {
  it("uses the empty MCP shape required by Claude Code", () => {
    expect(JSON.parse(EMPTY_CLAUDE_MCP_CONFIG)).toEqual({ mcpServers: {} });
  });

  it("accepts a normal result wrapper and a final JSON line after a notice", () => {
    const result = { type: "result", result: "", structured_output: { ok: true } };
    expect(parseClaudeJsonOutput(JSON.stringify(result))).toEqual(result);
    expect(parseClaudeJsonOutput(`Claude update notice\n\uFEFF${JSON.stringify(result)}\n`)).toEqual(result);
  });

  it("distinguishes empty output from malformed output", () => {
    expect(() => parseClaudeJsonOutput("  \n")).toThrow("Claude returned no output.");
    expect(() => parseClaudeJsonOutput("not-json")).toThrow("Claude returned invalid JSON output.");
  });
});

describe("CLI executable overrides", () => {
  it("prioritizes an explicit Codex executable and keeps Claude subscription routing disabled", async () => {
    const executable = path.resolve(process.execPath);
    const providers = createCliOverrideProvider({ codex: executable, claude: executable });

    const status = await providers.status();
    const inspectedCodex = await providers.inspectCodex();

    expect(status.codex).toMatchObject({ available: true, source: executable });
    expect(status.claude).toMatchObject({ available: false });
    expect(status.claude.reason).toContain("API keys");
    expect(inspectedCodex).toMatchObject({ transport: "cli", executable });
    expect(status.codex.source).not.toContain("@openai/codex-sdk");
  });

  it("keeps an explicit missing override authoritative instead of silently falling back", async () => {
    const configuredPath = path.resolve(process.cwd(), ".tmp", "missing-codex.exe");
    const providers = createCliOverrideProvider({ codex: configuredPath });

    const inspected = await providers.inspectCodex();

    expect(inspected.public).toMatchObject({
      available: false,
      source: configuredPath,
    });
    expect(inspected.public.reason).toContain("override was not found");
  });

  it("treats a command-like override as one filesystem path, not a shell command", async () => {
    const commandLikePath = `${process.execPath} --version`;
    const providers = createCliOverrideProvider({ codex: commandLikePath });

    const inspected = await providers.inspectCodex();

    expect(inspected.public).toMatchObject({
      available: false,
      source: path.resolve(commandLikePath),
    });
  });

  it("retains the bundled Codex SDK fallback when no override is configured", async () => {
    const providers = createCliOverrideProvider();

    const inspected = await providers.inspectCodex();

    expect(inspected).toMatchObject({
      public: {
        available: true,
        source: "@openai/codex-sdk 0.146.0 bundled CLI",
      },
      transport: "sdk-cli",
    });
  });
});

describe("API provider routing", () => {
  it("does not leak ambient API keys or unrelated secrets into CLI processes", () => {
    const previousOpenAI = process.env.OPENAI_API_KEY;
    const previousSecret = process.env.STUDYQUEST_TEST_SECRET;
    process.env.OPENAI_API_KEY = "test-ambient-secret";
    process.env.STUDYQUEST_TEST_SECRET = "do-not-copy";
    try {
      const environment = providerEnvironment(path.join(process.cwd(), ".tmp"));
      expect(environment.OPENAI_API_KEY).toBeUndefined();
      expect(environment.STUDYQUEST_TEST_SECRET).toBeUndefined();
      expect(environment.TEMP).toContain(path.join(".tmp", "temp", "providers"));
      expect(cleanMessage("Authorization: Bearer test-super-secret-value")).not.toContain("super-secret");
      expect(cleanMessage("Provider said sk-12345678")).not.toContain("12345678");
    } finally {
      if (previousOpenAI === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAI;
      if (previousSecret === undefined) delete process.env.STUDYQUEST_TEST_SECRET;
      else process.env.STUDYQUEST_TEST_SECRET = previousSecret;
    }
  });

  it("accepts all supported API provider ids", () => {
    for (const provider of ["openai", "anthropic", "deepseek"]) {
      expect(validateInvokeRequest({ provider, operation: "lesson", schemaName: "lesson", prompt: "teach" }).provider)
        .toBe(provider);
    }
  });

  it("rejects the disabled Claude provider and its legacy cost cap", () => {
    expect(() => validateInvokeRequest({
      provider: "claude",
      operation: "lesson",
      schemaName: "lesson",
      prompt: "teach",
    })).toThrow("Unsupported AI provider");
    expect(() => validateInvokeRequest({
      provider: "auto",
      operation: "lesson",
      schemaName: "lesson",
      prompt: "teach",
      budgetUsd: 1,
    })).toThrow("budgetUsd is not supported");
  });

  it("uses OpenAI Responses structured output without exposing the key", async () => {
    const fetchImpl = vi.fn(async () => response({
      output_text: JSON.stringify(lesson),
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    }));
    const { providers } = createProvider(fetchImpl);
    const result = await providers.invoke({ provider: "openai", operation: "lesson", schemaName: "lesson", prompt: "teach me" });

    expect(result).toMatchObject({ ok: true, provider: "openai", data: lesson });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({ method: "POST", redirect: "error" }),
    );
    const request = fetchImpl.mock.calls[0][1];
    const body = JSON.parse(request.body as string);
    expect(body.text.format.type).toBe("json_schema");
    expect(JSON.stringify(body.text.format.schema)).toContain('"sandbox-lab"');
    expect(JSON.stringify(result)).not.toContain("super-secret");
  });

  it("uses current DeepSeek V4 chat completion model", async () => {
    const fetchImpl = vi.fn(async () => response({
      choices: [{ message: { content: JSON.stringify(lesson) } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    }));
    const { providers } = createProvider(fetchImpl);
    const result = await providers.invoke({ provider: "deepseek", operation: "lesson", schemaName: "lesson", prompt: "teach me" });
    expect(result.ok).toBe(true);
    const request = fetchImpl.mock.calls[0][1];
    expect(JSON.parse(request.body as string).model).toBe("deepseek-v4-flash");
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.deepseek.com/chat/completions");
  });

  it("falls through an unauthenticated installed CLI in automatic mode", async () => {
    const fetchImpl = vi.fn(async () => response({ output_text: JSON.stringify(lesson) }));
    const { providers } = createProvider(fetchImpl);
    providers.inspectProviders = vi.fn(async () => ({
      codex: { public: { available: true }, executable: "codex.exe" },
      claude: { public: { available: false } },
      openai: { public: { available: true }, transport: "api" },
      anthropic: { public: { available: false } },
      deepseek: { public: { available: false } },
    }));
    providers.invokeCodexCli = vi.fn(async () => {
      const error = new Error("not logged in") as Error & { code: string };
      error.code = "provider_failed";
      throw error;
    });
    const result = await providers.invoke({ provider: "auto", operation: "lesson", schemaName: "lesson", prompt: "teach me" });
    expect(result).toMatchObject({ ok: true, provider: "openai" });
  });

  it("supports memory-only WebM transcription and redacts authentication failures", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ text: "I would like to explain this idea." }))
      .mockResolvedValueOnce(response({ error: "bad key" }, 401));
    const { providers } = createProvider(fetchImpl);
    const transcription = await providers.transcribe({
      bytes: new Uint8Array(128).buffer,
      mimeType: "audio/webm;codecs=opus",
      language: "en-US",
    });
    expect(transcription).toMatchObject({ ok: true, provider: "openai", text: "I would like to explain this idea." });

    const failed = await providers.invoke({ provider: "openai", operation: "lesson", schemaName: "lesson", prompt: "teach me" });
    expect(failed).toMatchObject({ ok: false, error: "API key authentication failed." });
    expect(JSON.stringify(failed)).not.toContain("super-secret");
  });
});
