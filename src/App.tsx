import {
  BookMarked,
  BookOpen,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Cpu,
  Database,
  FileText,
  Flame,
  FolderOpen,
  Gamepad2,
  Gauge,
  GraduationCap,
  LayoutDashboard,
  LibraryBig,
  ListChecks,
  KeyRound,
  Moon,
  Network,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Sun,
  Target,
  Trash2,
  Upload,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import SkillGraphView, { subjectColor } from "./components/SkillGraphView";
import { FinalLessonCheck, LessonWidgetView } from "./components/LessonInteractive";
import VoiceRecorder from "./components/VoiceRecorder";
import {
  addDays,
  applyNaturalLanguageBoost,
  buildReverseSchedule,
  createSkillGraph,
  deriveProactiveBoosts,
  ensureCurrentCurriculum,
  generateSevenDayCurriculum,
  installCurriculum,
  minutesFromClock,
  processNaturalLanguageFeedback,
  recordLearningIntent,
  resolveScheduleWindow,
  registerSubject,
  scoreDiagnostic,
  submitEvidence,
  upsertSkillGraph,
} from "./lib/engine";
import {
  buildCurriculumPrompt,
  buildDiagnosticEvaluationPrompt,
  buildDiagnosticPrompt,
  buildEvidenceEvaluationPrompt,
  buildInterviewPrompt,
  buildLessonPrompt,
  extractStructuredData,
  isEvaluationPayload,
  isCompleteInterviewSchedule,
  isInterviewPayload,
  isInterviewScheduleRecommendation,
} from "./lib/prompts";
import type {
  EvaluationPayload,
  InterviewPayload,
  InterviewScheduleRecommendation,
  InterviewSubjectBlueprint,
  InterviewTurn,
} from "./lib/prompts";
import { createEmptyStudyState } from "./lib/empty-seed";
import {
  COMMAND_PROMPT_PLACEHOLDER,
  COMMAND_PROMPT_SUGGESTIONS,
  findPromptCompletion,
} from "./lib/prompt-completion";
import {
  lessonPhaseName,
  localLesson,
  normalizeGeneratedLesson,
  type GeneratedLesson,
} from "./lib/lesson";
import type {
  Curriculum7Day,
  DailyCheckIn,
  DailySchedule,
  Diagnostic,
  DiagnosticResult,
  LearningEvidence,
  Quest,
  SkillGraph,
  SkillNode,
  StudyQuestState,
  Subject,
} from "./lib/types";

type ViewId =
  | "onboarding"
  | "today"
  | "subjects"
  | "diagnostic"
  | "graph"
  | "curriculum"
  | "lesson"
  | "settings";

interface TokenUsageEntry {
  id: string;
  at: string;
  provider: AIProviderId;
  operation: AIInvokeRequest["operation"];
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface ErrorLogEntry {
  id: string;
  at: string;
  title: string;
  message: string;
}

interface ImportedDocument {
  id: string;
  subjectId: string;
  name: string;
  path: string;
  size: number;
  excerpt: string;
  extractedChars: number;
  extractionStatus: "ready" | "unsupported" | "failed";
  warning?: string;
}

interface AppEnvelope {
  version: 2;
  learning: StudyQuestState;
  checkIn: DailyCheckIn;
  selectedSubjectId: string;
  selectedQuestId?: string;
  generatedLessons: Record<string, GeneratedLesson>;
  importedDocuments: ImportedDocument[];
  interview: InterviewState;
  usage: TokenUsageEntry[];
  errorLog: ErrorLogEntry[];
  preferences: {
    provider: AIProviderPreference;
    monthlyTokenBudget: number;
    protectGameTime: boolean;
    theme: "light" | "dark";
    setupCompleted: boolean;
  };
}

interface InterviewMessage extends InterviewTurn {
  id: string;
}

interface InterviewDiagnosticQuestion {
  id: string;
  concept: string;
  skillName: string;
  prompt: string;
  difficulty: number;
  evaluationGuide: string;
}

interface InterviewState {
  status: "idle" | "interview" | "ready" | "diagnostic";
  readiness: number;
  messages: InterviewMessage[];
  blueprint?: InterviewSubjectBlueprint;
  scheduleRecommendation?: InterviewScheduleRecommendation;
  diagnosticTitle?: string;
  diagnosticOverview?: string;
  questions: InterviewDiagnosticQuestion[];
  answers: Record<string, string>;
}

interface AIDiagnosticPayload {
  title: string;
  overview: string;
  questions: Array<{
    concept: string;
    skillName: string;
    prompt: string;
    difficulty: number;
    evaluationGuide: string;
  }>;
}

interface AICurriculumPayload {
  title: string;
  strategy: string;
  skillNodes: Array<{
    name: string;
    prerequisites: string[];
    reason: string;
  }>;
  days: Array<{
    day: number;
    focus: string;
    quests: Array<{ title: string; durationMin: number; output: string; skillNames: string[] }>;
  }>;
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function isAIDiagnosticPayload(value: unknown): value is AIDiagnosticPayload {
  if (!isPlainRecord(value) || typeof value.title !== "string" || typeof value.overview !== "string") return false;
  if (!Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > 8) return false;
  return value.questions.every((question) => isPlainRecord(question)
    && typeof question.concept === "string"
    && Boolean(question.concept.trim())
    && typeof question.skillName === "string"
    && Boolean(question.skillName.trim())
    && typeof question.prompt === "string"
    && Boolean(question.prompt.trim())
    && typeof question.difficulty === "number"
    && Number.isFinite(question.difficulty)
    && question.difficulty >= 1
    && question.difficulty <= 5
    && typeof question.evaluationGuide === "string");
}

function isAICurriculumPayload(value: unknown): value is AICurriculumPayload {
  if (!isPlainRecord(value) || typeof value.title !== "string" || typeof value.strategy !== "string") return false;
  if (!Array.isArray(value.skillNodes) || value.skillNodes.length < 1 || value.skillNodes.length > 80 || !Array.isArray(value.days) || value.days.length !== 7) return false;
  const skillNames = new Set<string>();
  const skillsValid = value.skillNodes.every((skill) => {
    if (!isPlainRecord(skill) || typeof skill.name !== "string" || !skill.name.trim()) return false;
    const key = skill.name.trim().toLocaleLowerCase("ko-KR");
    if (skillNames.has(key)) return false;
    skillNames.add(key);
    return Array.isArray(skill.prerequisites)
      && skill.prerequisites.every((name) => typeof name === "string")
      && typeof skill.reason === "string";
  });
  if (!skillsValid) return false;
  const prerequisitesBySkill = new Map(
    value.skillNodes.map((skill) => [
      skill.name.trim().toLocaleLowerCase("ko-KR"),
      skill.prerequisites
        .map((name: unknown) => String(name).trim().toLocaleLowerCase("ko-KR"))
        .filter((name: string) => skillNames.has(name)),
    ]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string): boolean => {
    if (visiting.has(name)) return false;
    if (visited.has(name)) return true;
    visiting.add(name);
    for (const prerequisite of prerequisitesBySkill.get(name) ?? []) {
      if (!visit(prerequisite)) return false;
    }
    visiting.delete(name);
    visited.add(name);
    return true;
  };
  if ([...skillNames].some((name) => !visit(name))) return false;
  const dayNumbers = new Set<number>();
  return value.days.every((day) => {
    if (!isPlainRecord(day) || !Number.isInteger(day.day) || (day.day as number) < 1 || (day.day as number) > 7) return false;
    if (dayNumbers.has(day.day as number)) return false;
    dayNumbers.add(day.day as number);
    if (typeof day.focus !== "string" || !Array.isArray(day.quests) || day.quests.length < 1) return false;
    return day.quests.every((quest) => isPlainRecord(quest)
      && typeof quest.title === "string"
      && Boolean(quest.title.trim())
      && typeof quest.durationMin === "number"
      && Number.isInteger(quest.durationMin)
      && quest.durationMin >= 10
      && quest.durationMin <= 90
      && typeof quest.output === "string"
      && Boolean(quest.output.trim())
      && Array.isArray(quest.skillNames)
      && quest.skillNames.length > 0
      && quest.skillNames.every((name) => typeof name === "string" && Boolean(name.trim())));
  });
}

function assertAICurriculumReferences(
  payload: AICurriculumPayload,
  existingSkillNames: readonly string[],
): void {
  const known = new Set([
    ...existingSkillNames.map((name) => name.trim().toLocaleLowerCase("ko-KR")),
    ...payload.skillNodes.map((skill) => skill.name.trim().toLocaleLowerCase("ko-KR")),
  ]);
  const unknownPrerequisite = payload.skillNodes
    .flatMap((skill) => skill.prerequisites)
    .find((name) => !known.has(name.trim().toLocaleLowerCase("ko-KR")));
  const unknownQuestSkill = payload.days
    .flatMap((day) => day.quests)
    .flatMap((quest) => quest.skillNames)
    .find((name) => !known.has(name.trim().toLocaleLowerCase("ko-KR")));
  if (unknownPrerequisite || unknownQuestSkill) {
    throw new Error(`AI 커리큘럼이 존재하지 않는 스킬을 참조했습니다: ${unknownPrerequisite ?? unknownQuestSkill}`);
  }
}

type AIEvaluationPayload = EvaluationPayload;

type DiagnosticAnswerMap = Record<string, { text: string }>;

interface ToastState {
  id: string;
  kind: "success" | "error";
  title: string;
  message: string;
}

interface BusyState {
  label: string;
  detail: string;
  requestId: string;
}

const localIsoDate = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};

const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const slug = (value: string) => {
  const normalized = value
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
  return normalized || uid("subject");
};

const formatMinutes = (minutes: number) => {
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}시간 ${rest}분` : `${hours}시간`;
};

const formatDate = (value: string, withYear = false) =>
  new Intl.DateTimeFormat("ko-KR", {
    ...(withYear ? { year: "numeric" as const } : {}),
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${value}T12:00:00`));

const formatErrorTimestamp = (value: string) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "시간 정보 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const normalizeErrorLogText = (value: unknown, fallback: string, maxLength: number) => {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, maxLength);
  return normalized || fallback;
};

const subjectStyle = (subject: Subject) =>
  ({ "--subject-color": subjectColor(subject) }) as CSSProperties;

const currentTime = () =>
  new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date())
    .replace("24:", "00:");

const providerLabels: Record<AIProviderId, string> = {
  codex: "Codex CLI",
  claude: "Claude Agent",
  openai: "OpenAI API",
  anthropic: "Claude API",
  deepseek: "DeepSeek API",
};

const providerLabel = (provider: AIProviderId) => providerLabels[provider];

const aiFailureMessage = (result: AIInvokeResult): string => {
  const provider = providerLabel(result.provider);
  const message = result.error?.trim() || "AI 생성에 실패했습니다.";
  const reference = result.errorCode
    ? `\n오류 코드: ${result.errorCode} · 요청 ID: ${result.requestId}`
    : `\n요청 ID: ${result.requestId}`;
  if (result.errorCode === "invalid_output" || /structured object|outside the required schema|invalid JSON(?: output)?/i.test(message)) {
    return `${provider} 응답 형식을 한 번 자동 재시도했지만 복구하지 못했습니다. 입력은 그대로 유지되었습니다. 다시 시도하거나 다른 AI를 선택해 주세요.${reference}`;
  }
  if (result.errorCode === "timeout" || /timed out|timeout/i.test(message)) {
    return `${provider} 응답이 제한 시간 안에 도착하지 않아 중단했습니다. 입력은 그대로 유지되었습니다. 잠시 후 다시 시도하거나 다른 AI를 선택해 주세요.${reference}`;
  }
  if (result.errorCode === "cancelled") {
    return `${provider} 요청을 취소했습니다. 입력은 그대로 유지되었습니다.${reference}`;
  }
  if (["model_unavailable", "response_format_unsupported", "invalid_request"].includes(result.errorCode ?? "")) {
    return `${provider} 모델 또는 API 형식을 확인해 주세요. ${message}${reference}`;
  }
  return `${provider}: ${message}${reference}`;
};

const providerIsReady = (
  provider: AIProviderId,
  status: ProviderStatus,
): boolean => {
  if (provider === "codex") return status.codex.available;
  if (provider === "claude") {
    return status.claude.available && Boolean(status.anthropic.verifiedAt);
  }
  return status[provider].available && Boolean(status[provider].verifiedAt);
};

const preferenceIsReady = (
  preference: AIProviderPreference,
  status: ProviderStatus,
): boolean => preference === "auto"
  ? (["codex", "openai", "anthropic", "deepseek"] as const)
      .some((provider) => providerIsReady(provider, status))
  : providerIsReady(preference, status);

const createInitialInterview = (): InterviewState => ({
  status: "idle",
  readiness: 0,
  messages: [
    {
      id: uid("interview-message"),
      role: "assistant",
      content: "먼저 배우고 싶은 과목과 어디까지 해내고 싶은지 적어주세요. 영어처럼 말하기가 중요하면 회화·낭독·발표 중 원하는 방식도 함께 알려주세요. 목표가 잡히면 실제 학습 시작·종료·게임 시간과 요일 예외를 한 번 확인하고 현재 수준 테스트를 만들게요.",
    },
  ],
  questions: [],
  answers: {},
});

const createInitialEnvelope = (): AppEnvelope => {
  const learning = createEmptyStudyState();
  const today = localIsoDate();
  return {
    version: 2,
    learning,
    checkIn: { date: today, readyAt: "19:30", fatigue: 2 },
    selectedSubjectId: "",
    selectedQuestId: undefined,
    generatedLessons: {},
    importedDocuments: [],
    interview: createInitialInterview(),
    usage: [],
    errorLog: [],
    preferences: {
      provider: "auto",
      monthlyTokenBudget: 1_000_000,
      protectGameTime: true,
      theme: "light",
      setupCompleted: false,
    },
  };
};

const isReadmeDemo = () => import.meta.env.DEV
  && new URLSearchParams(window.location.search).has("readme-demo");

const createReadmeDemoEnvelope = (): AppEnvelope => {
  const today = localIsoDate();
  let learning = createEmptyStudyState();
  const subjectDefinitions = [
    { id: "control", name: "제어공학", role: "main" as const, dailyTargetMinutes: 60, minimumTouchMinutes: 30 },
    { id: "css", name: "CSS", role: "support" as const, dailyTargetMinutes: 30, minimumTouchMinutes: 15 },
    { id: "react", name: "React", role: "support" as const, dailyTargetMinutes: 30, minimumTouchMinutes: 15 },
    { id: "math", name: "수학", role: "support" as const, dailyTargetMinutes: 30, minimumTouchMinutes: 15 },
    { id: "english", name: "영어", role: "support" as const, dailyTargetMinutes: 30, minimumTouchMinutes: 15 },
  ];
  for (const subject of subjectDefinitions) learning = registerSubject(learning, subject);

  const intents = [
    ["control", "집필 중인 제어공학 원고를 독자가 시뮬레이션까지 따라올 수 있게 완성한다.", "수식·반례·시뮬레이션을 포함한 원고 수정본", "근궤적과 주파수 응답의 연결이 아직 직관적으로 설명되지 않는다."],
    ["css", "반응형 학습 위젯을 스스로 스타일링한다.", "반응형 카드와 그래프 레이아웃", "Grid와 컨테이너 쿼리의 선택 기준이 헷갈린다."],
    ["react", "학습 상태가 복잡한 React 화면을 안정적으로 설계한다.", "상태 전이가 명확한 컴포넌트", "서버 상태와 로컬 상태의 경계를 더 연습하고 싶다."],
    ["math", "제어공학 수식을 독립적으로 유도하고 검산한다.", "라플라스 변환과 행렬 계산 유도", "고유값이 동특성에 미치는 의미를 더 깊게 이해하고 싶다."],
    ["english", "기술 내용을 영어로 3분 동안 명확히 설명한다.", "녹음 가능한 기술 설명 스크립트", "문장 정확성보다 자연스러운 연결 표현이 부족하다."],
  ] as const;
  for (const [subjectId, goalText, successEvidence, unknownText] of intents) {
    learning = recordLearningIntent(learning, {
      id: `demo-${subjectId}`,
      subjectId,
      goalText,
      successEvidence,
      unknownText,
      priority: subjectId === "control" ? 1 : 0.7,
    });
  }

  const graphs = [
    createSkillGraph("control", [
      { id: "modeling", name: "시스템 모델링", mastery: 0.84, uncertainty: 0.16 },
      { id: "laplace", name: "라플라스 변환", prerequisiteIds: ["modeling"], mastery: 0.72, uncertainty: 0.28 },
      { id: "feedback", name: "피드백 구조", prerequisiteIds: ["laplace"], mastery: 0.61, uncertainty: 0.37 },
      { id: "stability", name: "안정도 판별", prerequisiteIds: ["feedback"], mastery: 0.43, uncertainty: 0.58 },
      { id: "frequency", name: "주파수 응답", prerequisiteIds: ["stability"], mastery: 0.34, uncertainty: 0.69 },
      { id: "pid", name: "PID 설계", prerequisiteIds: ["feedback", "stability"], mastery: 0.38, uncertainty: 0.61 },
    ]),
    createSkillGraph("css", [
      { id: "cascade", name: "Cascade와 명시도", mastery: 0.76, uncertainty: 0.25 },
      { id: "layout", name: "Grid·Flex 레이아웃", prerequisiteIds: ["cascade"], mastery: 0.58, uncertainty: 0.41 },
      { id: "responsive", name: "반응형 설계", prerequisiteIds: ["layout"], mastery: 0.42, uncertainty: 0.59 },
    ]),
    createSkillGraph("react", [
      { id: "components", name: "컴포넌트 경계", mastery: 0.7, uncertainty: 0.3 },
      { id: "state", name: "상태 모델링", prerequisiteIds: ["components"], mastery: 0.52, uncertainty: 0.48 },
      { id: "effects", name: "Effect와 동기화", prerequisiteIds: ["state"], mastery: 0.39, uncertainty: 0.64 },
    ]),
    createSkillGraph("math", [
      { id: "calculus", name: "미분방정식", mastery: 0.66, uncertainty: 0.34 },
      { id: "linear", name: "선형대수", mastery: 0.57, uncertainty: 0.43 },
      { id: "eigen", name: "고유값과 모드", prerequisiteIds: ["linear"], mastery: 0.44, uncertainty: 0.57 },
    ]),
    createSkillGraph("english", [
      { id: "structure", name: "설명 구조", mastery: 0.62, uncertainty: 0.38 },
      { id: "linking", name: "연결 표현", prerequisiteIds: ["structure"], mastery: 0.41, uncertainty: 0.6 },
      { id: "delivery", name: "기술 발표", prerequisiteIds: ["linking"], mastery: 0.36, uncertainty: 0.65 },
    ]),
  ];
  for (const graph of graphs) learning = upsertSkillGraph(learning, graph);
  learning = {
    ...learning,
    resources: [{
      id: "demo-manuscript",
      subjectId: "control",
      kind: "manuscript",
      title: "제어공학 집필 원고",
      currentSection: "주파수 응답과 안정도",
    }],
    schedulePolicy: {
      ...learning.schedulePolicy,
      configuredBy: "ai-interview",
      defaultReadyAt: "19:20",
      learningDeadline: "23:00",
      gameStart: "23:00",
      gameEnd: "24:00",
      constraintsSummary: "평일 퇴근 후 19:20 시작 · 23:00 학습 종료 · 이후 1시간 게임",
    },
  };
  const curriculum = generateSevenDayCurriculum(learning, today);
  learning = installCurriculum(learning, curriculum);
  const selectedQuest = curriculum.days[0].quests[0];
  const selectedSkill = graphs[0].nodes.find((node) => selectedQuest.skillIds.includes(node.id));
  const generatedLesson = localLesson(selectedQuest, selectedSkill);

  return {
    ...createInitialEnvelope(),
    learning,
    checkIn: { date: today, readyAt: "19:20", fatigue: 2, note: "집필 집중일" },
    selectedSubjectId: "control",
    selectedQuestId: selectedQuest.id,
    generatedLessons: { [selectedQuest.id]: generatedLesson },
    importedDocuments: [{
      id: "demo-document",
      subjectId: "control",
      name: "control-engineering-manuscript.md",
      path: "README 데모 문서",
      size: 84_000,
      excerpt: "폐루프 전달함수에서 안정도와 주파수 응답을 연결하는 집필 구간",
      extractedChars: 12_400,
      extractionStatus: "ready",
    }],
    interview: {
      ...createInitialInterview(),
      status: "idle",
      readiness: 1,
    },
    usage: [{
      id: "demo-usage",
      at: new Date().toISOString(),
      provider: "codex",
      operation: "curriculum",
      inputTokens: 8_400,
      cachedInputTokens: 4_100,
      outputTokens: 2_600,
      costUsd: 0,
    }],
    preferences: {
      ...createInitialEnvelope().preferences,
      setupCompleted: true,
    },
  };
};

const hydrateEnvelope = (value: unknown): AppEnvelope => {
  const initial = createInitialEnvelope();
  if (!value || typeof value !== "object") return initial;
  const candidate = value as Partial<AppEnvelope>;
  if (candidate.version !== 2 || !candidate.learning) return initial;
  const today = localIsoDate();
  const learning = ensureCurrentCurriculum({
    ...candidate.learning,
    schedulePolicy: {
      ...initial.learning.schedulePolicy,
      ...candidate.learning.schedulePolicy,
      dayOverrides: candidate.learning.schedulePolicy.dayOverrides ?? [],
    },
  }, today);
  const scheduleWindow = resolveScheduleWindow(learning.schedulePolicy, today);
  const savedCheckInIsToday = candidate.checkIn?.date === today;
  const inferredSetupCompleted = typeof candidate.preferences?.setupCompleted === "boolean"
    ? candidate.preferences.setupCompleted
    : Boolean(
        candidate.learning.subjects.length
        || candidate.interview?.status !== "idle"
        || candidate.usage?.length,
      );
  const savedErrorLog = Array.isArray(candidate.errorLog) ? candidate.errorLog : [];
  return {
    ...initial,
    ...candidate,
    version: 2,
    learning,
    generatedLessons: candidate.generatedLessons ?? {},
    importedDocuments: (candidate.importedDocuments ?? []).map((document) => ({
      ...document,
      excerpt: document.excerpt ?? "",
      extractedChars: document.extractedChars ?? 0,
      extractionStatus: document.extractionStatus ?? "unsupported",
    })),
    usage: candidate.usage ?? [],
    errorLog: savedErrorLog
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => {
        const rawTimestamp = String(entry.at ?? "");
        const timestamp = new Date(rawTimestamp);
        return {
          id: normalizeErrorLogText(entry.id, uid("error"), 160),
          at: Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : new Date().toISOString(),
          title: normalizeErrorLogText(entry.title, "오류", 160),
          message: normalizeErrorLogText(entry.message, "상세 내용이 없습니다.", 2_400),
        };
      })
      .slice(-50),
    interview: {
      ...createInitialInterview(),
      ...(candidate.interview ?? {}),
      messages: candidate.interview?.messages?.length
        ? [...candidate.interview.messages]
        : createInitialInterview().messages,
      questions: candidate.interview?.questions ?? [],
      answers: candidate.interview?.answers ?? {},
      scheduleRecommendation: isInterviewScheduleRecommendation(candidate.interview?.scheduleRecommendation)
        ? candidate.interview.scheduleRecommendation
        : undefined,
    },
    preferences: {
      ...initial.preferences,
      ...(candidate.preferences ?? {}),
      provider: new Set<AIProviderPreference>([
        "auto", "codex", "claude", "openai", "anthropic", "deepseek",
      ]).has(candidate.preferences?.provider ?? "auto")
        ? candidate.preferences?.provider ?? "auto"
        : "auto",
      theme: candidate.preferences?.theme === "dark" ? "dark" : "light",
      setupCompleted: inferredSetupCompleted,
    },
    checkIn: {
      ...initial.checkIn,
      ...(candidate.checkIn ?? {}),
      date: today,
      readyAt: savedCheckInIsToday
        ? candidate.checkIn?.readyAt ?? scheduleWindow.readyAt
        : scheduleWindow.studyEnabled ? scheduleWindow.readyAt : scheduleWindow.learningDeadline,
    },
  };
};

const subjectIcon = (name: string, size = 18): ReactNode => {
  const lower = name.toLocaleLowerCase("ko-KR");
  if (lower.includes("저서") || lower.includes("책")) return <BookMarked size={size} />;
  if (lower.includes("css")) return <WandSparkles size={size} />;
  if (lower.includes("react")) return <Cpu size={size} />;
  if (lower.includes("수학")) return <Gauge size={size} />;
  if (lower.includes("영어")) return <BookOpen size={size} />;
  return <GraduationCap size={size} />;
};

const clampUnit = (value: number) =>
  Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

function rebuildAdaptivePlan(state: StudyQuestState): StudyQuestState {
  let next = state;
  for (const boost of deriveProactiveBoosts(next)) {
    next = applyNaturalLanguageBoost(next, boost);
  }
  if (next.curriculum?.source === "ai") return next;
  return installCurriculum(next, generateSevenDayCurriculum(next, localIsoDate()));
}

function installAICurriculum(
  state: StudyQuestState,
  subject: Subject,
  payload: AICurriculumPayload,
  provider: AIProviderId,
): StudyQuestState {
  const startDate = localIsoDate();
  const existing = state.curriculum;
  const otherQuestsByDate = new Map(
    (existing?.days ?? []).map((day) => [
      day.date,
      day.quests.filter((quest) => quest.primarySubjectId !== subject.id),
    ]),
  );
  const graph = state.skillGraphs.find((item) => item.subjectId === subject.id);
  const existingNodes = graph?.nodes ?? [];
  const skillIdByName = new Map(
    existingNodes.map((node) => [node.name.toLocaleLowerCase("ko-KR"), node.id]),
  );
  for (const skill of payload.skillNodes ?? []) {
    const key = skill.name.trim().toLocaleLowerCase("ko-KR");
    if (key && !skillIdByName.has(key)) {
      skillIdByName.set(key, uid(`${subject.id}-skill-${slug(skill.name)}`));
    }
  }
  const addedNodes: SkillNode[] = (payload.skillNodes ?? [])
    .filter((skill) => {
      const key = skill.name.trim().toLocaleLowerCase("ko-KR");
      return key && !existingNodes.some((node) => node.name.toLocaleLowerCase("ko-KR") === key);
    })
    .map((skill) => ({
      id: skillIdByName.get(skill.name.trim().toLocaleLowerCase("ko-KR"))!,
      subjectId: subject.id,
      name: skill.name.trim(),
      prerequisiteIds: skill.prerequisites
        .map((name) => skillIdByName.get(name.trim().toLocaleLowerCase("ko-KR")))
        .filter((id): id is string => Boolean(id)),
      mastery: 0.08,
      uncertainty: 0.92,
      attempts: 0,
      evidenceIds: [],
    }));
  const mergedNodes = [...existingNodes, ...addedNodes];
  const validatedStructure = createSkillGraph(subject.id, mergedNodes.map((node) => ({
    id: node.id,
    name: node.name,
    prerequisiteIds: node.prerequisiteIds,
    mastery: node.mastery,
    uncertainty: node.uncertainty,
  })));
  const mergedGraph: SkillGraph = {
    subjectId: subject.id,
    nodes: mergedNodes,
    edges: validatedStructure.edges,
  };
  const learningWithGraph = upsertSkillGraph(state, mergedGraph);
  const relatedMainSubjects = state.subjects
    .filter((item) => item.active && item.role === "main" && item.id !== subject.id)
    .map((item) => item.id)
    .slice(0, 1);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(startDate, index);
    const aiDay = payload.days.find((item) => item.day === index + 1) ?? payload.days[index];
    const generated = (aiDay?.quests ?? []).map((quest, questIndex): Quest => {
      const requestedSkillNames = [...new Set(quest.skillNames.map((name) => name.trim().toLocaleLowerCase("ko-KR")))];
      const linkedSkillIds = requestedSkillNames
        .map((name) => skillIdByName.get(name))
        .filter((id): id is string => Boolean(id));
      if (!linkedSkillIds.length || linkedSkillIds.length !== requestedSkillNames.length) {
        throw new Error(`AI 커리큘럼의 퀘스트 스킬 연결을 확인할 수 없습니다: ${quest.title}`);
      }
      return {
        id: uid(`ai-quest-${subject.id}-${index + 1}-${questIndex + 1}`),
        date,
        title: quest.title,
        description: `${payload.strategy}\n${aiDay?.focus ?? ""}`.trim(),
        primarySubjectId: subject.id,
        taggedSubjectIds: subject.role === "main" ? [] : relatedMainSubjects,
        skillIds: linkedSkillIds,
        estimatedMinutes: Math.min(90, Math.max(10, Math.round(quest.durationMin || 30))),
        kind: subject.role === "main" ? "authoring" : "lesson",
        requiredEvidence: quest.output,
        status: "planned",
      };
    });
    const quests = [...(otherQuestsByDate.get(date) ?? []), ...generated];
    return {
      date,
      quests,
      plannedMinutes: quests.reduce((total, quest) => total + quest.estimatedMinutes, 0),
      adaptationReason: `${providerLabel(provider)}: ${payload.strategy}`,
    };
  });
  const curriculum: Curriculum7Day = {
    id: uid(`ai-curriculum-${startDate}`),
    startDate,
    revision: (existing?.revision ?? 0) + 1,
    source: "ai",
    generatedBy: provider,
    days,
  };
  return installCurriculum(learningWithGraph, curriculum);
}

const blankStatus: ProviderStatus = {
  codex: { available: false, reason: "확인 중" },
  claude: { available: false, reason: "확인 중" },
  openai: { available: false, reason: "연결 안 됨" },
  anthropic: { available: false, reason: "연결 안 됨" },
  deepseek: { available: false, reason: "연결 안 됨" },
  checkedAt: "",
};

export default function App() {
  const [envelope, setEnvelope] = useState<AppEnvelope | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<ViewId>("onboarding");
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>(blankStatus);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [busy, setBusy] = useState<BusyState | null>(null);
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const [stateLoadError, setStateLoadError] = useState<string | null>(null);
  const [stateRecoveryFailure, setStateRecoveryFailure] = useState("");
  const [stateRecoveryPending, setStateRecoveryPending] = useState(false);
  const stateSaveErrorShown = useRef(false);

  useLayoutEffect(() => {
    const theme = envelope?.preferences.theme ?? "light";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [envelope?.preferences.theme]);

  const notify = useCallback((kind: ToastState["kind"], title: string, message: string) => {
    const safeTitle = normalizeErrorLogText(title, kind === "error" ? "오류" : "알림", 160);
    const safeMessage = normalizeErrorLogText(message, "상세 내용이 없습니다.", 2_400);
    const toast: ToastState = { id: uid("toast"), kind, title: safeTitle, message: safeMessage };
    setToasts((current) => [...current.slice(-2), toast]);
    if (kind === "error") {
      setEnvelope((current) => current ? {
        ...current,
        errorLog: [
          ...current.errorLog,
          { id: uid("error"), at: new Date().toISOString(), title: safeTitle, message: safeMessage },
        ].slice(-50),
      } : current);
      return;
    }
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== toast.id));
    }, 5_200);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const saved = isReadmeDemo()
          ? createReadmeDemoEnvelope()
          : window.studyQuest
            ? await window.studyQuest.state.load<AppEnvelope>()
            : JSON.parse(localStorage.getItem("studyquest-state") ?? "null");
        if (!active) return;
        const hydrated = hydrateEnvelope(saved);
        setEnvelope(hydrated);
        setView(
          hydrated.interview.status !== "idle"
            ? "onboarding"
            : hydrated.learning.subjects.length
              ? "today"
              : "onboarding",
        );
      } catch (error) {
        if (active) {
          setEnvelope(createInitialEnvelope());
          setStateLoadError(normalizeErrorLogText(
            error instanceof Error ? error.message : error,
            "저장된 학습 상태를 읽지 못했습니다.",
            2_400,
          ));
        }
      } finally {
        if (active) setLoaded(true);
      }

      if (window.studyQuest) {
        const [runtimeInfo, status] = await Promise.all([
          window.studyQuest.runtime.getInfo().catch(() => null),
          window.studyQuest.ai.status().catch(() => blankStatus),
        ]);
        if (active) {
          setRuntime(runtimeInfo);
          setProviderStatus(status);
          setProvidersLoaded(true);
        }
      } else if (active) {
        setProvidersLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded || !envelope || stateLoadError || isReadmeDemo()) return;
    const timer = window.setTimeout(() => {
      const reportSaveFailure = (error: unknown) => {
        if (stateSaveErrorShown.current) return;
        stateSaveErrorShown.current = true;
        const toast: ToastState = {
          id: uid("toast"),
          kind: "error",
          title: "학습 상태 저장 실패",
          message: normalizeErrorLogText(
            error instanceof Error ? error.message : error,
            "데이터 폴더에 쓸 수 있는지 확인해 주세요.",
            2_400,
          ),
        };
        setToasts((current) => [...current.slice(-2), toast]);
      };
      if (window.studyQuest) {
        void window.studyQuest.state.save(envelope)
          .then(() => { stateSaveErrorShown.current = false; })
          .catch(reportSaveFailure);
      } else {
        try {
          localStorage.setItem("studyquest-state", JSON.stringify(envelope));
          stateSaveErrorShown.current = false;
        } catch (error) {
          reportSaveFailure(error);
        }
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [envelope, loaded, stateLoadError]);

  useEffect(() => {
    if (!loaded) return;
    const rollToToday = () => {
      const today = localIsoDate();
      setEnvelope((current) => {
        if (!current || current.checkIn.date === today) return current;
        const learning = ensureCurrentCurriculum(current.learning, today);
        const scheduleWindow = resolveScheduleWindow(learning.schedulePolicy, today);
        return {
          ...current,
          learning,
          checkIn: {
            ...current.checkIn,
            date: today,
            readyAt: scheduleWindow.studyEnabled ? scheduleWindow.readyAt : scheduleWindow.learningDeadline,
            fatigue: 2,
          },
          selectedQuestId: learning.curriculum?.days[0]?.quests[0]?.id,
        };
      });
    };
    const interval = window.setInterval(rollToToday, 60_000);
    return () => window.clearInterval(interval);
  }, [loaded]);

  const commit = useCallback((recipe: (current: AppEnvelope) => AppEnvelope) => {
    setEnvelope((current) => (current ? recipe(current) : current));
  }, []);

  const refreshProviders = useCallback(async () => {
    if (!window.studyQuest) return;
    try {
      setProviderStatus(await window.studyQuest.ai.status());
      setProvidersLoaded(true);
    } catch (error) {
      notify("error", "AI 연결 상태 확인 실패", error instanceof Error ? error.message : String(error));
    }
  }, [notify]);

  const requireAIConnection = useCallback((): void => {
    if (!window.studyQuest) {
      throw new Error("StudyQuest 데스크톱 앱에서 AI 연결을 먼저 설정해 주세요.");
    }
    const preference = envelope?.preferences.provider ?? "auto";
    if (preferenceIsReady(preference, providerStatus)) return;
    setEnvelope((current) => current ? {
      ...current,
      preferences: { ...current.preferences, setupCompleted: false },
    } : current);
    throw new Error(
      preference === "auto"
        ? "사용 가능한 AI가 없습니다. Codex CLI 로그인을 확인하거나 개인 API를 연결하면 입력한 내용 그대로 학습을 시작할 수 있습니다."
        : `${preference === "claude" ? "Claude Agent" : providerLabel(preference)} 연결을 사용할 수 없습니다. 초기 설정에서 연결을 다시 확인해 주세요.`,
    );
  }, [envelope?.preferences.provider, providerStatus]);

  const dismissToast = useCallback((toastId: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== toastId));
  }, []);

  const recoverStateAfterBackup = useCallback(async () => {
    if (stateRecoveryPending) return;
    setStateRecoveryPending(true);
    setStateRecoveryFailure("");
    try {
      let backupPath: string | null = null;
      if (window.studyQuest) {
        const result = await window.studyQuest.state.preserveForRecovery();
        if (!result.ok) throw new Error("기존 상태 파일을 백업하지 못했습니다.");
        backupPath = result.backupPath;
      } else {
        localStorage.removeItem("studyquest-state");
      }
      setEnvelope(createInitialEnvelope());
      setView("onboarding");
      setStateLoadError(null);
      notify(
        "success",
        "새 학습 상태를 준비했습니다",
        backupPath
          ? `읽지 못한 원본은 삭제하지 않고 다음 위치에 보관했습니다: ${backupPath}`
          : "기존 상태 파일이 없어 빈 학습 상태로 시작합니다.",
      );
    } catch (error) {
      setStateRecoveryFailure(normalizeErrorLogText(
        error instanceof Error ? error.message : error,
        "복구 준비에 실패했습니다. 데이터 폴더 권한을 확인해 주세요.",
        2_400,
      ));
    } finally {
      setStateRecoveryPending(false);
    }
  }, [notify, stateRecoveryPending]);

  if (!envelope) {
    return (
      <div className="loading-overlay">
        <div className="loading-card">
          <div className="spinner" />
          <strong>StudyQuest를 깨우는 중</strong>
          <p>포터블 폴더의 학습 상태와 스킬 그래프를 불러오고 있습니다.</p>
        </div>
      </div>
    );
  }

  if (stateLoadError) {
    return (
      <>
        <StateRecoveryPage
          error={stateLoadError}
          dataRoot={runtime?.dataRoot}
          pending={stateRecoveryPending}
          recoveryFailure={stateRecoveryFailure}
          onRetry={() => window.location.reload()}
          onRecover={() => void recoverStateAfterBackup()}
        />
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  if (!providersLoaded && !isReadmeDemo()) {
    return (
      <div className="loading-overlay">
        <div className="loading-card">
          <div className="spinner" />
          <strong>AI 연결 상태를 확인하고 있습니다</strong>
          <span>Codex 로그인과 저장된 개인 API를 안전하게 점검합니다.</span>
        </div>
      </div>
    );
  }

  if (!isReadmeDemo() && !envelope.preferences.setupCompleted) {
    return (
      <div className="first-run-root" data-theme={envelope.preferences.theme}>
        <FirstRunSetupPage
          envelope={envelope}
          runtime={runtime}
          providerStatus={providerStatus}
          onRefreshProviders={refreshProviders}
          onUpdatePreferences={(preferences) => setEnvelope((current) => current ? {
            ...current,
            preferences,
          } : current)}
          onComplete={() => {
            setEnvelope((current) => current ? {
              ...current,
              preferences: { ...current.preferences, setupCompleted: true },
            } : current);
            setView("onboarding");
          }}
        />
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
      </div>
    );
  }

  const { learning } = envelope;
  const today = envelope.checkIn.date;
  const todayCurriculum = learning.curriculum?.days.find((day) => day.date === today)
    ?? learning.curriculum?.days[0];
  let schedule: DailySchedule | undefined;
  try {
    schedule = todayCurriculum
      ? buildReverseSchedule(learning, envelope.checkIn, todayCurriculum, envelope.preferences.protectGameTime)
      : undefined;
  } catch {
    schedule = undefined;
  }
  const allQuests = learning.curriculum?.days.flatMap((day) => day.quests) ?? [];
  const selectedQuest =
    allQuests.find((quest) => quest.id === envelope.selectedQuestId) ?? todayCurriculum?.quests[0];
  const selectedSubject =
    learning.subjects.find((subject) => subject.id === envelope.selectedSubjectId)
    ?? learning.subjects[0];
  const completedToday = todayCurriculum?.quests.filter((quest) => quest.status === "completed").length ?? 0;
  const totalToday = todayCurriculum?.quests.length ?? 0;
  const tokenTotal = envelope.usage.reduce(
    (total, item) => total + item.inputTokens + item.outputTokens,
    0,
  );

  const selectQuest = (quest: Quest) => {
    commit((current) => ({
      ...current,
      selectedQuestId: quest.id,
      selectedSubjectId: quest.primarySubjectId,
    }));
    setView("lesson");
  };

  const invokeAI = async <T,>(
    operation: AIInvokeRequest["operation"],
    prompt: string,
    schemaName: AIInvokeRequest["schemaName"],
    label: string,
    validator?: (value: unknown) => value is T,
  ): Promise<{ payload: T; result: AIInvokeResult }> => {
    requireAIConnection();
    if (!window.studyQuest) throw new Error("데스크톱 AI 브리지를 사용할 수 없습니다.");
    const requestId = crypto.randomUUID();
    setBusy({
      label,
      detail: "AI 응답을 기다린 뒤 데이터 구조를 검증하고 있습니다. 보통 20~60초이며 복잡한 작업이나 서비스 혼잡 시 더 걸릴 수 있습니다.",
      requestId,
    });
    const progressTimers = [
      window.setTimeout(() => setBusy((current) => current?.requestId === requestId ? {
        ...current,
        detail: "AI가 학습 요청을 분석하고 구조화된 응답을 작성하고 있습니다. 입력 내용은 앱에 보존되어 있습니다.",
      } : current), 20_000),
      window.setTimeout(() => setBusy((current) => current?.requestId === requestId ? {
        ...current,
        detail: "응답 구조를 검증하고 있습니다. 형식이 맞지 않으면 같은 AI에 한 번 자동 재시도한 뒤 연결된 다른 AI로 전환합니다.",
      } : current), 55_000),
      window.setTimeout(() => setBusy((current) => current?.requestId === requestId ? {
        ...current,
        detail: "서비스 혼잡으로 평소보다 오래 걸리고 있습니다. 기다리거나 아래 버튼으로 안전하게 취소할 수 있습니다.",
      } : current), 110_000),
    ];
    try {
      const result = await window.studyQuest.ai.invoke({
        provider: envelope.preferences.provider,
        operation,
        prompt,
        schemaName,
        timeoutMs: 240_000,
        requestId,
      });
      const observedTokens = (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0);
      if (observedTokens > 0 || (result.usage?.costUsd ?? 0) > 0) {
        commit((current) => ({
          ...current,
          usage: [
            ...current.usage,
            {
              id: uid("usage"),
              at: new Date().toISOString(),
              provider: result.provider,
              operation,
              inputTokens: result.usage?.inputTokens ?? 0,
              cachedInputTokens: result.usage?.cachedInputTokens ?? 0,
              outputTokens: result.usage?.outputTokens ?? 0,
              costUsd: result.usage?.costUsd ?? 0,
            },
          ],
        }));
      }
      if (!result.ok) {
        const connectionInvalidated = [
          "authentication_failed",
          "access_denied",
          "insufficient_balance",
          "model_unavailable",
          "invalid_request",
          "response_format_unsupported",
        ].includes(result.errorCode ?? "") || (
          result.errorCode === "provider_unavailable"
          && /no ai provider is connected|login|not configured|not approved|executable|api key/i.test(result.error ?? "")
        );
        if (connectionInvalidated) {
          const staleReason = "이 연결은 다시 확인해야 합니다. 키·모델·권한을 점검한 뒤 연결 확인을 실행해 주세요.";
          setProviderStatus((current) => {
            const staleProbe = (probe: ProviderProbe): ProviderProbe => ({
              ...probe,
              available: false,
              verifiedAt: undefined,
              reason: staleReason,
            });
            if (result.provider === "claude") {
              return {
                ...current,
                claude: staleProbe(current.claude),
                anthropic: staleProbe(current.anthropic),
                checkedAt: new Date().toISOString(),
              };
            }
            return {
              ...current,
              [result.provider]: staleProbe(current[result.provider]),
              checkedAt: new Date().toISOString(),
            };
          });
          void refreshProviders();
          commit((current) => ({
            ...current,
            preferences: { ...current.preferences, setupCompleted: false },
          }));
        }
        throw new Error(aiFailureMessage(result));
      }
      const payload = extractStructuredData<T>(result, validator);
      return { payload, result };
    } finally {
      progressTimers.forEach((timer) => window.clearTimeout(timer));
      setBusy((current) => current?.requestId === requestId ? null : current);
    }
  };

  const subjectContext = (subject: Subject, state: StudyQuestState = learning) => ({
    subject,
    goals: state.goals.filter((goal) => goal.subjectId === subject.id),
    gaps: state.gaps.filter((gap) => gap.subjectId === subject.id),
    graph: state.skillGraphs.find((graph) => graph.subjectId === subject.id),
    documents: [
      {
        name: "전체 과목 운용 조건",
        kind: "schedule",
        excerpt: JSON.stringify({
          defaultReadyAt: state.schedulePolicy.defaultReadyAt,
          learningDeadline: state.schedulePolicy.learningDeadline,
          gameTime: `${state.schedulePolicy.gameStart}-${state.schedulePolicy.gameEnd}`,
          maxSessionMinutes: state.schedulePolicy.maxSessionMinutes,
          dayOverrides: state.schedulePolicy.dayOverrides ?? [],
          constraintsSummary: state.schedulePolicy.constraintsSummary ?? "",
          subjects: state.subjects.map((item) => ({
            name: item.name,
            role: item.role,
            dailyTargetMinutes: item.dailyTargetMinutes,
            priorityBoost: item.priorityBoost,
          })),
        }),
      },
      ...state.resources
        .filter((resource) => resource.subjectId === subject.id && resource.currentSection)
        .map((resource) => ({
          name: resource.title,
          excerpt: resource.currentSection ?? "",
          status: "ready" as const,
        })),
      ...envelope.importedDocuments
        .filter((document) => document.subjectId === subject.id)
        .map((document) => ({
          name: document.name,
          kind: document.extractionStatus === "ready" ? "local-extract" : "link-only",
          excerpt: document.excerpt || `[본문을 추출하지 못함: ${document.warning ?? "지원하지 않는 형식"}]`,
        })),
    ],
  });

  const blueprintContext = (
    blueprint: InterviewSubjectBlueprint,
    messages: readonly InterviewMessage[] = envelope.interview.messages,
  ) => {
    const subjectId = `draft-${slug(blueprint.subjectName)}`;
    const fallbackSkills = [
      { name: `${blueprint.subjectName} 기초`, prerequisites: [] as readonly string[], reason: "선수지식 확인" },
      { name: `${blueprint.subjectName} 핵심 적용`, prerequisites: [`${blueprint.subjectName} 기초`], reason: "핵심 수행" },
      { name: `${blueprint.subjectName} 실전 전이`, prerequisites: [`${blueprint.subjectName} 핵심 적용`], reason: "새 상황 적용" },
    ];
    const seenSkillNames = new Set<string>();
    const validSkills = blueprint.skills.filter((skill) => {
      const key = skill.name.trim().toLocaleLowerCase("ko-KR");
      if (!key || seenSkillNames.has(key)) return false;
      seenSkillNames.add(key);
      return true;
    });
    const skills = validSkills.length ? validSkills : fallbackSkills;
    const idByName = new Map(
      skills.map((skill, index) => [
        skill.name.trim().toLocaleLowerCase("ko-KR"),
        `${subjectId}-skill-${index + 1}-${slug(skill.name)}`,
      ]),
    );
    const invalidPrerequisite = skills
      .flatMap((skill) => skill.prerequisites.map((name) => ({ skill, name })))
      .find(({ skill, name }) => {
        const skillKey = skill.name.trim().toLocaleLowerCase("ko-KR");
        const prerequisiteKey = name.trim().toLocaleLowerCase("ko-KR");
        return !idByName.has(prerequisiteKey) || prerequisiteKey === skillKey;
      });
    if (invalidPrerequisite) {
      throw new Error(`인터뷰 스킬의 선수관계를 확인할 수 없습니다: ${invalidPrerequisite.skill.name} ← ${invalidPrerequisite.name}`);
    }
    const definitions = skills.map((skill) => ({
      id: idByName.get(skill.name.trim().toLocaleLowerCase("ko-KR"))!,
      name: skill.name.trim(),
      prerequisiteIds: skill.prerequisites
        .map((name) => idByName.get(name.trim().toLocaleLowerCase("ko-KR")))
        .filter((id): id is string => Boolean(id)),
      mastery: 0.05,
      uncertainty: 0.95,
    }));
    const subject: Subject = {
      id: subjectId,
      name: blueprint.subjectName.trim() || "새 과목",
      aliases: [blueprint.subjectName.trim()].filter(Boolean),
      role: blueprint.role,
      dailyTargetMinutes: Math.min(120, Math.max(10, Math.round(blueprint.dailyMinutes || 30))),
      weeklyTargetMinutes: Math.min(120, Math.max(10, Math.round(blueprint.dailyMinutes || 30))) * 7,
      minimumTouchMinutes: blueprint.role === "main" ? 30 : 10,
      priorityBoost: blueprint.role === "main" ? 0.8 : 0,
      active: true,
    };
    const graph = createSkillGraph(subjectId, definitions);
    return {
      subject,
      graph,
      goals: [{
        id: `${subjectId}-goal`,
        subjectId,
        text: blueprint.goal,
        successEvidence: blueprint.successEvidence,
        priority: blueprint.role === "main" ? 1 : 0.7,
      }],
      gaps: blueprint.unknownSummary.trim()
        ? [{
            id: `${subjectId}-gap`,
            subjectId,
            rawText: blueprint.unknownSummary,
            linkedSkillIds: graph.nodes.map((node) => node.id),
            urgency: 0.85,
            status: "new" as const,
          }]
        : [],
      documents: [
        {
          name: "전체 과목과 시간 제약",
          kind: "schedule",
          excerpt: JSON.stringify({
            defaultReadyAt: learning.schedulePolicy.defaultReadyAt,
            learningDeadline: learning.schedulePolicy.learningDeadline,
            gameTime: `${learning.schedulePolicy.gameStart}-${learning.schedulePolicy.gameEnd}`,
            maxSessionMinutes: learning.schedulePolicy.maxSessionMinutes,
            dayOverrides: learning.schedulePolicy.dayOverrides ?? [],
            constraintsSummary: learning.schedulePolicy.constraintsSummary ?? "",
            existingSubjects: learning.subjects.map((item) => ({
              name: item.name,
              role: item.role,
              dailyTargetMinutes: item.dailyTargetMinutes,
              priorityBoost: item.priorityBoost,
            })),
          }),
        },
        {
          name: "딥 인터뷰 기록",
          kind: "interview",
          excerpt: messages.map((message) => `${message.role}: ${message.content}`).join("\n"),
        },
      ],
    };
  };

  const sendInterviewMessage = async (rawText: string): Promise<boolean> => {
    const content = rawText.trim();
    if (!content) return false;
    const userMessage: InterviewMessage = {
      id: uid("interview-message"),
      role: "user",
      content,
    };
    const transcript = [...envelope.interview.messages, userMessage].map(({ role, content: text }) => ({
      role,
      content: text,
    }));
    try {
      const scheduleConfigured = learning.schedulePolicy.configuredBy === "ai-interview"
        || learning.schedulePolicy.configuredBy === "manual";
      const defaultReadyAt = learning.schedulePolicy.defaultReadyAt ?? envelope.checkIn.readyAt;
      const availableMinutes = Math.max(
        0,
        minutesFromClock(learning.schedulePolicy.learningDeadline)
          - minutesFromClock(defaultReadyAt)
          - learning.schedulePolicy.wrapUpMinutes,
      );
      const { payload } = await invokeAI<InterviewPayload>(
        "interview",
        buildInterviewPrompt(transcript, envelope.interview.blueprint, {
          availableMinutes,
          configured: scheduleConfigured,
          defaultReadyAt,
          learningDeadline: learning.schedulePolicy.learningDeadline,
          gameStart: learning.schedulePolicy.gameStart,
          gameEnd: learning.schedulePolicy.gameEnd,
          protectGameTime: envelope.preferences.protectGameTime,
          wrapUpMinutes: learning.schedulePolicy.wrapUpMinutes,
          maxSessionMinutes: learning.schedulePolicy.maxSessionMinutes,
          dayOverrides: learning.schedulePolicy.dayOverrides ?? [],
          constraintsSummary: learning.schedulePolicy.constraintsSummary ?? "",
          notes: `먼저 배우고 싶은 과목과 원하는 도달 수준을 확정한다. 현재 실력은 테스트로 판단하므로 자기보고 인터뷰를 길게 끌지 않는다. 최초 등록이고 일정이 미확정이면 실제 학습 시작·종료·게임·요일 예외를 한 번에 조사한다. 이미 등록된 과목명: ${learning.subjects.map((subject) => subject.name).join(", ") || "없음"}. 같은 이름이면 새 범위를 구체화할지 기존 과목을 이어갈지 확인한다.`,
        }),
        "interview",
        "과목과 도달 목표를 확인하는 중",
        isInterviewPayload,
      );
      const followUps = payload.followUpQuestions
        .filter((question) => question.trim() && !payload.assistantMessage.includes(question.trim()))
        .slice(0, 1);
      const assistantMessage: InterviewMessage = {
        id: uid("interview-message"),
        role: "assistant",
        content: [
          payload.assistantMessage.trim(),
          followUps.length ? followUps.map((question, index) => `${index + 1}. ${question}`).join("\n") : "",
        ].filter(Boolean).join("\n\n"),
      };
      const groundedBlueprint = Boolean(
        payload.subjectBlueprint.subjectName.trim()
        && payload.subjectBlueprint.goal.trim(),
      );
      const completeSchedule = isCompleteInterviewSchedule(payload.scheduleRecommendation)
        ? payload.scheduleRecommendation
        : undefined;
      const readyForTest = payload.readyForDiagnostic && groundedBlueprint && Boolean(completeSchedule);
      commit((current) => {
        const nextPolicy = completeSchedule
          ? {
              ...current.learning.schedulePolicy,
              configuredBy: "ai-interview" as const,
              defaultReadyAt: completeSchedule.defaultReadyAt,
              learningDeadline: completeSchedule.learningDeadline,
              wrapUpMinutes: completeSchedule.wrapUpMinutes,
              gameStart: completeSchedule.protectGameTime
                ? completeSchedule.gameStart!
                : completeSchedule.learningDeadline,
              gameEnd: completeSchedule.protectGameTime
                ? completeSchedule.gameEnd!
                : completeSchedule.learningDeadline,
              maxSessionMinutes: completeSchedule.maxSessionMinutes,
              dayOverrides: completeSchedule.dayOverrides,
              constraintsSummary: completeSchedule.constraintsSummary,
            }
          : current.learning.schedulePolicy;
        const initialWindow = completeSchedule
          ? resolveScheduleWindow(nextPolicy, current.checkIn.date)
          : undefined;
        return {
          ...current,
          learning: completeSchedule
            ? { ...current.learning, schedulePolicy: nextPolicy }
            : current.learning,
          checkIn: completeSchedule && !scheduleConfigured && initialWindow
            ? {
                ...current.checkIn,
                readyAt: initialWindow.studyEnabled ? initialWindow.readyAt : initialWindow.learningDeadline,
                fatigue: 2,
              }
            : current.checkIn,
          preferences: completeSchedule
            ? { ...current.preferences, protectGameTime: completeSchedule.protectGameTime }
            : current.preferences,
          interview: {
            ...current.interview,
            status: readyForTest ? "ready" : "interview",
            readiness: clampUnit(payload.readiness),
            blueprint: payload.subjectBlueprint,
            scheduleRecommendation: payload.scheduleRecommendation,
            messages: [...current.interview.messages, userMessage, assistantMessage],
          },
        };
      });
      return true;
    } catch (error) {
      notify("error", "과목 등록 대화 생성 실패", error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const startInterviewDiagnostic = async () => {
    const blueprint = envelope.interview.blueprint;
    if (!blueprint) return;
    const duplicateSubject = learning.subjects.find(
      (subject) => subject.name.trim().toLocaleLowerCase("ko-KR") === blueprint.subjectName.trim().toLocaleLowerCase("ko-KR"),
    );
    if (duplicateSubject) {
      commit((current) => ({
        ...current,
        interview: {
          ...current.interview,
          status: "interview",
          messages: [...current.interview.messages, {
            id: uid("interview-message"),
            role: "assistant",
            content: `“${duplicateSubject.name}”은 이미 등록되어 있습니다. 기존 과목을 더 파고들려는 것인지, 별도 캠페인이라면 어떤 범위인지 한 문장으로 구분해주세요.`,
          }],
        },
      }));
      return;
    }
    try {
      const context = blueprintContext(blueprint);
      const { payload } = await invokeAI<AIDiagnosticPayload>(
        "diagnostic",
        buildDiagnosticPrompt(context),
        "diagnostic",
        `${blueprint.subjectName} 현재 수준 테스트 제작 중`,
        isAIDiagnosticPayload,
      );
      const questions = payload.questions
        .filter((question) => question.prompt.trim())
        .slice(0, 8)
        .map((question, index) => ({
           id: `interview-q-${index + 1}-${uid("probe")}`,
           concept: question.concept,
           skillName: question.skillName,
           prompt: question.prompt,
          difficulty: clampUnit(question.difficulty / 5),
          evaluationGuide: question.evaluationGuide,
        }));
      if (!questions.length) throw new Error("AI가 진단 문항을 만들지 못했습니다.");
      commit((current) => ({
        ...current,
        interview: {
          ...current.interview,
          status: "diagnostic",
          diagnosticTitle: payload.title,
          diagnosticOverview: payload.overview,
          questions,
          answers: {},
          messages: [
            ...current.interview.messages,
            {
              id: uid("interview-message"),
              role: "assistant",
              content: `${payload.overview}\n\n이제 ${questions.length}개의 수행형 질문으로 실제 시작점을 확인하겠습니다. 점수는 직접 고르지 않아도 됩니다.`,
            },
          ],
        },
      }));
    } catch (error) {
      notify("error", "현재 수준 테스트 생성 실패", error instanceof Error ? error.message : String(error));
    }
  };

  const completeInterviewDiagnostic = async () => {
    const { blueprint, questions, answers } = envelope.interview;
    if (!blueprint || !questions.length) return;
    if (questions.some((question) => !answers[question.id]?.trim())) {
      notify("error", "답안이 비어 있습니다", "모든 문항에 자신의 말·수식·코드로 답해주세요.");
      return;
    }
    const draftContext = blueprintContext(blueprint);
    const draftSkillByName = new Map(
      draftContext.graph.nodes.map((node) => [node.name.trim().toLocaleLowerCase("ko-KR"), node]),
    );
    if (questions.some((question) => !draftSkillByName.has(question.skillName.trim().toLocaleLowerCase("ko-KR")))) {
      notify("error", "진단 스킬 연결 오류", "AI 문항이 인터뷰에서 확정한 스킬 이름과 정확히 연결되지 않았습니다. 진단을 다시 생성해주세요.");
      return;
    }
    const skillFor = (skillName: string) => draftSkillByName.get(skillName.trim().toLocaleLowerCase("ko-KR"))!;
    const diagnostic: Diagnostic = {
      id: uid("interview-diagnostic"),
      subjectId: draftContext.subject.id,
      targetSkillIds: questions.map((question) => skillFor(question.skillName).id),
      questions: questions.map((question) => ({
        id: question.id,
        skillId: skillFor(question.skillName).id,
        prompt: question.prompt,
        difficulty: question.difficulty,
      })),
      status: "ready",
      results: [],
    };

    try {
      const { payload, result: evaluationResult } = await invokeAI<AIEvaluationPayload>(
        "evaluation",
        buildDiagnosticEvaluationPrompt(draftContext, diagnostic, answers),
        "evaluation",
        `${blueprint.subjectName} 답안을 채점하고 학습 체계를 만드는 중`,
        isEvaluationPayload,
      );
      const evaluationItemsById = new Map(payload.items.map((item) => [item.id, item]));
      if (
        evaluationItemsById.size !== questions.length
        || payload.items.length !== questions.length
        || questions.some((question) => !evaluationItemsById.has(question.id))
      ) {
        throw new Error("AI 평가가 모든 진단 문항의 id를 정확히 반환하지 않았습니다.");
      }
      const curriculumContext = {
        ...draftContext,
        gaps: [
          ...draftContext.gaps,
          ...payload.gaps.map((gap, index) => ({
            id: `${draftContext.subject.id}-evaluated-gap-${index + 1}`,
            subjectId: draftContext.subject.id,
            rawText: gap,
            linkedSkillIds: draftContext.graph.nodes.map((node) => node.id),
            urgency: 0.9,
            status: "new" as const,
          })),
        ],
        documents: [
          ...draftContext.documents,
          {
            name: "AI 진단 평가",
            kind: "diagnostic-evaluation",
            excerpt: JSON.stringify({
              overallFeedback: payload.overallFeedback,
              strengths: payload.strengths,
              gaps: payload.gaps,
              nextProbe: payload.nextProbe,
            }),
          },
        ],
      };
      const { payload: curriculumPayload, result: curriculumResult } = await invokeAI<AICurriculumPayload>(
        "curriculum",
        buildCurriculumPrompt(curriculumContext, learning.curriculum),
        "curriculum",
        `${blueprint.subjectName} 맞춤 7일 커리큘럼 제작 중`,
        isAICurriculumPayload,
      );
      assertAICurriculumReferences(
        curriculumPayload,
        draftContext.graph.nodes.map((node) => node.name),
      );
      const baseId = slug(blueprint.subjectName);
      const subjectId = learning.subjects.some((subject) => subject.id === baseId)
        ? `${baseId}-${Date.now().toString(36)}`
        : baseId;
      let next = registerSubject(learning, {
          id: subjectId,
          name: blueprint.subjectName.trim(),
          aliases: [blueprint.subjectName.trim()],
          role: blueprint.role,
          dailyTargetMinutes: Math.min(120, Math.max(10, Math.round(blueprint.dailyMinutes || 30))),
          minimumTouchMinutes: blueprint.role === "main" ? 30 : 10,
        });
        const draftNodes = draftContext.graph.nodes;
        const idMap = new Map(draftNodes.map((node, index) => [node.id, `${subjectId}-skill-${index + 1}-${slug(node.name)}`]));
        const graph = createSkillGraph(subjectId, draftNodes.map((node) => ({
          id: idMap.get(node.id)!,
          name: node.name,
          prerequisiteIds: node.prerequisiteIds.map((id) => idMap.get(id)).filter((id): id is string => Boolean(id)),
          mastery: 0.05,
          uncertainty: 0.95,
        })));
        next = upsertSkillGraph(next, graph);
        next = recordLearningIntent(next, {
          id: uid("intent"),
          subjectId,
          goalText: blueprint.goal,
          successEvidence: blueprint.successEvidence,
          unknownText: [blueprint.unknownSummary, ...payload.gaps].filter(Boolean).join("\n"),
          linkedSkillIds: graph.nodes.map((node) => node.id),
          priority: blueprint.role === "main" ? 1 : 0.7,
        });
        const realSkillByName = new Map(
          graph.nodes.map((node) => [node.name.trim().toLocaleLowerCase("ko-KR"), node]),
        );
        const realSkillFor = (skillName: string) => realSkillByName.get(skillName.trim().toLocaleLowerCase("ko-KR"))!;
        const realDiagnostic: Diagnostic = {
          ...diagnostic,
          subjectId,
          targetSkillIds: questions.map((question) => realSkillFor(question.skillName).id),
          questions: questions.map((question) => ({
            id: question.id,
            skillId: realSkillFor(question.skillName).id,
            prompt: question.prompt,
            difficulty: question.difficulty,
          })),
        };
        next = { ...next, diagnostics: [...next.diagnostics, realDiagnostic] };
        next = scoreDiagnostic(next, realDiagnostic.id, questions.map((question) => {
          const item = evaluationItemsById.get(question.id)!;
          return {
            questionId: question.id,
            score: clampUnit(item.score),
            confidence: clampUnit(item.confidence),
          };
        }));
        if (blueprint.knownSummary.trim()) {
          next = {
            ...next,
            resources: [...next.resources, {
              id: uid("self-report"),
              subjectId,
              kind: "note",
              title: "과목 등록 대화 — 이미 알고 있는 것",
              currentSection: blueprint.knownSummary.trim(),
            }],
          };
        }
        const registeredSubject = next.subjects.find((subject) => subject.id === subjectId)!;
        next = installAICurriculum(next, registeredSubject, curriculumPayload, curriculumResult.provider);
      commit((current) => ({
          ...current,
          learning: next,
          selectedSubjectId: subjectId,
          selectedQuestId: next.curriculum?.days[0]?.quests[0]?.id,
          interview: createInitialInterview(),
      }));
      notify(
        "success",
        `${blueprint.subjectName} 학습 체계를 만들었습니다`,
        `${providerLabel(evaluationResult.provider)}가 진단하고 ${providerLabel(curriculumResult.provider)}가 7일 커리큘럼을 만들었습니다.`,
      );
      setView("today");
    } catch (error) {
      notify("error", "AI 진단 평가 실패", error instanceof Error ? error.message : String(error));
    }
  };

  const generateAIDiagnostic = async (subject: Subject) => {
    if (!learning.skillGraphs.find((graph) => graph.subjectId === subject.id)?.nodes.length) {
      notify("error", "진단을 만들 수 없습니다", "이 과목의 스킬 그래프가 없습니다. 새 과목 인터뷰에서 범위를 다시 잡아주세요.");
      return;
    }
    try {
      const { payload, result } = await invokeAI<AIDiagnosticPayload>(
        "diagnostic",
        buildDiagnosticPrompt(subjectContext(subject)),
        "diagnostic",
        `${subject.name} 진단 테스트 제작 중`,
        isAIDiagnosticPayload,
      );
      const currentGraph = learning.skillGraphs.find((graph) => graph.subjectId === subject.id)!;
      const currentSkillNames = new Set(
        currentGraph.nodes.map((node) => node.name.trim().toLocaleLowerCase("ko-KR")),
      );
      if (payload.questions.some((question) => !currentSkillNames.has(question.skillName.trim().toLocaleLowerCase("ko-KR")))) {
        throw new Error("AI 진단 문항의 skillName이 현재 스킬 그래프와 일치하지 않습니다.");
      }
      commit((current) => {
        const graph = current.learning.skillGraphs.find((item) => item.subjectId === subject.id);
        if (!graph?.nodes.length) return current;
        const diagnosticId = uid(`ai-diagnostic-${subject.id}`);
        const questions = payload.questions
          .filter((question) => question?.prompt?.trim())
          .slice(0, 8);
        const skillByName = new Map(
          graph.nodes.map((node) => [node.name.trim().toLocaleLowerCase("ko-KR"), node]),
        );
        const skillFor = (skillName: string) => skillByName.get(skillName.trim().toLocaleLowerCase("ko-KR"))!;
        const diagnostic: Diagnostic = {
          id: diagnosticId,
          subjectId: subject.id,
          targetSkillIds: questions.map((question) => skillFor(question.skillName).id),
          questions: questions.map((question, index) => ({
            id: `${diagnosticId}-q-${index + 1}`,
            skillId: skillFor(question.skillName).id,
            prompt: question.prompt,
            difficulty: clampUnit(question.difficulty / 5),
          })),
          status: "ready",
          results: [],
        };
        return {
          ...current,
          learning: {
            ...current.learning,
            stage: "diagnostic",
            diagnostics: [...current.learning.diagnostics, diagnostic],
          },
        };
      });
      notify("success", `${providerLabel(result.provider)} 진단 완성`, payload.overview);
      setView("diagnostic");
    } catch (error) {
      notify("error", "AI 진단 생성 실패", error instanceof Error ? error.message : String(error));
    }
  };

  const generateAICurriculum = async (subject: Subject) => {
    try {
      const { payload, result } = await invokeAI<AICurriculumPayload>(
        "curriculum",
        buildCurriculumPrompt(subjectContext(subject), learning.curriculum),
        "curriculum",
        `${subject.name} 7일 커리큘럼 제작 중`,
        isAICurriculumPayload,
      );
      assertAICurriculumReferences(
        payload,
        learning.skillGraphs.find((graph) => graph.subjectId === subject.id)?.nodes.map((node) => node.name) ?? [],
      );
      const preparedLearning = installAICurriculum(learning, subject, payload, result.provider);
      commit((current) => ({ ...current, learning: preparedLearning }));
      notify("success", "AI 커리큘럼 반영 완료", `${payload.title} · ${payload.strategy}`);
      setView("curriculum");
    } catch (error) {
      notify("error", "AI 커리큘럼 생성 실패", error instanceof Error ? error.message : String(error));
    }
  };

  const generateAILesson = async (quest: Quest) => {
    const subject = learning.subjects.find((item) => item.id === quest.primarySubjectId);
    if (!subject) return;
    try {
      const { payload, result } = await invokeAI<GeneratedLesson>(
        "lesson",
        buildLessonPrompt(subjectContext(subject), quest, 30),
        "lesson",
        `${quest.title} 라이브 강의 제작 중`,
      );
      const skill = learning.skillGraphs
        .flatMap((graph) => graph.nodes)
        .find((node) => quest.skillIds.includes(node.id));
      const normalizedLesson = normalizeGeneratedLesson(payload, localLesson(quest, skill));
      commit((current) => ({
        ...current,
        generatedLessons: {
          ...current.generatedLessons,
          [quest.id]: { ...normalizedLesson, generatedBy: result.provider },
        },
      }));
      notify("success", "AI 강의가 준비됐습니다", `${providerLabel(result.provider)}가 30분 수업을 구성했습니다.`);
    } catch (error) {
      notify("error", "AI 강의 생성 실패", error instanceof Error ? error.message : String(error));
    }
  };

  const completeDiagnostic = async (
    diagnosticId: string,
    answers: DiagnosticAnswerMap,
  ) => {
    const diagnostic = learning.diagnostics.find((item) => item.id === diagnosticId);
    if (!diagnostic) return;
    const subject = learning.subjects.find((item) => item.id === diagnostic.subjectId);
    if (!subject) return;

    let results: DiagnosticResult[];
    let feedback: string;
    try {
      const { payload, result } = await invokeAI<AIEvaluationPayload>(
        "evaluation",
        buildDiagnosticEvaluationPrompt(subjectContext(subject), diagnostic, answers),
        "evaluation",
        `${subject.name} 진단 답안 채점 중`,
        isEvaluationPayload,
      );
      const itemById = new Map(payload.items.map((item) => [item.id, item]));
      if (
        itemById.size !== diagnostic.questions.length
        || payload.items.length !== diagnostic.questions.length
        || diagnostic.questions.some((question) => !itemById.has(question.id))
      ) {
        throw new Error("AI 평가가 모든 진단 문항의 id를 정확히 반환하지 않았습니다.");
      }
      results = diagnostic.questions.map((question) => {
        const item = itemById.get(question.id)!;
        return {
          questionId: question.id,
          score: clampUnit(item.score),
          confidence: clampUnit(item.confidence),
        };
      });
      feedback = `${providerLabel(result.provider)}: ${payload.overallFeedback} 다음 탐침: ${payload.nextProbe}`;
    } catch (error) {
      notify("error", "AI 채점 실패", error instanceof Error ? error.message : String(error));
      return;
    }

    const scored = rebuildAdaptivePlan(scoreDiagnostic(learning, diagnosticId, results));
    commit((current) => ({ ...current, learning: scored }));
    try {
      const scoredSubject = scored.subjects.find((item) => item.id === subject.id)!;
      const { payload: curriculumPayload, result: curriculumResult } = await invokeAI<AICurriculumPayload>(
        "curriculum",
        buildCurriculumPrompt(subjectContext(scoredSubject, scored), scored.curriculum),
        "curriculum",
        `${subject.name} 진단 결과로 7일 계획 갱신 중`,
        isAICurriculumPayload,
      );
      assertAICurriculumReferences(
        curriculumPayload,
        scored.skillGraphs.find((graph) => graph.subjectId === subject.id)?.nodes.map((node) => node.name) ?? [],
      );
      const replanned = installAICurriculum(scored, scoredSubject, curriculumPayload, curriculumResult.provider);
      commit((current) => ({ ...current, learning: replanned }));
      notify("success", "AI 진단과 7일 재계획 완료", feedback);
    } catch (error) {
      notify("error", "진단은 저장했지만 AI 재계획에 실패했습니다", error instanceof Error ? error.message : String(error));
    }
    setView("curriculum");
  };

  const submitQuestEvidence = async (
    quest: Quest,
    note: string,
    selfRubric: LearningEvidence["rubric"],
    useAI: boolean,
  ) => {
    const subject = learning.subjects.find((item) => item.id === quest.primarySubjectId);
    if (!subject) return;
    let rubric = selfRubric;
    let feedback = "증거를 저장하고 숙련도·다음 7일 계획을 자동 갱신했습니다.";

    if (useAI) {
      try {
        const { payload, result } = await invokeAI<AIEvaluationPayload>(
          "evaluation",
          buildEvidenceEvaluationPrompt(subjectContext(subject), quest, {
            content: note,
            selfRubric,
          }),
          "evaluation",
          `${quest.title} 제출물 평가 중`,
          isEvaluationPayload,
        );
        const byId = new Map(payload.items.map((item) => [item.id, item.score]));
        const rubricIds = ["correctness", "independence", "transfer", "explanation"] as const;
        if (
          byId.size !== rubricIds.length
          || payload.items.length !== rubricIds.length
          || rubricIds.some((id) => !byId.has(id))
        ) {
          throw new Error("AI 평가가 네 가지 제출 기준을 정확히 반환하지 않았습니다.");
        }
        if (!payload.passed) {
          notify("error", "아직 완료 조건에 못 미쳤습니다", `${payload.overallFeedback} 다음 탐침: ${payload.nextProbe}`);
          return;
        }
        const scoreAt = (id: typeof rubricIds[number]) => clampUnit(byId.get(id)!);
        rubric = {
          correctness: scoreAt("correctness"),
          independence: scoreAt("independence"),
          transfer: scoreAt("transfer"),
          explanation: scoreAt("explanation"),
        };
        feedback = `${providerLabel(result.provider)}: ${payload.overallFeedback} 다음 탐침: ${payload.nextProbe}`;
      } catch (error) {
        notify("error", "AI 제출물 평가 실패", error instanceof Error ? error.message : String(error));
        return;
      }
    }

    const taggedSkillIds = learning.skillGraphs
      .filter((graph) => quest.taggedSubjectIds.includes(graph.subjectId))
      .map((graph) => [...graph.nodes].sort((left, right) => right.uncertainty - left.uncertainty)[0]?.id)
      .filter((id): id is string => Boolean(id));
    const evidence: LearningEvidence = {
      id: uid("evidence"),
      questId: quest.id,
      skillIds: [...new Set([...quest.skillIds, ...taggedSkillIds])],
      type: quest.kind === "authoring" ? "manuscript" : "answer",
      content: note,
      submittedOn: localIsoDate(),
      rubric,
    };
    const evidenced = rebuildAdaptivePlan(submitEvidence(learning, evidence));
    commit((current) => ({ ...current, learning: evidenced }));
    if (useAI) {
      try {
        const evidencedSubject = evidenced.subjects.find((item) => item.id === subject.id)!;
        const { payload: curriculumPayload, result: curriculumResult } = await invokeAI<AICurriculumPayload>(
          "curriculum",
          buildCurriculumPrompt(subjectContext(evidencedSubject, evidenced), evidenced.curriculum),
          "curriculum",
          `${subject.name} 제출 증거로 다음 7일 갱신 중`,
          isAICurriculumPayload,
        );
        assertAICurriculumReferences(
          curriculumPayload,
          evidenced.skillGraphs.find((graph) => graph.subjectId === subject.id)?.nodes.map((node) => node.name) ?? [],
        );
        const replanned = installAICurriculum(evidenced, evidencedSubject, curriculumPayload, curriculumResult.provider);
        commit((current) => ({ ...current, learning: replanned }));
        notify("success", "퀘스트 완료와 AI 자동 재계획", feedback);
      } catch (error) {
        notify("error", "증거는 저장했지만 AI 재계획에 실패했습니다", error instanceof Error ? error.message : String(error));
      }
    } else {
      notify("success", "퀘스트 완료", feedback);
    }
    setView("today");
  };

  const handleCommand = (rawText: string) => {
    try {
      const result = processNaturalLanguageFeedback(learning, rawText);
      commit((current) => ({
        ...current,
        learning: result.state,
        checkIn: {
          ...current.checkIn,
          ...(result.boost.fatigueOverride ? { fatigue: result.boost.fatigueOverride } : {}),
          ...(result.boost.readyAtOverride ? { readyAt: result.boost.readyAtOverride } : {}),
        },
      }));
      const changes = result.boost.subjectAdjustments
        .map((item) => {
          const subject = learning.subjects.find((candidate) => candidate.id === item.subjectId);
          return `${subject?.name ?? item.subjectId} ${item.minutesDelta > 0 ? "+" : ""}${item.minutesDelta}분`;
        })
        .join(" · ");
      notify("success", "학습 정책을 조정했습니다", changes || "오늘의 상태와 모르는 점을 기록했습니다.");
    } catch (error) {
      notify("error", "명령을 반영하지 못했습니다", error instanceof Error ? error.message : String(error));
    }
  };

  const importDocuments = async () => {
    if (!selectedSubject || !window.studyQuest) return;
    const files = await window.studyQuest.files.pickDocuments();
    if (!files.length) return;
    commit((current) => ({
      ...current,
      importedDocuments: [
        ...current.importedDocuments,
        ...files.map((file) => ({ ...file, id: uid("document"), subjectId: selectedSubject.id })),
      ],
      learning: {
        ...current.learning,
        resources: [
          ...current.learning.resources,
          ...files.map((file) => ({
            id: uid("resource"),
            subjectId: selectedSubject.id,
            kind: selectedSubject.role === "main" ? ("manuscript" as const) : ("note" as const),
            title: file.name,
            uri: file.path,
          })),
        ],
      },
    }));
    const extracted = files.filter((file) => file.extractionStatus === "ready").length;
    notify(
      "success",
      "자료를 등록했습니다",
      `${files.length}개 중 ${extracted}개는 본문을 추출해 다음 AI 진단·강의 문맥에 연결했습니다.`,
    );
  };

  const resetState = () => {
    setEnvelope((current) => {
      const next = createInitialEnvelope();
      return current ? {
        ...next,
        errorLog: current.errorLog,
        preferences: {
          ...current.preferences,
          setupCompleted: true,
        },
      } : next;
    });
    setView("onboarding");
    notify("success", "학습 상태를 비웠습니다", "등록 과목 없이 새 학습 과목 등록 화면으로 돌아왔습니다.");
  };

  const learningNavItems: Array<{ id: ViewId; label: string; icon: ReactNode; badge?: number }> =
    learning.subjects.length
      ? [
          { id: "today", label: "오늘의 퀘스트", icon: <LayoutDashboard size={18} />, badge: totalToday - completedToday },
          { id: "subjects", label: "과목과 캠페인", icon: <LibraryBig size={18} />, badge: learning.subjects.length },
          { id: "diagnostic", label: "진단 센터", icon: <ListChecks size={18} /> },
          { id: "graph", label: "스킬 그래프", icon: <Network size={18} /> },
          { id: "curriculum", label: "7일 커리큘럼", icon: <CalendarDays size={18} /> },
          { id: "lesson", label: "라이브 강의", icon: <GraduationCap size={18} /> },
        ]
      : [];
  const navItems: Array<{ id: ViewId; label: string; icon: ReactNode; badge?: number }> = [
    { id: "onboarding", label: learning.subjects.length ? "새 학습 과목 등록" : "학습 과목 등록", icon: <BrainCircuit size={18} /> },
    ...learningNavItems,
    { id: "settings", label: "AI와 설정", icon: <Settings size={18} /> },
  ];

  const pageTitle: Record<ViewId, string> = {
    onboarding: "학습 과목 등록",
    today: "오늘의 퀘스트",
    subjects: "과목과 캠페인",
    diagnostic: "진단 센터",
    graph: "스킬 관계 그래프",
    curriculum: "7일 커리큘럼",
    lesson: "라이브 강의",
    settings: "AI와 포터블 설정",
  };

  return (
    <div className="app-shell" data-theme={envelope.preferences.theme}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><BrainCircuit size={21} /></div>
          <div className="brand-copy">
            <strong>StudyQuest</strong>
            <span>Dynamic learning OS</span>
          </div>
        </div>
        <nav className="sidebar-nav" aria-label="주 메뉴">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`nav-button${view === item.id ? " is-active" : ""}`}
              aria-label={item.label}
              title={item.label}
              onClick={() => setView(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.badge !== undefined && <span className="nav-badge">{item.badge}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="provider-mini">
          <span className="provider-mini-title">AI Router</span>
          <div className="provider-row">
            <span>Codex CLI</span>
            <strong>{providerStatus.codex.available ? "1/1" : "0/1"}</strong>
          </div>
          <div className="provider-row">
            <span>Claude Agent</span>
            <strong>{providerStatus.claude.available ? "1/1" : "0/1"}</strong>
          </div>
          <div className="provider-row">
            <span>개인 API</span>
            <strong>{[providerStatus.openai, providerStatus.anthropic, providerStatus.deepseek].filter((item) => item.available).length}/3</strong>
          </div>
        </div>
        <div className="sidebar-footnote"><ShieldCheck size={12} /><span>포터블 폴더 로컬 저장</span></div>
      </aside>

      <main className="main-column">
        <header className="topbar">
          <div className="topbar-left">
            <strong>{pageTitle[view]}</strong>
            <span>{formatDate(today, true)} · 현재 {currentTime()}</span>
          </div>
          <div className="topbar-stats">
            {learning.subjects.length ? (
              <>
                <div className="stat-chip"><Clock3 size={14} /><span>{schedule?.deadline ?? learning.schedulePolicy.learningDeadline}까지</span><strong>{formatMinutes(schedule?.availableStudyMinutes ?? 0)}</strong></div>
                <div className="stat-chip"><Flame size={14} /><span>완료</span><strong>{completedToday}/{totalToday}</strong></div>
              </>
            ) : (
              <>
                <div className="stat-chip"><BrainCircuit size={14} /><span>등록 준비</span><strong>{Math.round(envelope.interview.readiness * 100)}%</strong></div>
                <div className="stat-chip"><LibraryBig size={14} /><span>등록 과목</span><strong>0</strong></div>
              </>
            )}
            <div className="stat-chip"><Zap size={14} /><span>AI 토큰</span><strong>{tokenTotal.toLocaleString()}</strong></div>
            <button
              className="button icon-only theme-toggle"
              aria-label={envelope.preferences.theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
              title={envelope.preferences.theme === "dark" ? "라이트 모드" : "다크 모드"}
              onClick={() => commit((current) => ({
                ...current,
                preferences: {
                  ...current.preferences,
                  theme: current.preferences.theme === "dark" ? "light" : "dark",
                },
              }))}
            >
              {envelope.preferences.theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </header>

        <div className="page-scroll">
          {view === "onboarding" && (
            <OnboardingPage
              interview={envelope.interview}
              subjects={learning.subjects}
              schedulePolicy={learning.schedulePolicy}
              protectGameTime={envelope.preferences.protectGameTime}
              providerStatus={providerStatus}
              onSend={sendInterviewMessage}
              onStartDiagnostic={startInterviewDiagnostic}
              onUpdateAnswer={(questionId, answer) => commit((current) => ({
                ...current,
                interview: {
                  ...current.interview,
                  answers: { ...current.interview.answers, [questionId]: answer },
                },
              }))}
              onCompleteDiagnostic={completeInterviewDiagnostic}
              onReset={() => commit((current) => ({ ...current, interview: createInitialInterview() }))}
            />
          )}
          {view === "today" && (
            <TodayPage
              envelope={envelope}
              schedule={schedule}
              currentDay={todayCurriculum}
              onChangeCheckIn={(checkIn) => commit((current) => ({ ...current, checkIn }))}
              onSelectQuest={selectQuest}
              onOpenCurriculum={() => setView("curriculum")}
            />
          )}
          {view === "subjects" && (
            <SubjectsPage
              envelope={envelope}
              selectedSubject={selectedSubject}
              onSelect={(subject) => commit((current) => ({ ...current, selectedSubjectId: subject.id }))}
              onAdd={() => setView("onboarding")}
              onDiagnose={generateAIDiagnostic}
              onCurriculum={generateAICurriculum}
              onImport={importDocuments}
              onBoost={(subject) => handleCommand(`이번 주 ${subject.name} 부스트해줘`)}
              onUpdateDocumentExcerpt={(documentId, excerpt) => commit((current) => ({
                ...current,
                importedDocuments: current.importedDocuments.map((document) =>
                  document.id === documentId
                    ? {
                        ...document,
                        excerpt,
                        extractedChars: excerpt.length,
                        extractionStatus: excerpt.trim() ? "ready" : document.extractionStatus,
                        warning: excerpt.trim() ? undefined : document.warning,
                      }
                    : document,
                ),
              }))}
            />
          )}
          {view === "diagnostic" && (
            <DiagnosticPage
              envelope={envelope}
              selectedSubject={selectedSubject}
              transcriptionAvailable={providerStatus.openai.available}
              onSelectSubject={(subjectId) => commit((current) => ({ ...current, selectedSubjectId: subjectId }))}
              onCreateAI={() => selectedSubject && generateAIDiagnostic(selectedSubject)}
              onComplete={completeDiagnostic}
            />
          )}
          {view === "graph" && (
            <GraphPage
              envelope={envelope}
              onBoost={(skill) => {
                const subject = learning.subjects.find((item) => item.id === skill.subjectId);
                if (subject) handleCommand(`이번 주 ${subject.name} 부스트해줘. 모르는 점: ${skill.name}`);
              }}
            />
          )}
          {view === "curriculum" && (
            <CurriculumPage
              envelope={envelope}
              selectedSubject={selectedSubject}
              onSelectSubject={(subjectId) => commit((current) => ({ ...current, selectedSubjectId: subjectId }))}
              onRebuildLocal={() => {
                commit((current) => ({
                  ...current,
                  learning: installCurriculum(
                    current.learning,
                    generateSevenDayCurriculum(current.learning, localIsoDate()),
                  ),
                }));
                notify("success", "7일 계획을 다시 계산했습니다", "현재 숙련도, 부스트, 선수관계를 반영했습니다.");
              }}
              onGenerateAI={() => selectedSubject && generateAICurriculum(selectedSubject)}
              onSelectQuest={selectQuest}
            />
          )}
          {view === "lesson" && (
            <LessonPage
              envelope={envelope}
              quest={selectedQuest}
              transcriptionAvailable={providerStatus.openai.available}
              onSelectQuest={(questId) => commit((current) => ({ ...current, selectedQuestId: questId }))}
              onGenerateAI={() => selectedQuest && generateAILesson(selectedQuest)}
              onSubmit={submitQuestEvidence}
            />
          )}
          {view === "settings" && (
            <SettingsPage
              envelope={envelope}
              runtime={runtime}
              providerStatus={providerStatus}
              onRefreshProviders={refreshProviders}
              onUpdatePreferences={(preferences) => commit((current) => ({ ...current, preferences }))}
              onOpenSetup={() => commit((current) => ({
                ...current,
                preferences: { ...current.preferences, setupCompleted: false },
              }))}
              onClearErrorLog={() => commit((current) => ({ ...current, errorLog: [] }))}
              onReset={resetState}
            />
          )}
        </div>

        {view !== "onboarding" && view !== "settings" && view !== "lesson" && <CommandDock onSubmit={handleCommand} />}
      </main>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {busy && (
        <div className="loading-overlay">
          <div className="loading-card">
            <div className="spinner" />
            <strong>{busy.label}</strong>
            <p>{busy.detail}</p>
            <button
              className="button"
              onClick={() => {
                setBusy((current) => current ? { ...current, detail: "취소 요청을 보내고 있습니다…" } : current);
                void window.studyQuest?.ai.cancel(busy.requestId);
              }}
            >
              요청 취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: readonly ToastState[];
  onDismiss(toastId: string): void;
}) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast ${toast.kind}`}
          role={toast.kind === "error" ? "alert" : "status"}
        >
          {toast.kind === "success" ? <CheckCircle2 size={17} /> : <CircleAlert size={17} />}
          <div><strong>{toast.title}</strong><span>{toast.message}</span></div>
          <button
            type="button"
            className="toast-close"
            aria-label={`${toast.title} 알림 닫기`}
            onClick={() => onDismiss(toast.id)}
          >
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

function StateRecoveryPage({
  error,
  dataRoot,
  pending,
  recoveryFailure,
  onRetry,
  onRecover,
}: {
  error: string;
  dataRoot?: string;
  pending: boolean;
  recoveryFailure: string;
  onRetry(): void;
  onRecover(): void;
}) {
  return (
    <main className="first-run-page">
      <section className="first-run-shell state-recovery-shell">
        <header className="first-run-header">
          <div className="brand setup-brand">
            <div className="brand-mark"><BrainCircuit size={21} /></div>
            <div className="brand-copy"><strong>StudyQuest</strong><span>상태 파일 복구</span></div>
          </div>
          <span className="tag coral"><ShieldCheck size={13} /> 원본 보호 중</span>
        </header>
        <div className="first-run-body">
          <div className="setup-step state-recovery-step">
            <div className="state-recovery-mark"><CircleAlert size={28} /></div>
            <span className="eyebrow">Safe recovery</span>
            <h1>학습 파일을 바로 덮어쓰지 않았습니다.</h1>
            <p>저장된 JSON을 읽는 중 문제가 생겨 자동 저장을 멈췄습니다. 다시 읽거나, 원본을 별도 백업 파일로 보존한 뒤 빈 상태로 시작할 수 있습니다.</p>
            <div className="setup-panel state-recovery-detail">
              <strong>읽기 오류</strong>
              <p>{error}</p>
              <strong>데이터 폴더</strong>
              <p className="mono">{dataRoot ?? "현재 StudyQuest 데이터 폴더"}</p>
            </div>
            {recoveryFailure && <p className="setup-message error" role="alert">{recoveryFailure}</p>}
          </div>
        </div>
        <footer className="first-run-footer">
          <span>백업 버튼을 누르기 전에는 기존 파일을 이동하거나 삭제하지 않습니다.</span>
          <div className="button-row">
            <button className="button" disabled={pending} onClick={onRetry}><RefreshCw size={14} /> 다시 읽기</button>
            <button className="button primary" disabled={pending} onClick={onRecover}><ShieldCheck size={14} /> {pending ? "원본 백업 중…" : "원본 백업 후 새로 시작"}</button>
          </div>
        </footer>
      </section>
    </main>
  );
}

function FirstRunSetupPage({
  envelope,
  runtime,
  providerStatus,
  onRefreshProviders,
  onUpdatePreferences,
  onComplete,
}: {
  envelope: AppEnvelope;
  runtime: RuntimeInfo | null;
  providerStatus: ProviderStatus;
  onRefreshProviders(): Promise<void>;
  onUpdatePreferences(preferences: AppEnvelope["preferences"]): void;
  onComplete(): void;
}) {
  const [step, setStep] = useState(0);
  const [runtimeAction, setRuntimeAction] = useState("");
  const [runtimeMessage, setRuntimeMessage] = useState("");
  const readyProviders = (["codex", "claude", "openai", "anthropic", "deepseek"] as const)
    .filter((provider) => providerIsReady(provider, providerStatus));
  const hasReadyProvider = readyProviders.length > 0;
  const selectedProviderReady = preferenceIsReady(envelope.preferences.provider, providerStatus);

  const configureRuntime = async (
    action: string,
    request: () => Promise<RuntimeConfigurationResult>,
  ) => {
    if (!window.studyQuest || runtimeAction) return;
    setRuntimeAction(action);
    setRuntimeMessage("");
    try {
      const result = await request();
      if (result.canceled) return;
      if (!result.ok) {
        setRuntimeMessage(result.error || "설정을 저장하지 못했습니다.");
        return;
      }
      setRuntimeMessage(result.restarting
        ? "설정을 저장했습니다. 적용을 위해 앱을 다시 시작합니다."
        : "설정을 저장했습니다.");
      if (!result.restarting) await onRefreshProviders();
    } catch (error) {
      setRuntimeMessage(error instanceof Error ? error.message : "설정을 저장하지 못했습니다.");
    } finally {
      setRuntimeAction("");
    }
  };

  const nextFromConnections = () => {
    if (!hasReadyProvider) return;
    if (!selectedProviderReady) {
      onUpdatePreferences({ ...envelope.preferences, provider: "auto" });
    }
    setStep(2);
  };

  return (
    <main className="first-run-page">
      <section className="first-run-shell">
        <header className="first-run-header">
          <div className="brand setup-brand">
            <div className="brand-mark"><BrainCircuit size={21} /></div>
            <div className="brand-copy"><strong>StudyQuest</strong><span>첫 실행 설정</span></div>
          </div>
          <div className="setup-progress" aria-label={`초기 설정 ${step + 1}/3 단계`}>
            {["내 폴더", "AI 연결", "시작 확인"].map((label, index) => (
              <div className={index <= step ? "is-active" : ""} key={label}>
                <span>{index + 1}</span><b>{label}</b>
              </div>
            ))}
          </div>
        </header>

        <div className="first-run-body">
          {step === 0 && (
            <div className="setup-step">
              <span className="eyebrow">Portable first</span>
              <h1>학습을 시작하기 전에<br />내 저장 위치부터 확인할게요.</h1>
              <p>Windows 시스템 폴더는 건드리지 않습니다. 기본값은 압축을 푼 StudyQuest 폴더 안의 <code>data</code>이며, 앱 폴더를 지우면 함께 정리할 수 있습니다.</p>
              <div className="setup-grid">
                <div className="setup-panel">
                  <strong><Database size={16} /> 현재 데이터 저장 위치</strong>
                  <p className="mono">{runtime?.dataRoot ?? "앱 폴더\\data"}</p>
                  <span className={`tag ${runtime?.dataRootIsDefault !== false ? "mint" : "violet"}`}>{runtime?.dataRootIsDefault !== false ? "앱 내부 기본값" : "사용자 지정"}</span>
                  <div className="button-row section-gap">
                    <button className="button" disabled={Boolean(runtimeAction)} onClick={() => void configureRuntime("data-root", () => window.studyQuest!.runtime.pickDataRoot())}><FolderOpen size={14} /> 다른 폴더 선택</button>
                    {runtime?.dataRootIsDefault === false && <button className="button" disabled={Boolean(runtimeAction)} onClick={() => void configureRuntime("data-default", () => window.studyQuest!.runtime.useDefaultDataRoot())}><RotateCcw size={14} /> 기본값</button>}
                  </div>
                </div>
                <div className="setup-panel">
                  <strong><Sun size={16} /> 화면 모드</strong>
                  <p>지금 선택하고 나중에 설정에서 언제든 바꿀 수 있습니다.</p>
                  <div className="button-row section-gap">
                    <button className={`button${envelope.preferences.theme === "light" ? " primary" : ""}`} onClick={() => onUpdatePreferences({ ...envelope.preferences, theme: "light" })}><Sun size={14} /> 라이트</button>
                    <button className={`button${envelope.preferences.theme === "dark" ? " primary" : ""}`} onClick={() => onUpdatePreferences({ ...envelope.preferences, theme: "dark" })}><Moon size={14} /> 다크</button>
                  </div>
                </div>
              </div>
              {runtimeMessage && <p className="setup-message" role="status">{runtimeMessage}</p>}
            </div>
          )}

          {step === 1 && (
            <div className="setup-step setup-connections">
              <span className="eyebrow">Bring your own AI</span>
              <h1>학습을 만들 AI를<br />하나 이상 연결해 주세요.</h1>
              <p>로그인된 Codex CLI가 확인되면 API 키 없이 사용할 수 있습니다. 개인 API는 자동 장애 전환용으로 함께 연결할 수 있으며, 키는 이 Windows 사용자에게 묶어 암호화합니다.</p>
              <div className={`connection-gate ${hasReadyProvider ? "is-ready" : ""}`}>
                {hasReadyProvider ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
                <div><strong>{hasReadyProvider ? `${readyProviders.map(providerLabel).join(", ")} 준비 완료` : "아직 검증된 AI 연결이 없습니다"}</strong><span>{hasReadyProvider ? "다음 단계에서 사용할 라우팅을 확인합니다." : "Codex 로그인을 확인하거나 아래에서 개인 API를 저장하고 연결 확인을 완료하세요."}</span></div>
                <button className="button" onClick={() => void onRefreshProviders()}><RefreshCw size={14} /> 다시 확인</button>
              </div>
              <div className="setup-cli-grid">
                <div>
                  <ProviderCard name="Codex CLI" status={providerStatus.codex} icon={<SquareTerminal size={15} />} />
                  {!providerStatus.codex.available && <p className="field-hint">설치되어 있다면 터미널에서 <code>codex login</code> 후 다시 확인하세요.</p>}
                  <div className="button-row section-gap"><button className="button" disabled={Boolean(runtimeAction)} onClick={() => void configureRuntime("codex", () => window.studyQuest!.runtime.pickCliExecutable("codex"))}><FolderOpen size={14} /> Codex 경로 선택</button></div>
                </div>
                <div>
                  <ProviderCard name="Claude Agent (선택)" status={providerStatus.claude} icon={<SquareTerminal size={15} />} />
                  <p className="field-hint">Claude Agent는 승인한 실행 파일과 검증된 Anthropic API 키가 모두 필요합니다.</p>
                  <div className="button-row section-gap"><button className="button" disabled={Boolean(runtimeAction)} onClick={() => void configureRuntime("claude", () => window.studyQuest!.runtime.pickCliExecutable("claude"))}><FolderOpen size={14} /> 실행 파일 승인</button></div>
                </div>
              </div>
              <div className="setup-api-grid">
                <ApiProviderEditor provider="openai" name="OpenAI" defaultModel="gpt-5.6-terra" status={providerStatus.openai} onChanged={onRefreshProviders} />
                <ApiProviderEditor provider="anthropic" name="Anthropic" defaultModel="claude-sonnet-5" status={providerStatus.anthropic} onChanged={onRefreshProviders} />
                <ApiProviderEditor provider="deepseek" name="DeepSeek" defaultModel="deepseek-v4-flash" status={providerStatus.deepseek} onChanged={onRefreshProviders} />
              </div>
              {runtimeMessage && <p className="setup-message" role="status">{runtimeMessage}</p>}
            </div>
          )}

          {step === 2 && (
            <div className="setup-step setup-ready">
              <div className="setup-ready-mark"><CheckCircle2 size={28} /></div>
              <span className="eyebrow">Ready to learn</span>
              <h1>연결 준비가 끝났습니다.</h1>
              <p>이제 과목과 도달 목표를 대화로 확인하고, 퇴근 시간·학습 종료·게임 시간까지 조사한 뒤 현재 수준 테스트를 만듭니다.</p>
              <label className="field setup-route"><span>기본 AI 라우팅</span><select className="select" value={envelope.preferences.provider} onChange={(event) => onUpdatePreferences({ ...envelope.preferences, provider: event.target.value as AIProviderPreference })}><option value="auto">자동 라우팅 · 권장</option>{readyProviders.map((provider) => <option value={provider} key={provider}>{providerLabel(provider)}</option>)}</select></label>
              <div className="setup-summary">
                <div><Database size={16} /><span>학습 데이터</span><strong>{runtime?.dataRootIsDefault !== false ? "앱 내부 저장" : "사용자 지정 폴더"}</strong></div>
                <div><BrainCircuit size={16} /><span>사용 가능한 AI</span><strong>{readyProviders.length}개</strong></div>
                <div><Clock3 size={16} /><span>생활 시간표</span><strong>첫 과목 대화에서 확인</strong></div>
              </div>
              {!selectedProviderReady && <p className="setup-message error" role="alert">선택한 AI를 현재 사용할 수 없습니다. 자동 라우팅이나 준비 완료된 AI를 선택해 주세요.</p>}
            </div>
          )}
        </div>

        <footer className="first-run-footer">
          <span>{step === 0 ? "설정은 모두 나중에 다시 바꿀 수 있습니다." : step === 1 ? "API 키를 앱 제작자에게 보내지 않습니다." : "다음은 학습 과목 인터뷰입니다."}</span>
          <div className="button-row">
            {step > 0 && <button className="button" onClick={() => setStep((current) => current - 1)}>이전</button>}
            {step === 0 && <button className="button primary" onClick={() => setStep(1)}>AI 연결 확인 <ChevronRight size={15} /></button>}
            {step === 1 && <button className="button primary" disabled={!hasReadyProvider} onClick={nextFromConnections}>연결 사용하기 <ChevronRight size={15} /></button>}
            {step === 2 && <button className="button primary" disabled={!selectedProviderReady} onClick={onComplete}>과목 등록 시작 <ChevronRight size={15} /></button>}
          </div>
        </footer>
      </section>
    </main>
  );
}

function OnboardingPage({
  interview,
  subjects,
  schedulePolicy,
  protectGameTime,
  providerStatus,
  onSend,
  onStartDiagnostic,
  onUpdateAnswer,
  onCompleteDiagnostic,
  onReset,
}: {
  interview: InterviewState;
  subjects: readonly Subject[];
  schedulePolicy: StudyQuestState["schedulePolicy"];
  protectGameTime: boolean;
  providerStatus: ProviderStatus;
  onSend(value: string): Promise<boolean>;
  onStartDiagnostic(): Promise<void>;
  onUpdateAnswer(questionId: string, answer: string): void;
  onCompleteDiagnostic(): Promise<void>;
  onReset(): void;
}) {
  const [draft, setDraft] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const readiness = Math.round(interview.readiness * 100);
  const scheduleConfigured = schedulePolicy.configuredBy === "ai-interview"
    || schedulePolicy.configuredBy === "manual";
  const scheduleDraft = interview.scheduleRecommendation;
  const scheduleReady = isCompleteInterviewSchedule(scheduleDraft) || scheduleConfigured;
  const scheduleStart = scheduleDraft?.defaultReadyAt
    ?? (scheduleConfigured ? schedulePolicy.defaultReadyAt : undefined);
  const scheduleDeadline = scheduleDraft?.learningDeadline
    ?? (scheduleConfigured ? schedulePolicy.learningDeadline : undefined);
  const gameProtected = scheduleDraft?.protectGameTime ?? (scheduleConfigured ? protectGameTime : null);
  const gameStart = scheduleDraft?.gameStart ?? (scheduleConfigured ? schedulePolicy.gameStart : undefined);
  const gameEnd = scheduleDraft?.gameEnd ?? (scheduleConfigured ? schedulePolicy.gameEnd : undefined);
  const scheduleNotes = scheduleDraft?.constraintsSummary
    || (scheduleConfigured ? schedulePolicy.constraintsSummary : "");
  const overrideCount = scheduleDraft?.dayOverrides.length ?? schedulePolicy.dayOverrides?.length ?? 0;
  const readyToComplete = Boolean(interview.questions.length)
    && interview.questions.every((question) => interview.answers[question.id]?.trim());
  const templates = [
    {
      label: "과목 + 도달 수준",
      value: "배우고 싶은 과목은 ___이고, 최종적으로 ___까지 혼자 해내고 싶어.",
    },
    {
      label: "과목 + 결과물",
      value: "___를 배워서 ___라는 결과물을 직접 만들 수 있는 수준까지 가고 싶어.",
    },
    {
      label: "자료 + 적용 범위",
      value: "___를 공부해서 핵심 개념을 설명하고 ___에 적용할 수 있을 때까지 배우고 싶어.",
    },
  ];
  const completion = findPromptCompletion(draft, templates.map((template) => template.value));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = draft.trim();
    if (!value) return;
    void onSend(value).then((accepted) => {
      if (accepted) setDraft("");
    });
  };

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread || interview.status === "diagnostic") return;
    thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
  }, [interview.messages.length, interview.questions.length, interview.status]);

  return (
    <section className="page onboarding-page">
      <div className="onboarding-shell">
        <header className="onboarding-header">
          <div className="card-header" style={{ alignItems: "flex-start" }}>
            <div>
              <span className="eyebrow">AI-guided subject setup</span>
              <h1>무엇을 배우고, 어디까지 해내고 싶나요?</h1>
              <p>과목과 도달 목표를 먼저 받고, 실제 학습·종료·게임 시간까지 한 번 확인한 뒤 현재 수준 테스트를 만듭니다.</p>
            </div>
            <div className="button-row">
              <span className={`tag ${providerStatus.codex.available ? "mint" : ""}`}>Codex CLI {providerStatus.codex.available ? "1/1" : "0/1"}</span>
              <span className={`tag ${providerStatus.claude.available ? "mint" : ""}`}>Claude Agent {providerStatus.claude.available ? "1/1" : "0/1"}</span>
              <span className={`tag ${[providerStatus.openai, providerStatus.anthropic, providerStatus.deepseek].some((item) => item.available) ? "mint" : ""}`}>개인 API {[providerStatus.openai, providerStatus.anthropic, providerStatus.deepseek].filter((item) => item.available).length}/3</span>
              {interview.status !== "idle" && <button className="button ghost" onClick={onReset}><RotateCcw size={14} /> 과목 등록 다시 시작</button>}
            </div>
          </div>
          {subjects.length > 0 && (
            <div className="button-row" style={{ marginTop: 12 }}>
              <span className="muted">이미 등록됨</span>
              {subjects.map((subject) => <span className="tag" key={subject.id}>{subject.name}</span>)}
            </div>
          )}
        </header>

        <div className="interview-progress" aria-label={`학습 과목 등록 준비도 ${readiness}%`}>
          <span className="is-done" />
          <b>과목·도달 목표</b>
          <progress max="100" value={readiness} />
          <b>{readiness}%</b>
          <span className={interview.status === "ready" || interview.status === "diagnostic" ? "is-done" : ""} />
          <b>{interview.status === "diagnostic"
            ? "현재 수준 테스트 중"
            : interview.status === "ready"
              ? "테스트 준비됨"
              : interview.status === "idle" || !interview.blueprint?.subjectName.trim() || !interview.blueprint.goal.trim()
                ? "과목·목표 입력 대기"
                : scheduleReady
                  ? "등록 정보 확인 중"
                  : "생활 시간표 확인 중"}</b>
        </div>

        <div className={`chat-thread${interview.status === "idle" ? " is-empty" : ""}`} ref={threadRef}>
          {interview.status === "idle" && (
            <div className="welcome-empty">
              <BrainCircuit />
              <h2>등록할 학습 과목을 알려주세요.</h2>
              <p>무엇을 배우고 어디까지 해낼지를 먼저 적으세요. 이어서 AI가 실제 공부 시작·종료·게임 시간과 요일 예외를 한 번 묻고 테스트로 넘어갑니다.</p>
              <div className="button-row" style={{ justifyContent: "center" }}>
                {templates.map((template) => (
                  <button className="button" key={template.label} onClick={() => setDraft(template.value)}>{template.label}</button>
                ))}
              </div>
            </div>
          )}

          {interview.status !== "idle" && interview.messages.map((message) => (
            <div className={`chat-message ${message.role}`} data-role={message.role} key={message.id}>
              {message.content}
            </div>
          ))}

          {interview.blueprint && interview.status !== "diagnostic" && (
            <div className="blueprint-card">
              <div className="card-header">
                <div>
                  <span className="eyebrow">등록 전 학습 설계 초안</span>
                  <h2 style={{ margin: "6px 0 0" }}>{interview.blueprint.subjectName || "학습 과목 확인 중"}</h2>
                </div>
                <span className="tag">하루 {interview.blueprint.dailyMinutes}분 · {interview.blueprint.role === "main" ? "메인 캠페인" : "일반 과목"}</span>
              </div>
              <div className="grid two section-gap">
                <div><strong>도달 목표</strong><p>{interview.blueprint.goal || "대화에서 구체화 중"}</p></div>
                <div><strong>성공 증거</strong><p>{interview.blueprint.successEvidence || "목표에서 정리 중"}</p></div>
                <div><strong>현재 경험</strong><p>{interview.blueprint.knownSummary || "테스트에서 확인 예정"}</p></div>
                <div><strong>확인할 공백</strong><p>{interview.blueprint.unknownSummary || "테스트에서 확인 예정"}</p></div>
                {(scheduleDraft || scheduleConfigured) && (
                  <>
                    <div><strong>기본 학습 시간</strong><p>{scheduleStart && scheduleDeadline ? `${scheduleStart} 시작 · ${scheduleDeadline} 종료` : "대화에서 확인 중"}</p></div>
                    <div><strong>게임·휴식 보호</strong><p>{gameProtected === null ? "대화에서 확인 중" : gameProtected && gameStart && gameEnd ? `${gameStart}~${gameEnd} 보호` : "별도 보호 시간 없음"}</p></div>
                    <div style={{ gridColumn: "1 / -1" }}><strong>생활 시간표 메모</strong><p>{scheduleNotes || `요일 예외 ${overrideCount}개 · 정리 ${scheduleDraft?.wrapUpMinutes ?? schedulePolicy.wrapUpMinutes}분`}</p></div>
                  </>
                )}
              </div>
              {interview.blueprint.skills.length > 0 && (
                <div className="button-row">
                  {interview.blueprint.skills.map((skill) => <span className="tag" key={skill.name}>{skill.name}</span>)}
                </div>
              )}
              {interview.status === "ready" && (
                <div className="modal-footer" style={{ paddingInline: 0, paddingBottom: 0 }}>
                  <p className="muted" style={{ margin: 0, flex: 1 }}>과목·도달 목표와 생활 시간표가 정해졌습니다. 이제 테스트 답안으로 현재 수준을 판단합니다.</p>
                  <button className="button primary" onClick={() => void onStartDiagnostic()}><ListChecks size={15} /> 현재 수준 테스트 시작</button>
                </div>
              )}
            </div>
          )}

          {interview.status === "diagnostic" && (
            <>
              <div className="blueprint-card">
                <span className="eyebrow">AI current-level test</span>
                <h2 style={{ margin: "7px 0" }}>{interview.diagnosticTitle ?? `${interview.blueprint?.subjectName ?? "새 과목"} 현재 수준 테스트`}</h2>
                <p style={{ margin: 0 }}>{interview.diagnosticOverview}</p>
                <p className="field-hint">점수와 확신도는 고르지 않습니다. 답안의 설명·적용·전이 증거를 AI가 직접 판단합니다.</p>
              </div>
              {interview.questions.map((question, index) => (
                <div className="blueprint-card" key={question.id}>
                  <span className="eyebrow">{index + 1} / {interview.questions.length} · {question.concept}</span>
                  <h3 style={{ margin: "8px 0 13px", lineHeight: 1.55 }}>{question.prompt}</h3>
                  <textarea
                    className="textarea"
                    rows={5}
                    value={interview.answers[question.id] ?? ""}
                    onChange={(event) => onUpdateAnswer(question.id, event.target.value)}
                    placeholder="검색 없이 자신의 말, 수식, 코드, 예시로 답하세요. 모르면 어디까지 이해했는지 적어도 됩니다."
                  />
                  <VoiceRecorder transcriptionAvailable={providerStatus.openai.available} onTranscript={(text) => onUpdateAnswer(question.id, text)} />
                </div>
              ))}
              <div className="modal-footer" style={{ paddingInline: 0, paddingBottom: 0 }}>
                <span className="muted">{Object.values(interview.answers).filter((answer) => answer.trim()).length}/{interview.questions.length} 답변</span>
                <button className="button primary" disabled={!readyToComplete} onClick={() => void onCompleteDiagnostic()}>
                  <Sparkles size={15} /> AI가 채점하고 과목 등록하기
                </button>
              </div>
            </>
          )}
        </div>

        {interview.status !== "diagnostic" && (
          <form className="chat-composer" onSubmit={submit}>
            {completion && <div className="tab-completion-hint"><kbd>Tab</kbd><span>{completion}</span></div>}
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Tab"
                  && completion
                  && !event.shiftKey
                  && !event.ctrlKey
                  && !event.altKey
                  && !event.metaKey
                  && !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  setDraft(completion);
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              rows={2}
              placeholder="예: [배우고 싶은 과목]을 배워서 [원하는 결과]까지 혼자 해낼 수 있는 수준으로 가고 싶어…"
            />
            <button className="button primary icon-only" aria-label="학습 과목 등록 대화에 보내기" disabled={!draft.trim()}><Send size={16} /></button>
          </form>
        )}
      </div>
    </section>
  );
}

function TodayPage({
  envelope,
  schedule,
  currentDay,
  onChangeCheckIn,
  onSelectQuest,
  onOpenCurriculum,
}: {
  envelope: AppEnvelope;
  schedule?: DailySchedule;
  currentDay?: Curriculum7Day["days"][number];
  onChangeCheckIn(checkIn: DailyCheckIn): void;
  onSelectQuest(quest: Quest): void;
  onOpenCurriculum(): void;
}) {
  const { learning, checkIn } = envelope;
  const nextQuest = currentDay?.quests.find((quest) => quest.status !== "completed");
  const providerName = envelope.preferences.provider === "auto"
    ? "자동 라우팅"
    : providerLabel(envelope.preferences.provider);
  const deadline = schedule?.deadline ?? learning.schedulePolicy.learningDeadline;
  const gameWindow = envelope.preferences.protectGameTime
    ? `${learning.schedulePolicy.gameStart}~${learning.schedulePolicy.gameEnd}`
    : "별도 보호 없음";
  return (
    <section className="page">
      <div className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Tonight's campaign</span>
          <h1>{deadline}까지, 오늘의 지식을<br />결과물로 바꾸자.</h1>
          <p>{nextQuest ? `다음 퀘스트는 “${nextQuest.title}”입니다. 게임·휴식 시간은 ${gameWindow}로 운용합니다.` : "오늘 계획을 모두 완료했습니다. 증거를 정리하고 보호한 휴식 시간으로 넘어가세요."}</p>
          <div className="button-row" style={{ marginTop: 18 }}>
            <button className="button primary" disabled={!nextQuest} onClick={() => nextQuest && onSelectQuest(nextQuest)}><Play size={15} /> 다음 퀘스트 시작</button>
            <button className="button" onClick={onOpenCurriculum}><CalendarDays size={15} /> 7일 지도 보기</button>
          </div>
        </div>
        <div className="hero-actions">
          <div className="hero-clock">{formatMinutes(schedule?.availableStudyMinutes ?? 0)}<small>학습 가능</small></div>
          <div className="button-row">
            <label className="sr-only" htmlFor="ready-at">학습 시작 시각</label>
            <input id="ready-at" className="input" type="time" value={checkIn.readyAt} onChange={(event) => onChangeCheckIn({ ...checkIn, readyAt: event.target.value })} style={{ width: 116 }} />
            <label className="sr-only" htmlFor="fatigue">피로도</label>
            <select id="fatigue" className="select" value={checkIn.fatigue} onChange={(event) => onChangeCheckIn({ ...checkIn, fatigue: Number(event.target.value) as DailyCheckIn["fatigue"] })} style={{ width: 128 }}>
              <option value={1}>에너지 높음</option>
              <option value={2}>괜찮음</option>
              <option value={3}>보통</option>
              <option value={4}>피곤함</option>
              <option value={5}>탈진</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid two section-gap">
        <div className="card">
          <div className="card-header"><div><h2>오늘의 퀘스트</h2><p>실제 증거가 남아야 숙련도가 올라갑니다.</p></div><span className="tag violet">{providerName}</span></div>
          <div className="quest-list">
            {(currentDay?.quests ?? []).map((quest) => {
              const subject = learning.subjects.find((item) => item.id === quest.primarySubjectId)!;
              return (
                <div key={quest.id} className="quest-item">
                  <div className="quest-icon" style={subjectStyle(subject)}>{quest.status === "completed" ? <CheckCircle2 size={18} /> : subjectIcon(subject.name)}</div>
                  <div className="quest-copy"><strong>{quest.title}</strong><span>{subject.name} · {quest.requiredEvidence}</span></div>
                  <div className="quest-meta"><Clock3 size={12} /> {quest.estimatedMinutes}분 <button className="button icon-only ghost" aria-label={`${quest.title} 시작`} onClick={() => onSelectQuest(quest)}><ChevronRight size={16} /></button></div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><div><h2>{deadline} 역산 타임라인</h2><p>인터뷰로 정한 생활 시간표와 오늘 피로도에 따라 즉시 재계산됩니다.</p></div><Clock3 size={16} className="text-violet" /></div>
          <div className="timeline">
            {(schedule?.blocks ?? []).map((block) => {
              const subject = learning.subjects.find((item) => item.id === block.subjectId);
              const color = block.kind === "game" ? "#c9eb63" : block.kind === "wrap-up" ? "#ffb45b" : subject ? subjectColor(subject) : "#5f6885";
              return (
                <div className="timeline-item" key={block.id}>
                  <span className="timeline-time">{block.start}</span>
                  <span className="timeline-dot" style={{ "--timeline-color": color } as CSSProperties} />
                  <div className="timeline-copy"><strong>{block.title}</strong><span>{block.kind === "game" ? "공부와 분리된 보상 시간" : `${block.durationMinutes}분 블록`}</span></div>
                  {block.kind === "game" && <Gamepad2 size={15} style={{ color }} />}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid three section-gap">
        {learning.subjects.map((subject) => {
          const graph = learning.skillGraphs.find((item) => item.subjectId === subject.id);
          const mastery = graph?.nodes.reduce((sum, node) => sum + node.mastery, 0) ?? 0;
          const percent = graph?.nodes.length ? Math.round((mastery / graph.nodes.length) * 100) : 0;
          const allocated = schedule?.allocatedMinutesBySubject[subject.id] ?? 0;
          return (
            <div className="card card-pad" key={subject.id} style={subjectStyle(subject)}>
              <div className="subject-top"><div className="subject-icon">{subjectIcon(subject.name)}</div><div className="subject-copy"><strong>{subject.name}</strong><span>{subject.role === "main" ? "메인 캠페인" : "스킬 트랙"} · 오늘 {allocated}분</span></div></div>
              <div style={{ margin: "18px 0 8px", display: "flex", justifyContent: "space-between", fontSize: 10 }}><span className="muted">증거 기반 숙련도</span><strong>{percent}%</strong></div>
              <div className="progress-track"><div className="progress-fill" style={{ width: `${percent}%`, background: subjectColor(subject) }} /></div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SubjectsPage({
  envelope,
  selectedSubject,
  onSelect,
  onAdd,
  onDiagnose,
  onCurriculum,
  onImport,
  onBoost,
  onUpdateDocumentExcerpt,
}: {
  envelope: AppEnvelope;
  selectedSubject?: Subject;
  onSelect(subject: Subject): void;
  onAdd(): void;
  onDiagnose(subject: Subject): void;
  onCurriculum(subject: Subject): void;
  onImport(): void;
  onBoost(subject: Subject): void;
  onUpdateDocumentExcerpt(documentId: string, excerpt: string): void;
}) {
  const { learning } = envelope;
  return (
    <section className="page">
      <div className="page-header">
        <div><span className="eyebrow">Learning portfolio</span><h1>과목은 독립적으로,<br />AI는 전체를 능동적으로.</h1><p>각 과목의 모르는 점과 목표를 따로 보존하면서 선수관계와 통합 퀘스트로 연결합니다.</p></div>
        <button className="button primary" onClick={onAdd}><Plus size={15} /> 새 과목 등록</button>
      </div>
      <div className="subject-grid">
        {learning.subjects.map((subject) => {
          const graph = learning.skillGraphs.find((item) => item.subjectId === subject.id);
          const goal = learning.goals.find((item) => item.subjectId === subject.id);
          const gap = learning.gaps.find((item) => item.subjectId === subject.id && item.status !== "resolved");
          const mastery = graph?.nodes.length ? Math.round((graph.nodes.reduce((sum, node) => sum + node.mastery, 0) / graph.nodes.length) * 100) : 0;
          const uncertainty = graph?.nodes.length ? Math.round((graph.nodes.reduce((sum, node) => sum + node.uncertainty, 0) / graph.nodes.length) * 100) : 0;
          return (
            <article key={subject.id} className={`subject-card${selectedSubject?.id === subject.id ? " is-selected" : ""}`} style={subjectStyle(subject)} onClick={() => onSelect(subject)}>
              <div className="subject-top"><div className="subject-icon">{subjectIcon(subject.name)}</div><div className="subject-copy"><strong>{subject.name}</strong><span>{subject.role === "main" ? "캠페인" : "과목"} · 하루 {subject.dailyTargetMinutes}분 {subject.priorityBoost > 0.9 ? "· 부스트" : ""}</span></div></div>
              <div className="subject-details">
                <div className="subject-detail"><span>목표</span><span>{goal?.text ?? "목표를 입력하세요"}</span></div>
                <div className="subject-detail"><span>모르는 점</span><span>{gap?.rawText ?? "현재 열린 지식 공백 없음"}</span></div>
              </div>
              <div className="metric-row">
                <div className="metric-box"><strong>{mastery}%</strong><span>숙련도</span></div>
                <div className="metric-box"><strong>{uncertainty}%</strong><span>불확실성</span></div>
                <div className="metric-box"><strong>{graph?.nodes.length ?? 0}</strong><span>스킬 노드</span></div>
              </div>
            </article>
          );
        })}
      </div>
      {selectedSubject && (
        <div className="card card-pad section-gap">
          <div className="card-header" style={{ padding: 0, marginBottom: 15 }}><div><h2>{selectedSubject.name} 능동 관리</h2><p>AI 호출은 이 과목과 연결된 목표·공백·스킬만 전달합니다.</p></div><span className="tag mint">선택됨</span></div>
          <div className="button-row">
            <button className="button" onClick={() => onDiagnose(selectedSubject)}><ListChecks size={15} /> AI 진단 제작</button>
            <button className="button" onClick={() => onCurriculum(selectedSubject)}><Sparkles size={15} /> AI 커리큘럼 제작</button>
            <button className="button" onClick={() => onBoost(selectedSubject)}><Zap size={15} /> 7일 부스트</button>
            <button className="button" onClick={onImport}><Upload size={15} /> 책·원고·노트 등록</button>
          </div>
          {envelope.importedDocuments.filter((document) => document.subjectId === selectedSubject.id).map((document) => (
            <div className="provider-card section-gap" key={document.id}>
              <div className="provider-card-copy">
                <strong><FileText size={14} /> {document.name}</strong>
                <p className="mono">{document.path}</p>
                {document.excerpt && <p>{document.excerpt.slice(0, 260)}{document.excerpt.length > 260 ? "…" : ""}</p>}
                {document.warning && <p>{document.warning}</p>}
                <details style={{ marginTop: 10 }}>
                  <summary style={{ cursor: "pointer" }}>라이브 강의에 넣을 현재 장·문단 수정</summary>
                  <textarea
                    className="textarea"
                    style={{ marginTop: 10, minHeight: 150 }}
                    value={document.excerpt}
                    onChange={(event) => onUpdateDocumentExcerpt(document.id, event.target.value)}
                    placeholder="PDF/DOCX 본문이 없거나 다른 장을 공부할 때 해당 부분을 여기에 붙여 넣으세요."
                  />
                </details>
              </div>
              <span className={`tag ${document.extractionStatus === "ready" ? "mint" : "amber"}`}>
                {document.extractionStatus === "ready" ? `본문 ${document.extractedChars.toLocaleString()}자` : "경로만 연결"}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DiagnosticPage({
  envelope,
  selectedSubject,
  transcriptionAvailable,
  onSelectSubject,
  onCreateAI,
  onComplete,
}: {
  envelope: AppEnvelope;
  selectedSubject?: Subject;
  transcriptionAvailable: boolean;
  onSelectSubject(subjectId: string): void;
  onCreateAI(): void;
  onComplete(diagnosticId: string, answers: DiagnosticAnswerMap): Promise<void>;
}) {
  const diagnostics = envelope.learning.diagnostics.filter((item) => item.subjectId === selectedSubject?.id);
  const diagnostic = [...diagnostics].reverse().find((item) => item.status !== "scored") ?? diagnostics.at(-1);
  const [answers, setAnswers] = useState<DiagnosticAnswerMap>({});
  const readyToComplete = Boolean(diagnostic?.questions.length) && diagnostic!.questions.every((question) => answers[question.id]?.text.trim());
  return (
    <section className="page">
      <div className="page-header">
        <div><span className="eyebrow">Adaptive diagnosis</span><h1>“안다고 생각함”을<br />실제 증거로 보정한다.</h1><p>설명, 적용, 전이 답안을 AI가 읽고 시작점을 판단합니다. 점수나 확신도는 직접 고르지 않습니다.</p></div>
        <select className="select" value={selectedSubject?.id ?? ""} onChange={(event) => onSelectSubject(event.target.value)} style={{ width: 210 }}>{envelope.learning.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select>
      </div>
      <div className="card">
        <div className="card-header"><div><h2>{selectedSubject?.name ?? "과목"} 진단</h2><p>{diagnostic ? `${diagnostic.questions.length}문항 · ${diagnostic.status === "scored" ? "완료" : "진행 가능"}` : "아직 진단이 없습니다."}</p></div><button className="button primary" onClick={onCreateAI}><Sparkles size={14} /> AI 진단 만들기</button></div>
        {diagnostic ? (
          <div className="diagnostic-list">
            {diagnostic.questions.map((question, index) => {
              const answer = answers[question.id] ?? { text: "" };
              return (
                <div className="diagnostic-question" key={question.id}>
                  <div className="question-number">{index + 1}</div>
                  <div className="question-body">
                    <p>{question.prompt}</p>
                    <textarea className="textarea" placeholder="AI 설명을 보기 전에 자신의 말, 수식, 코드로 답하세요." value={answer.text} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: { ...answer, text: event.target.value } }))} />
                    <VoiceRecorder transcriptionAvailable={transcriptionAvailable} onTranscript={(text) => setAnswers((current) => ({ ...current, [question.id]: { ...answer, text } }))} />
                    <p className="field-hint">AI가 이 답안에서 정확성·독립성·전이 가능성·설명력을 추론합니다.</p>
                  </div>
                </div>
              );
            })}
            {diagnostic.status !== "scored" && (
              <div className="modal-footer">
                <button className="button primary" disabled={!readyToComplete} onClick={() => void onComplete(diagnostic.id, answers)}>
                  <Sparkles size={15} /> AI가 판단하고 자동 재계획
                </button>
              </div>
            )}
          </div>
        ) : <EmptyState icon={<ListChecks size={28} />} title="AI 진단을 생성하세요" text="현재 스킬 그래프와 최근 증거를 바탕으로 다음 탐침 문항을 만듭니다." />}
      </div>
    </section>
  );
}

function GraphPage({ envelope, onBoost }: { envelope: AppEnvelope; onBoost(skill: SkillNode): void }) {
  const [selectedSkill, setSelectedSkill] = useState<SkillNode | undefined>(() => envelope.learning.skillGraphs[0]?.nodes[0]);
  const subject = envelope.learning.subjects.find((item) => item.id === selectedSkill?.subjectId);
  const prerequisites = selectedSkill?.prerequisiteIds.map((id) => envelope.learning.skillGraphs.flatMap((graph) => graph.nodes).find((node) => node.id === id)?.name).filter(Boolean) ?? [];
  return (
    <section className="page">
      <div className="page-header"><div><span className="eyebrow">Evidence graph</span><h1>내가 무엇을 알고,<br />어디가 비어 있는가.</h1><p>노트 연결이 아니라 선수관계, 숙련도, 불확실성, 제출 증거를 한 그래프에서 확인합니다.</p></div><div className="button-row"><span className="tag mint">큰 노드 = 높은 숙련도</span><span className="tag amber">옅은 후광 = 불확실성</span></div></div>
      <div className="skill-graph-layout">
        <SkillGraphView graphs={envelope.learning.skillGraphs} subjects={envelope.learning.subjects} selectedSkillId={selectedSkill?.id} onSelect={setSelectedSkill} />
        <aside className="card graph-inspector">
          {selectedSkill && subject ? <><span className="eyebrow">{subject.name}</span><h2 style={{ margin: "7px 0 0", fontSize: 18 }}>{selectedSkill.name}</h2><div className="mastery-ring" style={{ "--ring-color": subjectColor(subject), "--ring-value": `${Math.round(selectedSkill.mastery * 100)}%` } as CSSProperties}><strong>{Math.round(selectedSkill.mastery * 100)}%</strong></div><div className="inspector-list"><div className="inspector-row"><span>불확실성</span><strong>{Math.round(selectedSkill.uncertainty * 100)}%</strong></div><div className="inspector-row"><span>시도 횟수</span><strong>{selectedSkill.attempts}</strong></div><div className="inspector-row"><span>증거 수</span><strong>{selectedSkill.evidenceIds.length}</strong></div><div className="inspector-row"><span>선수 지식</span><strong>{prerequisites.join(", ") || "없음"}</strong></div><div className="inspector-row"><span>마지막 연습</span><strong>{selectedSkill.lastPracticedOn ?? "아직 없음"}</strong></div></div><button className="button primary" style={{ width: "100%", marginTop: 18 }} onClick={() => onBoost(selectedSkill)}><Target size={15} /> 이 스킬 부스트</button></> : <EmptyState icon={<Network size={25} />} title="노드를 선택하세요" text="연결과 숙련도 근거를 확인할 수 있습니다." />}
        </aside>
      </div>
    </section>
  );
}

function CurriculumPage({
  envelope,
  selectedSubject,
  onSelectSubject,
  onRebuildLocal,
  onGenerateAI,
  onSelectQuest,
}: {
  envelope: AppEnvelope;
  selectedSubject?: Subject;
  onSelectSubject(subjectId: string): void;
  onRebuildLocal(): void;
  onGenerateAI(): void;
  onSelectQuest(quest: Quest): void;
}) {
  return (
    <section className="page">
      <div className="page-header"><div><span className="eyebrow">Rolling curriculum</span><h1>큰 지도는 유지하고,<br />다음 7일만 정밀하게.</h1><p>매 세션의 증거와 자연어 피드백을 반영해 미래 계획을 패치합니다. 토큰은 실제 강의와 다음 구간 제작에 집중합니다.</p></div><div className="button-row"><select className="select" value={selectedSubject?.id ?? ""} onChange={(event) => onSelectSubject(event.target.value)}>{envelope.learning.subjects.map((subject) => <option value={subject.id} key={subject.id}>{subject.name}</option>)}</select><button className="button" onClick={onRebuildLocal}><RefreshCw size={14} /> 로컬 재계산</button><button className="button primary" onClick={onGenerateAI}><Sparkles size={14} /> 선택 과목 AI 설계</button></div></div>
      <div className="curriculum-week">
        {(envelope.learning.curriculum?.days ?? []).map((day) => (
          <div className={`day-card${day.date === localIsoDate() ? " is-today" : ""}`} key={day.date}>
            <div className="day-heading"><strong>{formatDate(day.date)}</strong><span>{day.plannedMinutes}분</span></div>
            {day.quests.map((quest) => {
              const subject = envelope.learning.subjects.find((item) => item.id === quest.primarySubjectId)!;
              return <button key={quest.id} className="day-quest" style={{ ...subjectStyle(subject), width: "100%", color: "inherit", textAlign: "left", borderTop: 0, borderRight: 0, borderBottom: 0, cursor: "pointer" }} onClick={() => onSelectQuest(quest)}><strong>{quest.title}</strong><span>{subject.name} · {quest.estimatedMinutes}분</span></button>;
            })}
          </div>
        ))}
      </div>
      <div className="card card-pad section-gap"><span className="eyebrow">Adaptation log</span><h3 style={{ margin: "8px 0 6px" }}>현재 개정판 v{envelope.learning.curriculum?.revision ?? 0}</h3><p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.65 }}>{envelope.learning.curriculum?.days[0]?.adaptationReason ?? "커리큘럼을 생성하면 조정 이유가 여기에 남습니다."}</p></div>
    </section>
  );
}

function LessonPage({
  envelope,
  quest,
  transcriptionAvailable,
  onSelectQuest,
  onGenerateAI,
  onSubmit,
}: {
  envelope: AppEnvelope;
  quest?: Quest;
  transcriptionAvailable: boolean;
  onSelectQuest(questId: string): void;
  onGenerateAI(): void;
  onSubmit(quest: Quest, note: string, rubric: LearningEvidence["rubric"], useAI: boolean): Promise<void>;
}) {
  const allQuests = envelope.learning.curriculum?.days.flatMap((day) => day.quests) ?? [];
  const scheduleWindow = resolveScheduleWindow(envelope.learning.schedulePolicy, envelope.checkIn.date);
  const deadlineMinutes = minutesFromClock(scheduleWindow.learningDeadline);
  const skill = envelope.learning.skillGraphs.flatMap((graph) => graph.nodes).find((node) => quest?.skillIds.includes(node.id));
  const fallbackLesson = quest ? localLesson(quest, skill) : undefined;
  const lesson = quest && fallbackLesson
    ? envelope.generatedLessons[quest.id]
      ? normalizeGeneratedLesson(envelope.generatedLessons[quest.id], fallbackLesson)
      : fallbackLesson
    : undefined;
  const lessonIdentity = lesson ? JSON.stringify(lesson) : "none";
  const totalMinutes = lesson?.segments.reduce((total, segment) => total + segment.minutes, 0) ?? 30;
  const [remaining, setRemaining] = useState(totalMinutes * 60);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState("");
  const [exploredWidgets, setExploredWidgets] = useState<Set<string>>(() => new Set());
  const [finalCheckOpen, setFinalCheckOpen] = useState(false);
  const [checkComplete, setCheckComplete] = useState(false);
  const [checkScore, setCheckScore] = useState<{ score: number; total: number } | null>(null);
  const [clockTick, setClockTick] = useState(() => Date.now());
  const rubric: LearningEvidence["rubric"] = { correctness: 0.7, independence: 0.6, transfer: 0.5, explanation: 0.6 };

  useEffect(() => {
    setRemaining(totalMinutes * 60);
    setRunning(false);
    setNote("");
    setExploredWidgets(new Set());
    setFinalCheckOpen(false);
    setCheckComplete(false);
    setCheckScore(null);
  }, [lessonIdentity, quest?.id, totalMinutes]);
  useEffect(() => {
    const interval = window.setInterval(() => setClockTick(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    if (!running || remaining <= 0) return;
    const interval = window.setInterval(() => {
      const now = new Date();
      const afterDeadline = now.getHours() * 60 + now.getMinutes() >= deadlineMinutes;
      if (envelope.preferences.protectGameTime && afterDeadline) {
        setRunning(false);
        return;
      }
      setRemaining((value) => Math.max(0, value - 1));
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [deadlineMinutes, envelope.preferences.protectGameTime, running, remaining]);

  if (!quest || !lesson) return <section className="page"><EmptyState icon={<GraduationCap size={30} />} title="퀘스트를 선택하세요" text="오늘의 퀘스트나 커리큘럼에서 시작할 수 있습니다." /></section>;
  const widgetIds = lesson.segments.flatMap((segment) => segment.widget ? [segment.widget.id] : []);
  const allWidgetsExplored = widgetIds.every((widgetId) => exploredWidgets.has(widgetId));
  const elapsedMinutes = (totalMinutes * 60 - remaining) / 60;
  let cursor = 0;
  const currentIndex = lesson.segments.findIndex((segment) => {
    const active = elapsedMinutes >= cursor && elapsedMinutes < cursor + segment.minutes;
    cursor += segment.minutes;
    return active;
  });
  const minutes = String(Math.floor(remaining / 60)).padStart(2, "0");
  const seconds = String(remaining % 60).padStart(2, "0");
  const now = new Date(clockTick);
  const secondsUntilDeadline = (deadlineMinutes - (now.getHours() * 60 + now.getMinutes())) * 60 - now.getSeconds();
  const blockedByDeadline = envelope.preferences.protectGameTime && (
    secondsUntilDeadline <= 0 || remaining > secondsUntilDeadline
  );
  return (
    <section className="page">
      <div className="page-header"><div><span className="eyebrow">Reading lab</span><h1>먼저 충분히 배우고,<br />마지막에만 묻습니다.</h1><p>교재를 읽고 안전한 JS 위젯을 조작한 뒤, 마지막 확인과 결과물 제출로 마칩니다.</p></div><div className="button-row"><select className="select" value={quest.id} onChange={(event) => onSelectQuest(event.target.value)} style={{ maxWidth: 320 }}>{allQuests.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select><button className="button primary" onClick={onGenerateAI}><Sparkles size={14} /> AI 교재 다시 만들기</button></div></div>
      <div className="lesson-layout">
        <article className="card lesson-reader">
          <div className="lesson-head"><div className="button-row"><span className="tag violet">{lesson.generatedBy && lesson.generatedBy !== "local" ? `${providerLabel(lesson.generatedBy)} 생성` : "로컬 읽기 교재"}</span><span className="tag">읽기 → JS 위젯 → 최종 확인</span><span className="tag">{totalMinutes}분</span></div><h2>{lesson.title}</h2><p>{lesson.objective}</p></div>
          <div className="lesson-segments">
            {lesson.segments.map((segment, index) => (
              <section aria-labelledby={`lesson-section-${index}`} key={`${segment.phase}-${index}`} className={`lesson-segment${index === currentIndex ? " is-current" : ""}${index < currentIndex || remaining === 0 ? " is-done" : ""}`}>
                <div className="segment-time"><span>{String(index + 1).padStart(2, "0")}</span>{segment.minutes}분</div>
                <div className="segment-copy">
                  <span className="segment-phase">{lessonPhaseName[segment.phase]}</span>
                  <h3 id={`lesson-section-${index}`}>{segment.heading || lessonPhaseName[segment.phase]}</h3>
                  <p>{segment.content}</p>
                  <div className="reading-guide"><strong>읽는 기준</strong>{segment.readingGuide}</div>
                  {segment.widget && (
                    <LessonWidgetView
                      widget={segment.widget}
                      onExplore={() => setExploredWidgets((current) => {
                        if (current.has(segment.widget!.id)) return current;
                        return new Set([...current, segment.widget!.id]);
                      })}
                    />
                  )}
                </div>
              </section>
            ))}
          </div>
          <div className="lesson-finish-gate">
            {!finalCheckOpen ? (
              <>
                <span className="eyebrow">End of reading</span>
                <h3>설명은 여기까지입니다.</h3>
                <p>{allWidgetsExplored ? "이제 마지막 확인 문제를 열 수 있습니다." : `위젯을 조작해 변화를 확인하세요 · ${exploredWidgets.size}/${widgetIds.length}`}</p>
                <button type="button" className="button primary" disabled={!allWidgetsExplored} onClick={() => setFinalCheckOpen(true)}><ListChecks size={15} /> 글·위젯 학습 완료 · 마지막 확인 열기</button>
              </>
            ) : (
              <FinalLessonCheck
                check={lesson.finalCheck}
                onComplete={(score, total) => {
                  setCheckComplete(true);
                  setCheckScore({ score, total });
                }}
              />
            )}
          </div>
        </article>
        <aside className="card timer-card">
          <span className="eyebrow">Quest timer</span><div className="timer-display">{minutes}:{seconds}</div><div className="timer-label">{blockedByDeadline ? "남은 시간 안에 끝낼 수 없어 시작을 잠갔습니다." : `${scheduleWindow.learningDeadline} 학습 종료선을 지킵니다.`}</div>
          <div className="button-row" style={{ justifyContent: "center", marginBottom: 18 }}><button className="button primary" disabled={!running && blockedByDeadline} onClick={() => setRunning((value) => !value)}>{running ? <Pause size={15} /> : <Play size={15} />}{running ? "잠시 멈춤" : "시작"}</button><button className="button icon-only" aria-label="타이머 초기화" onClick={() => { setRunning(false); setRemaining(totalMinutes * 60); }}><RotateCcw size={15} /></button></div>
          {!checkComplete ? (
            <div className="submission-lock">
              <ShieldCheck size={24} />
              <strong>결과물 제출은 아직 잠겨 있습니다</strong>
              <p>본문을 읽고 JS 위젯을 탐색한 다음, 맨 아래 마지막 확인을 마치면 입력 칸과 마이크가 열립니다.</p>
              <span>{finalCheckOpen ? "마지막 확인 진행 중" : `위젯 ${exploredWidgets.size}/${widgetIds.length} 탐색`}</span>
            </div>
          ) : (
            <div className="submission-panel">
              {checkScore && <div className="check-score"><CheckCircle2 size={16} /><span>마지막 확인</span><strong>{checkScore.score}/{checkScore.total}</strong></div>}
              <label className="field"><span>최종 결과물 · 풀이·코드·설명</span><textarea className="textarea note-area" value={note} onChange={(event) => setNote(event.target.value)} placeholder={lesson.successEvidence} /></label>
              <VoiceRecorder key={quest.id} transcriptionAvailable={transcriptionAvailable} onTranscript={(text) => setNote((current) => current.trim() ? `${current.trim()}\n\n[음성 전사]\n${text}` : text)} />
              <div className="button-row" style={{ marginTop: 15 }}>
                <button className="button" style={{ flex: 1 }} disabled={note.trim().length < 10} onClick={() => void onSubmit(quest, note, rubric, false)}><CheckCircle2 size={15} /> 결과물 제출</button>
                <button className="button mint" style={{ flex: 1 }} disabled={note.trim().length < 10} onClick={() => void onSubmit(quest, note, rubric, true)}><Sparkles size={15} /> AI 검증 후 완료</button>
              </div>
              <p className="field-hint" style={{ marginTop: 10 }}>{lesson.reviewPrompt}</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function SettingsPage({
  envelope,
  runtime,
  providerStatus,
  onRefreshProviders,
  onUpdatePreferences,
  onOpenSetup,
  onClearErrorLog,
  onReset,
}: {
  envelope: AppEnvelope;
  runtime: RuntimeInfo | null;
  providerStatus: ProviderStatus;
  onRefreshProviders(): Promise<void>;
  onUpdatePreferences(preferences: AppEnvelope["preferences"]): void;
  onOpenSetup(): void;
  onClearErrorLog(): void;
  onReset(): void;
}) {
  const tokens = envelope.usage.reduce((total, item) => total + item.inputTokens + item.outputTokens, 0);
  const cached = envelope.usage.reduce((total, item) => total + item.cachedInputTokens, 0);
  const cost = envelope.usage.reduce((total, item) => total + item.costUsd, 0);
  const [runtimeAction, setRuntimeAction] = useState("");
  const [runtimeMessage, setRuntimeMessage] = useState("");
  const configureRuntime = async (
    action: string,
    request: () => Promise<RuntimeConfigurationResult>,
  ) => {
    if (!window.studyQuest || runtimeAction) return;
    setRuntimeAction(action);
    setRuntimeMessage("");
    try {
      const result = await request();
      if (result.canceled) return;
      if (!result.ok) {
        setRuntimeMessage(result.error || "설정을 저장하지 못했습니다.");
        return;
      }
      setRuntimeMessage(result.restarting
        ? "설정을 저장했습니다. 새 위치를 적용하도록 앱을 다시 시작합니다."
        : "설정을 저장했습니다.");
    } catch (error) {
      setRuntimeMessage(error instanceof Error ? error.message : "설정을 저장하지 못했습니다.");
    } finally {
      setRuntimeAction("");
    }
  };
  return (
    <section className="page settings-page">
      <div className="page-header"><div><span className="eyebrow">Portable & private</span><h1>에이전트는 교체해도,<br />학습 상태는 내 폴더에.</h1><p>AI 대화가 원본이 아니라 포터블 폴더의 구조화된 스킬 그래프가 원본입니다.</p></div><div className="button-row"><button className="button" onClick={onOpenSetup}><Sparkles size={14} /> 초기 연결 다시 열기</button><button className="button" onClick={onRefreshProviders}><RefreshCw size={14} /> 연결 다시 확인</button></div></div>
      <div className="card settings-list">
        <div className="settings-row"><div className="settings-label"><strong>화면 모드</strong><span>밝은 화면과 눈부심을 줄인 어두운 화면을 즉시 전환하며 다음 실행에도 유지합니다.</span></div><div className="button-row"><button className={`button${envelope.preferences.theme === "light" ? " primary" : ""}`} onClick={() => onUpdatePreferences({ ...envelope.preferences, theme: "light" })}><Sun size={14} /> 라이트</button><button className={`button${envelope.preferences.theme === "dark" ? " primary" : ""}`} onClick={() => onUpdatePreferences({ ...envelope.preferences, theme: "dark" })}><Moon size={14} /> 다크</button></div></div>
        <div className="settings-row"><div className="settings-label"><strong>AI 생활 시간표</strong><span>첫 과목 등록 대화에서 실제 학습 가능 시간과 요일 예외를 조사해 결정합니다.</span></div><div className="provider-card"><div className="provider-card-copy"><strong><Clock3 size={14} /> 기본 {envelope.learning.schedulePolicy.defaultReadyAt ?? envelope.checkIn.readyAt}~{envelope.learning.schedulePolicy.learningDeadline}</strong><p>{envelope.learning.schedulePolicy.constraintsSummary || "아직 인터뷰로 확정되지 않은 안전 기본값입니다."}</p><p>집중 {envelope.learning.schedulePolicy.maxSessionMinutes}분 · 정리 {envelope.learning.schedulePolicy.wrapUpMinutes}분 · 요일 예외 {envelope.learning.schedulePolicy.dayOverrides?.length ?? 0}개</p></div><span className={`tag ${envelope.learning.schedulePolicy.configuredBy === "ai-interview" ? "mint" : ""}`}>{envelope.learning.schedulePolicy.configuredBy === "ai-interview" ? "AI 확정" : "임시값"}</span></div></div>
        <div className="settings-row">
          <div className="settings-label">
            <strong>AI 라우팅</strong>
            <span>Codex CLI는 자동 인식합니다. Claude Agent는 실행 파일을 직접 승인하고 Anthropic API 키를 저장한 뒤, 라우팅에서 직접 선택했을 때만 동작합니다.</span>
          </div>
          <div>
            <select className="select" value={envelope.preferences.provider} onChange={(event) => onUpdatePreferences({ ...envelope.preferences, provider: event.target.value as AppEnvelope["preferences"]["provider"] })}>
              <option value="auto">자동 라우팅</option>
              <option value="codex">Codex CLI</option>
              <option value="claude">Claude Agent (CLI)</option>
              <option value="openai">OpenAI API</option>
              <option value="anthropic">Claude API</option>
              <option value="deepseek">DeepSeek API</option>
            </select>
            <div className="section-gap">
              <ProviderCard name="Codex CLI" status={providerStatus.codex} icon={<SquareTerminal size={15} />} />
              <ProviderCard name="Claude Agent (CLI + API 키)" status={providerStatus.claude} icon={<SquareTerminal size={15} />} />
            </div>
            <div className="runtime-path-grid section-gap">
              <div>
                <p className="field-hint">Codex: {runtime?.cliPaths.codex ? "지정 경로" : "번들 및 설치 위치 자동 탐색"}</p>
                <div className="button-row">
                  <button className="button" disabled={Boolean(runtimeAction)} onClick={() => void configureRuntime("codex", () => window.studyQuest!.runtime.pickCliExecutable("codex"))}><FolderOpen size={14} /> 경로 선택</button>
                  {runtime?.cliPaths.codex && <button className="button" disabled={Boolean(runtimeAction)} onClick={() => void configureRuntime("codex-auto", () => window.studyQuest!.runtime.useAutomaticCli("codex"))}><RotateCcw size={14} /> 자동 탐색</button>}
                </div>
              </div>
              <div>
                <p className="field-hint">Claude Agent: {runtime?.cliPaths.claude ? "승인된 실행 파일" : providerStatus.claude.source ? "감지됨 · 사용 전 승인 필요" : "실행 파일 승인 필요"}</p>
                {!runtime?.cliPaths.claude && providerStatus.claude.source && <p className="field-hint mono">감지 위치: {providerStatus.claude.source}</p>}
                <div className="button-row">
                  <button className="button" disabled={Boolean(runtimeAction)} onClick={() => void configureRuntime("claude", () => window.studyQuest!.runtime.pickCliExecutable("claude"))}><FolderOpen size={14} /> 실행 파일 승인</button>
                  {runtime?.cliPaths.claude && <button className="button" disabled={Boolean(runtimeAction)} onClick={() => void configureRuntime("claude-auto", () => window.studyQuest!.runtime.useAutomaticCli("claude"))}><RotateCcw size={14} /> 승인 해제</button>}
                </div>
              </div>
            </div>
            <p className="field-hint section-gap credential-note"><ShieldCheck size={13} /> {providerStatus.anthropic.configured
              ? providerStatus.anthropic.available
                ? providerStatus.anthropic.verifiedAt
                  ? "Anthropic API 연결이 확인되었습니다. Claude Agent를 직접 선택하면 이 키를 사용하며 구독 로그인으로 폴백하지 않습니다."
                  : "Anthropic API 키가 암호화 저장되어 사용할 수 있습니다. 실제 연결 확인은 아래의 연결 확인 버튼으로 진행하세요."
                : `저장된 Anthropic API 키를 다시 연결해 주세요. ${providerStatus.anthropic.reason ?? "Claude Agent는 키를 사용할 수 있을 때까지 실행되지 않습니다."}`
              : "Claude Agent를 사용하려면 아래에서 본인의 Anthropic API 키를 먼저 저장해야 합니다. 구독 로그인은 사용하지 않습니다."}</p>
          </div>
        </div>
        <div className="settings-row"><div className="settings-label"><strong>내 API 연결</strong><span>다른 사용자도 자기 키를 넣어 쓸 수 있습니다. 키는 일반 학습 상태와 분리해 이 Windows 사용자에게 묶인 암호문으로만 현재 데이터 폴더에 저장합니다.</span></div><div className="grid"><ApiProviderEditor provider="openai" name="OpenAI" defaultModel="gpt-5.6-terra" status={providerStatus.openai} onChanged={onRefreshProviders} /><ApiProviderEditor provider="anthropic" name="Anthropic (Claude API + Agent 키)" defaultModel="claude-sonnet-5" status={providerStatus.anthropic} onChanged={onRefreshProviders} /><ApiProviderEditor provider="deepseek" name="DeepSeek" defaultModel="deepseek-v4-flash" status={providerStatus.deepseek} onChanged={onRefreshProviders} /><p className="field-hint credential-note"><ShieldCheck size={13} /> Anthropic 키는 Claude API와 Claude Agent에서만 공유됩니다. 승인된 Claude Agent 실행 파일을 라우팅에서 직접 선택한 경우에만 키가 전달되며, <code>--bare</code>로 구독 자격 증명과 로컬 확장을 읽지 않습니다. 다른 키도 해당 공급자 밖으로 전달하지 않습니다.</p></div></div>
        <div className="settings-row"><div className="settings-label"><strong>최근 오류 기록</strong><span>오류 알림은 직접 닫을 때까지 남으며, 최근 50건의 사용자용 메시지를 보관합니다. 프롬프트와 API 키는 기록하지 않습니다.</span></div><div className="error-log-panel">{envelope.errorLog.length ? <>{envelope.errorLog.slice(-10).reverse().map((entry) => <div className="error-log-entry" key={entry.id}><div><strong>{entry.title}</strong><time dateTime={entry.at}>{formatErrorTimestamp(entry.at)}</time></div><p>{entry.message}</p></div>)}<button className="button danger" onClick={onClearErrorLog}><Trash2 size={14} /> 오류 기록 비우기</button></> : <p className="field-hint">아직 기록된 오류가 없습니다.</p>}</div></div>
        <div className="settings-row"><div className="settings-label"><strong>토큰 제작 예산</strong><span>강의와 커리큘럼에 쓸 월간 기준값입니다. 실제 공급자 한도와는 별개입니다.</span></div><div><div className="token-meter"><div className="token-stat"><strong>{tokens.toLocaleString()}</strong><span>기록된 토큰</span></div><div className="token-stat"><strong>{cached.toLocaleString()}</strong><span>캐시 입력</span></div><div className="token-stat"><strong>${cost.toFixed(3)}</strong><span>기록된 비용</span></div></div><label className="field section-gap"><span>월간 표시 예산</span><input className="input" type="number" min="10000" step="10000" value={envelope.preferences.monthlyTokenBudget} onChange={(event) => onUpdatePreferences({ ...envelope.preferences, monthlyTokenBudget: Number(event.target.value) })} /></label></div></div>
        <div className="settings-row"><div className="settings-label"><strong>저장 위치</strong><span>기본값은 앱이 놓인 포터블 폴더의 data 디렉터리입니다. 필요할 때만 다른 기존 폴더를 선택할 수 있습니다.</span></div><div><div className="provider-card"><div className="provider-card-copy"><strong><Database size={14} /> 포터블 루트</strong><p className="mono">{runtime?.portableRoot ?? "앱이 놓인 폴더"}</p><strong style={{ marginTop: 12 }}><ShieldCheck size={14} /> 현재 데이터 루트</strong><p className="mono">{runtime?.dataRoot ?? "앱이 놓인 폴더\\data"}</p><strong style={{ marginTop: 12 }}><FolderOpen size={14} /> 기본 데이터 루트</strong><p className="mono">{runtime?.defaultDataRoot ?? "앱이 놓인 폴더\\data"}</p></div><span className={`tag ${runtime?.dataRootIsDefault !== false ? "mint" : "violet"}`}>{runtime?.dataRootIsDefault !== false ? "앱 내부 기본값" : "사용자 지정"}</span></div><div className="button-row section-gap"><button className="button" disabled={Boolean(runtimeAction)} onClick={() => void configureRuntime("data-root", () => window.studyQuest!.runtime.pickDataRoot())}><FolderOpen size={14} /> 저장 폴더 변경</button>{runtime?.dataRootIsDefault === false && <button className="button" disabled={Boolean(runtimeAction)} onClick={() => void configureRuntime("data-default", () => window.studyQuest!.runtime.useDefaultDataRoot())}><RotateCcw size={14} /> 앱 내부 기본값</button>}</div><p className="field-hint">변경은 재시작 후 적용됩니다. 기존 데이터는 안전을 위해 자동 이동하거나 삭제하지 않습니다.</p>{runtimeMessage && <p className="field-hint runtime-message">{runtimeMessage}</p>}</div></div>
        <div className="settings-row"><div className="settings-label"><strong>게임 시간 보호</strong><span>{envelope.learning.schedulePolicy.gameStart}~{envelope.learning.schedulePolicy.gameEnd}를 학습 계획이 침범하지 못하게 합니다.</span></div><label className="provider-card" style={{ alignItems: "center" }}><div className="provider-card-copy"><strong><Gamepad2 size={14} /> 인터뷰로 정한 보상 루틴</strong><p>타이머와 계획이 시간을 보호하며 게임 프로세스를 강제 종료하지는 않습니다.</p></div><input type="checkbox" checked={envelope.preferences.protectGameTime} onChange={(event) => onUpdatePreferences({ ...envelope.preferences, protectGameTime: event.target.checked })} /></label></div>
        <div className="settings-row"><div className="settings-label"><strong>학습 상태 초기화</strong><span>포터블 앱의 studyquest.json에서 과목·진단·커리큘럼만 비우고 새 인터뷰로 돌아갑니다. AI 연결과 오류 기록은 유지합니다.</span></div><div><button className="button danger" onClick={onReset}><RotateCcw size={14} /> 과목 비우고 다시 시작</button><p className="field-hint">앱 전체 삭제는 앱을 종료한 뒤 압축을 풀어 둔 StudyQuest 폴더를 삭제하면 됩니다.</p></div></div>
      </div>
    </section>
  );
}

function CommandDock({ onSubmit }: { onSubmit(value: string): void }) {
  const [value, setValue] = useState("");
  const completion = findPromptCompletion(value, COMMAND_PROMPT_SUGGESTIONS);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) return;
    onSubmit(value.trim());
    setValue("");
  };
  return <form className="command-dock" onSubmit={submit}>{completion && <div className="tab-completion-hint command-completion"><kbd>Tab</kbd><span>{completion}</span></div>}<Sparkles size={17} /><input className="command-input" value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Tab" && completion && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.nativeEvent.isComposing) { event.preventDefault(); setValue(completion); } }} placeholder={COMMAND_PROMPT_PLACEHOLDER} /><button className="button primary icon-only" aria-label="학습 지시 보내기"><Send size={15} /></button></form>;
}

function ApiProviderEditor({
  provider,
  name,
  defaultModel,
  status,
  onChanged,
}: {
  provider: APIProviderId;
  name: string;
  defaultModel: string;
  status: ProviderProbe;
  onChanged(): Promise<void>;
}) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(status.version ?? defaultModel);
  const [pending, setPending] = useState<"save" | "test" | "remove" | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (status.version) setModel(status.version);
  }, [status.version]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const secret = apiKey;
    setApiKey("");
    setMessage("");
    if (!secret.trim()) {
      setMessage("새 API 키를 입력하세요.");
      return;
    }
    if (!window.studyQuest) return;
    setPending("save");
    try {
      const saved = await window.studyQuest.credentials.set({ provider, apiKey: secret, model });
      if (!saved.ok) {
        setMessage(saved.error ?? "키를 저장하지 못했습니다.");
        return;
      }
      const tested = await window.studyQuest.credentials.test(provider);
      setMessage(tested.ok
        ? "암호화 저장과 연결 확인을 마쳤습니다."
        : `키는 암호화 저장했습니다. 연결 확인: ${tested.error ?? "실패"}`);
      await onChanged();
    } finally {
      setPending(null);
    }
  };

  const test = async () => {
    if (!window.studyQuest) return;
    setPending("test");
    setMessage("");
    try {
      const result = await window.studyQuest.credentials.test(provider);
      setMessage(result.ok ? "현재 키와 모델로 연결됩니다." : result.error ?? "연결 확인에 실패했습니다.");
      await onChanged();
    } finally {
      setPending(null);
    }
  };

  const remove = async () => {
    if (!window.studyQuest || !window.confirm(`${name} 연결 키를 이 PC에서 삭제할까요?`)) return;
    setPending("remove");
    setApiKey("");
    setMessage("");
    try {
      const result = await window.studyQuest.credentials.remove(provider);
      setMessage(result.ok ? "저장된 연결 키를 삭제했습니다." : result.error ?? "삭제하지 못했습니다.");
      await onChanged();
    } finally {
      setPending(null);
    }
  };

  const stateLabel = status.needsReconnect
    ? "RECONNECT"
    : status.verifiedAt
      ? "VERIFIED"
      : status.available
        ? "SAVED"
        : "OFF";

  return (
    <form className="provider-card api-provider-editor" onSubmit={save}>
      <div className="api-provider-heading">
        <div className="provider-card-copy">
          <strong><KeyRound size={15} /><span className={`status-dot${status.available ? " is-on" : ""}`} />{name}</strong>
          <p>{status.needsReconnect ? status.reason : status.available ? `${status.version} · ${status.verifiedAt ? "연결 확인됨" : "암호화 저장됨"}` : status.reason}</p>
        </div>
        <span className={`tag ${status.verifiedAt ? "mint" : ""}`}>{stateLabel}</span>
      </div>
      <div className="api-provider-fields">
        <label className="field"><span>모델</span><input className="input mono" value={model} onChange={(event) => setModel(event.target.value)} maxLength={120} autoComplete="off" spellCheck={false} /></label>
        <label className="field"><span>API 키</span><input className="input mono" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} maxLength={4096} autoComplete="new-password" spellCheck={false} placeholder={status.available ? "새 키로 교체할 때만 입력" : "내 API 키 입력"} /></label>
      </div>
      <div className="button-row api-provider-actions">
        <button className="button primary" type="submit" disabled={pending !== null || !apiKey.trim()}>{pending === "save" ? "확인 중…" : "암호화 저장 + 확인"}</button>
        <button className="button" type="button" disabled={pending !== null || !status.available} onClick={() => void test()}>{pending === "test" ? "확인 중…" : "연결 확인"}</button>
        <button className="button danger icon-only" type="button" aria-label={`${name} 연결 삭제`} disabled={pending !== null || !status.configured} onClick={() => void remove()}><Trash2 size={14} /></button>
      </div>
      {message && <p className="api-provider-message" role="status">{message}</p>}
    </form>
  );
}

function ProviderCard({ name, status, icon }: { name: string; status: ProviderProbe; icon: ReactNode }) {
  return <div className="provider-card"><div className="provider-card-copy"><strong>{icon}<span className={`status-dot${status.available ? " is-on" : ""}`} />{name}</strong><p>{status.available ? `${status.version ?? "설치됨"} · ${status.source ?? "로컬 런타임"}` : status.reason ?? "사용할 수 없음"}</p></div><span className={`tag ${status.available ? "mint" : ""}`}>{status.available ? "INSTALLED" : "OFF"}</span></div>;
}

function EmptyState({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="empty-state"><div>{icon}<strong>{title}</strong><p>{text}</p></div></div>;
}
