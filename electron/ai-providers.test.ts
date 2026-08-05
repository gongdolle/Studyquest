import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  AIProviders,
  EMPTY_CLAUDE_MCP_CONFIG,
  claudeApiKeyEnvironment,
  cleanMessage,
  parseClaudeJsonOutput,
  providerEnvironment,
  validateInvokeRequest,
} = require("./ai-providers.cjs") as {
  AIProviders: new (options: Record<string, unknown>) => any;
  EMPTY_CLAUDE_MCP_CONFIG: string;
  claudeApiKeyEnvironment(dataRoot: string, apiKey: string): Record<string, string>;
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

const interview = {
  assistantMessage: "CSS 학습 범위와 목표를 확인했습니다. 이제 생활 시간표를 한 번 확인할게요.",
  readiness: 0.55,
  readyForDiagnostic: false,
  subjectBlueprint: {
    subjectName: "CSS",
    role: "support",
    dailyMinutes: 30,
    knownSummary: "기본 선택자는 사용해 본 적이 있습니다.",
    unknownSummary: "반응형 레이아웃과 Grid는 테스트로 확인합니다.",
    goal: "반응형 웹 화면을 스스로 구현합니다.",
    successEvidence: "참고 화면을 보고 반응형 페이지를 완성합니다.",
    skills: [
      { name: "CSS 레이아웃", prerequisites: [], reason: "화면 구조를 구현하는 핵심 능력" },
    ],
  },
  scheduleRecommendation: {
    defaultReadyAt: null,
    learningDeadline: null,
    protectGameTime: null,
    gameStart: null,
    gameEnd: null,
    wrapUpMinutes: 10,
    maxSessionMinutes: 30,
    dayOverrides: [],
    constraintsSummary: "학습 가능 시간을 사용자에게 확인 중입니다.",
  },
  followUpQuestions: ["보통 몇 시부터 공부를 시작할 수 있나요?"],
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

function createClaudeCapabilityProcess(supportsBare = true) {
  return vi.fn(async ({ args }: { args: string[] }) => {
    if (args[0] === "--version") {
      return { stdout: supportsBare ? "2.1.81 (Claude Agent)" : "2.1.80 (Claude Agent)", stderr: "", code: 0 };
    }
    if (args[0] === "--help") {
      return { stdout: supportsBare ? "Usage: claude [options]\n  --bare  Run without local configuration" : "Usage: claude [options]", stderr: "", code: 0 };
    }
    throw new Error(`Unexpected CLI probe: ${args.join(" ")}`);
  });
}

function createCliOverrideProvider(
  cliPaths?: { codex?: string; claude?: string },
  runProcessImpl = createClaudeCapabilityProcess(),
) {
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
    runProcessImpl,
  });
}

describe("Claude CLI JSON output", () => {
  it("uses the empty MCP shape required by Claude Agent", () => {
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

describe("Codex physical output schemas", () => {
  it("passes a verified physical schema file to native Codex", async () => {
    const dataRoot = path.join(process.cwd(), ".tmp", "codex-schema-physical");
    const schemasRoot = path.join(process.cwd(), "schemas");
    let physicalSchemaPath = "";
    const runProcessImpl = vi.fn(async (input: { args: string[] }) => {
      const schemaFlag = input.args.indexOf("--output-schema");
      expect(schemaFlag).toBeGreaterThan(-1);
      physicalSchemaPath = input.args[schemaFlag + 1];
      expect(fs.statSync(physicalSchemaPath).isFile()).toBe(true);
      expect(physicalSchemaPath.toLowerCase()).not.toContain("app.asar");
      expect(physicalSchemaPath).toBe(fs.realpathSync(path.join(schemasRoot, "interview.schema.json")));
      const physicalSchema = JSON.parse(fs.readFileSync(physicalSchemaPath, "utf8"));
      expect(physicalSchema.required).toContain("subjectBlueprint");
      return {
        stdout: [
          JSON.stringify({
            type: "item.completed",
            item: { type: "agent_message", text: JSON.stringify(interview) },
          }),
          JSON.stringify({
            type: "turn.completed",
            usage: { input_tokens: 120, cached_input_tokens: 20, output_tokens: 80 },
          }),
        ].join("\n"),
        stderr: "",
        code: 0,
      };
    });
    const providers = new AIProviders({
      portableRoot: process.cwd(),
      dataRoot,
      schemasRoot,
      codexSchemasRoot: schemasRoot,
      credentialStore: { status: vi.fn(async () => ({ providers: {} })) },
      fetchImpl: vi.fn(),
      runProcessImpl,
    });
    providers.inspectProviders = vi.fn(async () => ({
      codex: { public: { available: true }, executable: "codex.exe" },
    }));

    const result = await providers.invoke({
      provider: "codex",
      operation: "interview",
      schemaName: "interview",
      prompt: "CSS를 배우고 싶습니다.",
    });

    expect(result).toMatchObject({ ok: true, provider: "codex", data: interview });
    expect(runProcessImpl).toHaveBeenCalledTimes(1);
    expect(physicalSchemaPath).not.toBe("");
    expect(fs.existsSync(physicalSchemaPath)).toBe(true);
  });

  it("rejects a physical schema that differs from the trusted ASAR schema", async () => {
    const temporaryParent = path.join(process.cwd(), ".tmp");
    fs.mkdirSync(temporaryParent, { recursive: true });
    const physicalSchemasRoot = fs.mkdtempSync(path.join(temporaryParent, "codex-schema-mismatch-"));
    const runProcessImpl = vi.fn();
    try {
      fs.writeFileSync(
        path.join(physicalSchemasRoot, "interview.schema.json"),
        `${JSON.stringify({ type: "object", properties: {} })}\n`,
        "utf8",
      );
      const providers = new AIProviders({
        portableRoot: process.cwd(),
        dataRoot: path.join(process.cwd(), ".tmp", "codex-schema-mismatch-data"),
        schemasRoot: path.join(process.cwd(), "schemas"),
        codexSchemasRoot: physicalSchemasRoot,
        credentialStore: { status: vi.fn(async () => ({ providers: {} })) },
        fetchImpl: vi.fn(),
        runProcessImpl,
      });
      providers.inspectProviders = vi.fn(async () => ({
        codex: { public: { available: true }, executable: "codex.exe" },
      }));

      const result = await providers.invoke({
        provider: "codex",
        operation: "interview",
        schemaName: "interview",
        prompt: "CSS를 배우고 싶습니다.",
      });

      expect(result).toMatchObject({
        ok: false,
        provider: "codex",
        error: "Physical Codex schema does not match the trusted app schema.",
      });
      expect(runProcessImpl).not.toHaveBeenCalled();
    } finally {
      const resolvedParent = path.resolve(temporaryParent);
      const resolvedTemporary = path.resolve(physicalSchemasRoot);
      if (
        resolvedTemporary.startsWith(`${resolvedParent}${path.sep}`)
        && path.basename(resolvedTemporary).startsWith("codex-schema-mismatch-")
      ) {
        fs.rmSync(resolvedTemporary, { recursive: true, force: true });
      }
    }
  });
});

describe("CLI executable overrides", () => {
  it("prioritizes explicit CLI executables but keeps Claude unavailable without an API key", async () => {
    const executable = path.resolve(process.execPath);
    const providers = createCliOverrideProvider({ codex: executable, claude: executable });

    const status = await providers.status();
    const inspectedCodex = await providers.inspectCodex();

    expect(status.codex).toMatchObject({ available: true, source: executable });
    expect(status.claude).toMatchObject({ available: false });
    expect(status.claude.reason).toContain("Anthropic API key");
    expect(inspectedCodex).toMatchObject({ transport: "cli", executable });
    expect(status.codex.source).not.toContain("@openai/codex-sdk");
  });

  it("enables the Claude Agent executable only when the saved Anthropic key is usable", async () => {
    const executable = path.resolve(process.execPath);
    const providers = new AIProviders({
      portableRoot: process.cwd(),
      dataRoot: path.join(process.cwd(), ".tmp", "claude-status"),
      schemasRoot: path.join(process.cwd(), "schemas"),
      credentialStore: {
        status: vi.fn(async () => ({
          providers: {
            anthropic: { configured: true, decryptable: true, model: "claude-sonnet-5" },
          },
        })),
      },
      fetchImpl: vi.fn(),
      cliPaths: { codex: executable, claude: executable },
      runProcessImpl: createClaudeCapabilityProcess(),
    });

    const status = await providers.status();

    expect(status.claude).toMatchObject({
      available: true,
      configured: true,
      decryptable: true,
      source: executable,
    });
    expect(status.claude.reason).toBeUndefined();
  });

  it("fails closed when an approved Claude CLI does not support bare mode", async () => {
    const executable = path.resolve(process.execPath);
    const providers = new AIProviders({
      portableRoot: process.cwd(),
      dataRoot: path.join(process.cwd(), ".tmp", "claude-old-version"),
      schemasRoot: path.join(process.cwd(), "schemas"),
      credentialStore: {
        status: vi.fn(async () => ({
          providers: {
            anthropic: { configured: true, decryptable: true, model: "claude-sonnet-5" },
          },
        })),
      },
      fetchImpl: vi.fn(),
      cliPaths: { claude: executable },
      runProcessImpl: createClaudeCapabilityProcess(false),
    });

    const status = await providers.status();

    expect(status.claude).toMatchObject({ available: false, source: executable });
    expect(status.claude.reason).toContain("--bare");
    expect(status.claude.reason).toContain("2.1.81");
  });

  it("reports an auto-detected Claude CLI without authorizing it to receive a key", async () => {
    const executable = path.resolve(process.execPath);
    const runProcessImpl = createClaudeCapabilityProcess();
    const providers = new AIProviders({
      portableRoot: process.cwd(),
      dataRoot: path.join(process.cwd(), ".tmp", "claude-detected-only"),
      schemasRoot: path.join(process.cwd(), "schemas"),
      credentialStore: { status: vi.fn(async () => ({ providers: {} })) },
      fetchImpl: vi.fn(),
      runProcessImpl,
    });
    providers.resolveClaudePath = vi.fn(() => executable);

    const inspected = await providers.inspectClaude();

    expect(inspected.public).toMatchObject({ available: false, source: executable });
    expect(inspected.public.reason).toContain("not approved");
    expect(inspected.executable).toBeUndefined();
    expect(runProcessImpl).not.toHaveBeenCalled();
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

  it("builds a Claude environment with only the explicit key and an isolated config directory", () => {
    const previousAnthropic = process.env.ANTHROPIC_API_KEY;
    const previousOAuth = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const previousCloudAuth = process.env.AWS_ACCESS_KEY_ID;
    process.env.ANTHROPIC_API_KEY = "test-ambient-anthropic-secret";
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "test-subscription-oauth-secret";
    process.env.AWS_ACCESS_KEY_ID = "test-cloud-auth-secret";
    const dataRoot = path.join(process.cwd(), ".tmp", "claude-environment");
    try {
      const environment = claudeApiKeyEnvironment(dataRoot, "test-explicit-anthropic-secret");
      expect(environment.ANTHROPIC_API_KEY).toBe("test-explicit-anthropic-secret");
      expect(environment.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
      expect(environment.AWS_ACCESS_KEY_ID).toBeUndefined();
      expect(environment.CLAUDE_CONFIG_DIR).toBe(path.join(dataRoot, "providers", "claude-api-key-only"));
      expect(environment.CLAUDE_CONFIG_DIR).not.toBe(path.join(process.env.USERPROFILE ?? "", ".claude"));
    } finally {
      if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousAnthropic;
      if (previousOAuth === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      else process.env.CLAUDE_CODE_OAUTH_TOKEN = previousOAuth;
      if (previousCloudAuth === undefined) delete process.env.AWS_ACCESS_KEY_ID;
      else process.env.AWS_ACCESS_KEY_ID = previousCloudAuth;
    }
  });

  it("accepts all supported provider ids", () => {
    for (const provider of ["claude", "openai", "anthropic", "deepseek"]) {
      expect(validateInvokeRequest({ provider, operation: "lesson", schemaName: "lesson", prompt: "teach" }).provider)
        .toBe(provider);
    }
  });

  it("rejects the legacy per-call cost cap", () => {
    expect(() => validateInvokeRequest({
      provider: "auto",
      operation: "lesson",
      schemaName: "lesson",
      prompt: "teach",
      budgetUsd: 1,
    })).toThrow("budgetUsd is not supported");
  });

  it("invokes Claude CLI with the saved Anthropic key, selected model, and structured output", async () => {
    const dataRoot = path.join(process.cwd(), ".tmp", "claude-invoke");
    const runProcessImpl = vi.fn(async ({ args }: { args: string[] }) => {
      if (args[0] === "--version") return { stdout: "2.1.81 (Claude Agent)", stderr: "", code: 0 };
      if (args[0] === "--help") return { stdout: "Usage: claude [options]\n  --bare  Run without local configuration", stderr: "", code: 0 };
      return {
        stdout: JSON.stringify({
          type: "result",
          result: JSON.stringify(lesson),
          structured_output: lesson,
          usage: { input_tokens: 40, output_tokens: 20 },
        }),
        stderr: "",
        code: 0,
      };
    });
    const credentialStore = {
      get: vi.fn(async (provider: string) => {
        expect(provider).toBe("anthropic");
        return { apiKey: "test-explicit-anthropic-secret", model: "claude-sonnet-5" };
      }),
    };
    const providers = new AIProviders({
      portableRoot: process.cwd(),
      dataRoot,
      schemasRoot: path.join(process.cwd(), "schemas"),
      credentialStore,
      fetchImpl: vi.fn(),
      runProcessImpl,
    });
    providers.inspectProviders = vi.fn(async () => ({
      codex: { public: { available: false } },
      claude: {
        public: { available: true },
        transport: "cli-api-key",
        executable: path.resolve(process.execPath),
      },
      openai: { public: { available: false } },
      anthropic: { public: { available: false } },
      deepseek: { public: { available: false } },
    }));

    const result = await providers.invoke({
      provider: "claude",
      operation: "lesson",
      schemaName: "lesson",
      prompt: "teach me",
    });

    expect(result).toMatchObject({ ok: true, provider: "claude", data: lesson });
    expect(credentialStore.get).toHaveBeenCalledWith("anthropic");
    expect(runProcessImpl).toHaveBeenCalledTimes(3);
    const processInput = runProcessImpl.mock.calls.find(([input]) => input.args.includes("--print"))?.[0];
    expect(processInput).toBeDefined();
    expect(processInput.args).toEqual(expect.arrayContaining([
      "--bare",
      "--model", "claude-sonnet-5",
      "--output-format", "json",
      "--json-schema",
      "--setting-sources", "",
    ]));
    expect(processInput.env.ANTHROPIC_API_KEY).toBe("test-explicit-anthropic-secret");
    expect(processInput.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(processInput.env.CLAUDE_CONFIG_DIR).toBe(path.join(dataRoot, "providers", "claude-api-key-only"));
    for (const [probeInput] of runProcessImpl.mock.calls.filter(([input]) => input.args[0] === "--version" || input.args[0] === "--help")) {
      expect(probeInput.env.ANTHROPIC_API_KEY).toBeUndefined();
    }
    expect(JSON.stringify(result)).not.toContain("test-explicit-anthropic-secret");
  });

  it("never falls back to ambient Claude credentials when the Anthropic key is absent", async () => {
    const previousAnthropic = process.env.ANTHROPIC_API_KEY;
    const previousOAuth = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    process.env.ANTHROPIC_API_KEY = "test-ambient-key-must-not-be-used";
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "test-oauth-must-not-be-used";
    const runProcessImpl = vi.fn();
    const providers = new AIProviders({
      portableRoot: process.cwd(),
      dataRoot: path.join(process.cwd(), ".tmp", "claude-no-key"),
      schemasRoot: path.join(process.cwd(), "schemas"),
      credentialStore: {
        get: vi.fn(async () => { throw new Error("Anthropic API key is not configured."); }),
      },
      fetchImpl: vi.fn(),
      runProcessImpl,
    });
    providers.inspectProviders = vi.fn(async () => ({
      claude: { public: { available: true }, executable: path.resolve(process.execPath) },
    }));
    try {
      const result = await providers.invoke({
        provider: "claude",
        operation: "lesson",
        schemaName: "lesson",
        prompt: "teach me",
      });
      expect(result).toMatchObject({ ok: false, provider: "claude", error: "Anthropic API key is not configured." });
      expect(runProcessImpl).not.toHaveBeenCalled();
    } finally {
      if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousAnthropic;
      if (previousOAuth === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      else process.env.CLAUDE_CODE_OAUTH_TOKEN = previousOAuth;
    }
  });

  it("discards Claude output that echoes the exact API credential", async () => {
    const apiKey = "test-explicit-secret-that-must-not-escape";
    const runProcessImpl = vi.fn(async ({ args }: { args: string[] }) => {
      if (args[0] === "--version") return { stdout: "2.1.81 (Claude Agent)", stderr: "", code: 0 };
      if (args[0] === "--help") return { stdout: "--bare", stderr: "", code: 0 };
      return { stdout: JSON.stringify({ type: "result", result: apiKey }), stderr: "", code: 0 };
    });
    const providers = new AIProviders({
      portableRoot: process.cwd(),
      dataRoot: path.join(process.cwd(), ".tmp", "claude-secret-output"),
      schemasRoot: path.join(process.cwd(), "schemas"),
      credentialStore: {
        get: vi.fn(async () => ({ apiKey, model: "claude-sonnet-5" })),
      },
      fetchImpl: vi.fn(),
      runProcessImpl,
    });
    providers.inspectProviders = vi.fn(async () => ({
      claude: { public: { available: true }, executable: path.resolve(process.execPath) },
    }));

    const result = await providers.invoke({
      provider: "claude",
      operation: "lesson",
      schemaName: "lesson",
      prompt: "teach me",
    });

    expect(result).toMatchObject({ ok: false, provider: "claude" });
    expect(result.error).toContain("credential");
    expect(JSON.stringify(result)).not.toContain(apiKey);
  });

  it("never routes automatic requests through a local Claude executable", async () => {
    const fetchImpl = vi.fn();
    const { providers, credentialStore } = createProvider(fetchImpl);
    providers.inspectProviders = vi.fn(async () => ({
      codex: { public: { available: false } },
      claude: { public: { available: true }, executable: "claude.exe" },
      openai: { public: { available: true }, transport: "api" },
      anthropic: { public: { available: true }, transport: "api" },
      deepseek: { public: { available: true }, transport: "api" },
    }));
    providers.invokeClaude = vi.fn(async () => ({
      text: JSON.stringify(lesson),
      data: lesson,
      usage: {},
    }));
    providers.invokeApi = vi.fn(async (provider: string) => {
      expect(provider).toBe("openai");
      return { text: JSON.stringify(lesson), data: lesson, usage: {} };
    });

    const result = await providers.invoke({
      provider: "auto",
      operation: "lesson",
      schemaName: "lesson",
      prompt: "teach me",
    });

    expect(result).toMatchObject({ ok: true, provider: "openai", data: lesson });
    expect(credentialStore.get).not.toHaveBeenCalled();
    expect(providers.invokeClaude).not.toHaveBeenCalled();
    expect(providers.invokeApi).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
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

  it("falls through malformed structured CLI output in automatic mode", async () => {
    const fetchImpl = vi.fn();
    const { providers } = createProvider(fetchImpl);
    providers.inspectProviders = vi.fn(async () => ({
      codex: { public: { available: true }, executable: "codex.exe" },
      claude: { public: { available: false } },
      openai: { public: { available: true }, transport: "api" },
      anthropic: { public: { available: false } },
      deepseek: { public: { available: false } },
    }));
    providers.invokeCodexCli = vi.fn(async () => ({
      text: "This response is not a JSON object.",
      data: undefined,
      usage: {},
    }));
    providers.invokeApi = vi.fn(async (provider: string) => {
      expect(provider).toBe("openai");
      return { text: JSON.stringify(lesson), data: lesson, usage: {} };
    });

    const result = await providers.invoke({
      provider: "auto",
      operation: "lesson",
      schemaName: "lesson",
      prompt: "teach me",
    });

    expect(result).toMatchObject({ ok: true, provider: "openai", data: lesson });
    expect(providers.invokeCodexCli).toHaveBeenCalledTimes(1);
    expect(providers.invokeApi).toHaveBeenCalledTimes(1);
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
