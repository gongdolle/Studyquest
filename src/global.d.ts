export {};

declare global {
  interface ProviderProbe {
    available: boolean;
    configured?: boolean;
    decryptable?: boolean;
    needsReconnect?: boolean;
    source?: string;
    version?: string;
    verifiedAt?: string;
    reason?: string;
  }

  interface ProviderStatus {
    codex: ProviderProbe;
    claude: ProviderProbe;
    openai: ProviderProbe;
    anthropic: ProviderProbe;
    deepseek: ProviderProbe;
    checkedAt: string;
  }

  type AIProviderId = "codex" | "claude" | "openai" | "anthropic" | "deepseek";
  type AIProviderPreference = "auto" | "codex" | "openai" | "anthropic" | "deepseek";
  type APIProviderId = "openai" | "anthropic" | "deepseek";

  interface AIInvokeRequest {
    provider: AIProviderPreference;
    operation: "diagnostic" | "curriculum" | "lesson" | "evaluation" | "interview";
    prompt: string;
    schemaName: "diagnostic" | "curriculum" | "lesson" | "evaluation" | "interview";
    timeoutMs?: number;
  }

  interface AIInvokeResult {
    ok: boolean;
    requestId: string;
    provider: AIProviderId;
    text?: string;
    data?: unknown;
    usage?: {
      inputTokens?: number;
      cachedInputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      costUsd?: number;
      durationMs?: number;
    };
    error?: string;
  }

  interface RuntimeInfo {
    portableRoot: string;
    dataRoot: string;
    defaultDataRoot: string;
    dataRootIsDefault: boolean;
    configPath: string;
    cliPaths: {
      codex: string | null;
      claude: string | null;
    };
    version: string;
    isPackaged: boolean;
  }

  interface RuntimeConfigurationResult {
    ok: boolean;
    canceled?: boolean;
    restarting?: boolean;
    error?: string;
  }

  interface StudyQuestBridge {
    runtime: {
      getInfo(): Promise<RuntimeInfo>;
      pickDataRoot(): Promise<RuntimeConfigurationResult>;
      useDefaultDataRoot(): Promise<RuntimeConfigurationResult>;
      pickCliExecutable(provider: "codex"): Promise<RuntimeConfigurationResult>;
      useAutomaticCli(provider: "codex"): Promise<RuntimeConfigurationResult>;
    };
    state: {
      load<T>(): Promise<T | null>;
      save<T>(state: T): Promise<{ ok: boolean }>;
    };
    files: {
      pickDocuments(): Promise<Array<{
        name: string;
        path: string;
        size: number;
        excerpt: string;
        extractedChars: number;
        extractionStatus: "ready" | "unsupported" | "failed";
        warning?: string;
      }>>;
    };
    ai: {
      status(): Promise<ProviderStatus>;
      invoke(request: AIInvokeRequest): Promise<AIInvokeResult>;
      cancel(requestId: string): Promise<{ ok: boolean }>;
    };
    credentials: {
      set(request: { provider: APIProviderId; apiKey: string; model: string }): Promise<{
        ok: boolean;
        provider?: APIProviderId;
        model?: string;
        error?: string;
      }>;
      remove(provider: APIProviderId): Promise<{ ok: boolean; error?: string }>;
      test(provider: APIProviderId): Promise<{
        ok: boolean;
        provider?: APIProviderId;
        model?: string;
        verifiedAt?: string;
        error?: string;
      }>;
    };
    audio: {
      armPermission(): Promise<{ ok: boolean; expiresAt?: string }>;
      transcribe(request: { bytes: ArrayBuffer; mimeType: string; language: string }): Promise<{
        ok: boolean;
        provider?: "openai";
        model?: string;
        text?: string;
        error?: string;
      }>;
    };
  }

  interface Window {
    studyQuest?: StudyQuestBridge;
  }
}
