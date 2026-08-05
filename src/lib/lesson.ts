import { createThirtyMinuteLesson } from "./engine";
import { normalizeSandboxWidget, type SandboxWidgetSource } from "./sandbox-widget";
import type { Quest, SkillNode } from "./types";

export type GeneratedLessonPhase =
  | "orient"
  | "explain"
  | "example"
  | "explore"
  | "synthesize";

export type LessonWidgetKind = "stepper" | "comparison" | "parameter-sweep";

export interface LessonWidgetItem {
  label: string;
  body: string;
  value: number;
}

export interface DeclarativeLessonWidget {
  id: string;
  kind: LessonWidgetKind;
  title: string;
  instruction: string;
  items: LessonWidgetItem[];
}

export type SandboxLessonWidget = SandboxWidgetSource & { kind: "sandbox-lab" };
export type LessonWidget = DeclarativeLessonWidget | SandboxLessonWidget;

export interface FinalCheckQuestion {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface FinalCheck {
  intro: string;
  questions: FinalCheckQuestion[];
}

export interface GeneratedLessonSegment {
  phase: GeneratedLessonPhase;
  minutes: number;
  heading: string;
  content: string;
  readingGuide: string;
  widget: LessonWidget | null;
}

export interface GeneratedLesson {
  title: string;
  objective: string;
  segments: GeneratedLessonSegment[];
  finalCheck: FinalCheck;
  successEvidence: string;
  reviewPrompt: string;
  generatedBy?: "codex" | "claude" | "openai" | "anthropic" | "deepseek" | "local";
}

export const lessonPhaseName: Record<GeneratedLessonPhase, string> = {
  orient: "학습 지도",
  explain: "개념 설명",
  example: "예제 해설",
  explore: "JS 위젯 탐색",
  synthesize: "핵심 연결",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const cleanText = (value: unknown, fallback: string, maxLength = 8_000): string => {
  const text = typeof value === "string" ? value.replace(/\u0000/g, "").trim() : "";
  return (text || fallback).slice(0, maxLength);
};

const clamp = (value: unknown, minimum: number, maximum: number): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return minimum;
  return Math.min(maximum, Math.max(minimum, numeric));
};

const normalizeWidget = (value: unknown): LessonWidget | null => {
  if (!isRecord(value)) return null;
  if (value.kind === "sandbox-lab") {
    const sandboxWidget = normalizeSandboxWidget(value);
    return sandboxWidget ? { ...sandboxWidget, kind: "sandbox-lab" } : null;
  }
  if (!(["stepper", "comparison", "parameter-sweep"] as const).includes(value.kind as LessonWidgetKind)) {
    return null;
  }
  const items = Array.isArray(value.items)
    ? value.items
        .filter(isRecord)
        .slice(0, 8)
        .map((item, index) => ({
          label: cleanText(item.label, `단계 ${index + 1}`, 100),
          body: cleanText(item.body, "이 단계의 변화를 관찰하세요.", 1_000),
          value: Math.round(clamp(item.value, 0, 100)),
        }))
    : [];
  if (items.length < 2) return null;
  return {
    id: cleanText(value.id, `widget-${String(value.kind)}`, 100),
    kind: value.kind as LessonWidgetKind,
    title: cleanText(value.title, "개념 탐색 위젯", 200),
    instruction: cleanText(value.instruction, "컨트롤을 움직이며 변화의 흐름을 살펴보세요.", 500),
    items,
  };
};

const normalizeFinalCheck = (value: unknown): FinalCheck | null => {
  if (!isRecord(value) || !Array.isArray(value.questions)) return null;
  const questions = value.questions
    .filter(isRecord)
    .slice(0, 4)
    .map((question, index) => {
      const options = Array.isArray(question.options)
        ? question.options.slice(0, 4).map((option, optionIndex) =>
            cleanText(option, `선택지 ${optionIndex + 1}`, 500))
        : [];
      const correctIndex = Math.round(Number(question.correctIndex));
      if (options.length !== 4 || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
        return null;
      }
      return {
        id: cleanText(question.id, `final-${index + 1}`, 100),
        prompt: cleanText(question.prompt, "본문의 핵심 원리를 고르세요.", 1_000),
        options,
        correctIndex,
        explanation: cleanText(question.explanation, "본문의 설명과 연결해 다시 확인하세요.", 1_000),
      };
    })
    .filter((question): question is FinalCheckQuestion => question !== null);
  if (questions.length < 2) return null;
  return {
    intro: cleanText(value.intro, "이제 본문 전체를 바탕으로 마지막 확인을 진행합니다.", 500),
    questions,
  };
};

export function localLesson(quest: Quest, skill?: SkillNode): GeneratedLesson {
  const skillName = skill?.name ?? "핵심 개념";
  const source = createThirtyMinuteLesson(quest, skillName);
  const phases = new Set<GeneratedLessonPhase>([
    "orient", "explain", "example", "explore", "synthesize",
  ]);
  return {
    title: source.title,
    objective: quest.description,
    segments: source.phases.map((phase) => {
      const mappedPhase = phases.has(phase.kind as GeneratedLessonPhase)
        ? phase.kind as GeneratedLessonPhase
        : "explain";
      return {
        phase: mappedPhase,
        minutes: phase.durationMinutes,
        heading: lessonPhaseName[mappedPhase],
        content: phase.coachPrompt,
        readingGuide: mappedPhase === "explore"
          ? "컨트롤을 한 번 이상 움직여 단계 사이의 변화를 확인합니다."
          : "답을 적지 않고 정의, 조건, 변화의 연결을 따라 읽습니다.",
        widget: mappedPhase === "explore"
          ? {
              id: `learning-flow-${quest.id}`,
              kind: "stepper" as const,
              title: `${skillName} 학습 흐름`,
              instruction: "이전·다음 버튼으로 개념이 결과물까지 연결되는 순서를 살펴보세요.",
              items: [
                { label: "개념", body: `${skillName}의 정의와 성립 조건을 분리해 읽습니다.`, value: 20 },
                { label: "예제", body: "주어진 조건과 중간 과정이 결과를 만드는 흐름을 따라갑니다.", value: 45 },
                { label: "변형", body: "조건이 바뀌어도 유지되는 원리와 달라지는 결과를 비교합니다.", value: 72 },
                { label: "증거", body: quest.requiredEvidence, value: 100 },
              ],
            }
          : null,
      };
    }),
    finalCheck: {
      intro: "본문과 위젯 학습을 마쳤습니다. 이제 두 문항으로 학습 구조를 마지막 확인합니다.",
      questions: [
        {
          id: `evidence-${quest.id}`,
          prompt: "이번 퀘스트를 완료했다는 가장 직접적인 증거는 무엇인가요?",
          options: [
            quest.requiredEvidence,
            "본문을 한 번 열어 본 기록",
            "학습 시간을 끝까지 채운 기록",
            "AI에게 개념을 대신 요약하게 한 결과",
          ],
          correctIndex: 0,
          explanation: "학습 시간이나 열람 여부보다 실제로 만든 결과물이 숙련도의 직접적인 증거가 됩니다.",
        },
        {
          id: `sequence-${quest.id}`,
          prompt: "새로운 문제에 같은 원리를 옮기기 위한 가장 적절한 순서는 무엇인가요?",
          options: [
            "결과 암기 → 시간 기록 → 제출",
            "정의·조건 파악 → 예제의 과정 관찰 → 변형에 적용",
            "정답 확인 → 설명 건너뛰기 → 유사 답안 복사",
            "용어 수집 → 질문 반복 → 결과물 생략",
          ],
          correctIndex: 1,
          explanation: "정의와 조건을 먼저 파악하고 예제의 과정을 관찰해야 원리를 새로운 조건에 전이할 수 있습니다.",
        },
      ],
    },
    successEvidence: quest.requiredEvidence,
    reviewPrompt: "제출한 결과물은 AI가 정확성·독립성·전이·설명력을 함께 판단합니다.",
    generatedBy: "local",
  };
}

export function normalizeGeneratedLesson(
  candidate: unknown,
  fallback: GeneratedLesson,
): GeneratedLesson {
  if (!isRecord(candidate) || !Array.isArray(candidate.segments)) return fallback;

  const allowed = new Set<GeneratedLessonPhase>([
    "orient", "explain", "example", "explore", "synthesize",
  ]);
  const hasLegacyQuestionFlow = candidate.segments.some((segment) =>
    isRecord(segment) && (
      "userAction" in segment
      || ["recall", "probe", "apply", "verify", "wrap", "submit"].includes(String(segment.phase))
    ));
  if (hasLegacyQuestionFlow) return fallback;

  const segments = candidate.segments
    .filter(isRecord)
    .slice(0, 6)
    .map((segment) => {
      if (!allowed.has(segment.phase as GeneratedLessonPhase)) return null;
      const content = cleanText(segment.content, "", 8_000);
      if (content.length < 40) return null;
      return {
        phase: segment.phase as GeneratedLessonPhase,
        minutes: Math.max(1, Math.round(clamp(segment.minutes, 1, 60))),
        heading: cleanText(segment.heading, lessonPhaseName[segment.phase as GeneratedLessonPhase], 300),
        content,
        readingGuide: cleanText(segment.readingGuide, "정의, 조건, 변화의 연결을 따라 읽습니다.", 500),
        widget: normalizeWidget(segment.widget),
      };
    })
    .filter((segment): segment is GeneratedLessonSegment => segment !== null);

  const finalCheck = normalizeFinalCheck(candidate.finalCheck);
  if (segments.length < 4 || !segments.some((segment) => segment.widget) || !finalCheck) return fallback;

  const rawTotal = segments.reduce((sum, segment) => sum + segment.minutes, 0);
  const normalized = segments.map((segment) => ({
    ...segment,
    minutes: Math.max(1, Math.floor((segment.minutes / rawTotal) * 30)),
  }));
  let total = normalized.reduce((sum, segment) => sum + segment.minutes, 0);
  let cursor = 0;
  while (total < 30) {
    normalized[cursor % normalized.length].minutes += 1;
    cursor += 1;
    total += 1;
  }
  while (total > 30) {
    const index = cursor % normalized.length;
    if (normalized[index].minutes > 1) {
      normalized[index].minutes -= 1;
      total -= 1;
    }
    cursor += 1;
  }

  return {
    title: cleanText(candidate.title, fallback.title, 500),
    objective: cleanText(candidate.objective, fallback.objective, 2_000),
    segments: normalized,
    finalCheck,
    successEvidence: cleanText(candidate.successEvidence, fallback.successEvidence, 1_000),
    reviewPrompt: cleanText(candidate.reviewPrompt, fallback.reviewPrompt, 1_000),
    generatedBy: (["codex", "claude", "openai", "anthropic", "deepseek", "local"] as const)
      .includes(candidate.generatedBy as GeneratedLesson["generatedBy"] & string)
      ? candidate.generatedBy as GeneratedLesson["generatedBy"]
      : undefined,
  };
}
