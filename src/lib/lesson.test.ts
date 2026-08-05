import { describe, expect, it } from "vitest";
import { localLesson, normalizeGeneratedLesson } from "./lesson";
import type { Quest } from "./types";

const quest: Quest = {
  id: "quest-reading-first",
  date: "2026-08-04",
  title: "상태공간 개념 정리",
  description: "상태와 출력의 관계를 책의 한 절로 정리한다.",
  primarySubjectId: "control",
  taggedSubjectIds: [],
  skillIds: ["state-space"],
  estimatedMinutes: 30,
  kind: "authoring",
  requiredEvidence: "정의, 조건, 예제가 포함된 원고 한 절",
  status: "planned",
};

describe("reading-first lesson contract", () => {
  it("builds a 30-minute local lesson with reading before a safe widget and final questions", () => {
    const lesson = localLesson(quest);

    expect(lesson.segments.reduce((total, segment) => total + segment.minutes, 0)).toBe(30);
    expect(lesson.segments.map((segment) => segment.phase)).toEqual([
      "orient", "explain", "example", "explore", "synthesize",
    ]);
    expect(lesson.segments.some((segment) => segment.widget?.kind === "stepper")).toBe(true);
    expect(lesson.segments.every((segment) => !("userAction" in segment))).toBe(true);
    expect(lesson.finalCheck.questions).toHaveLength(2);
  });

  it("replaces a persisted legacy Q&A lesson instead of exposing its early questions", () => {
    const fallback = localLesson(quest);
    const legacy = {
      title: "old",
      objective: "old",
      segments: Array.from({ length: 4 }, (_, index) => ({
        phase: index === 0 ? "recall" : "probe",
        minutes: 5,
        heading: "질문",
        content: "무엇을 알고 있는지 답하세요.",
        userAction: "지금 답하세요.",
      })),
      successEvidence: "old",
      reviewPrompt: "old",
    };

    expect(normalizeGeneratedLesson(legacy, fallback)).toBe(fallback);
  });

  it("rejects generated lessons that omit widgets or put malformed final checks at the end", () => {
    const fallback = localLesson(quest);
    const unsafe = {
      title: "generated",
      objective: "objective",
      segments: fallback.segments.map((segment) => ({ ...segment, widget: null })),
      finalCheck: { intro: "끝", questions: [] },
      successEvidence: "result",
      reviewPrompt: "review",
    };

    expect(normalizeGeneratedLesson(unsafe, fallback)).toBe(fallback);
  });

  it("accepts a subject-specific sandbox lab only after its code passes the conservative validator", () => {
    const fallback = localLesson(quest);
    const candidate = {
      ...fallback,
      generatedBy: "codex",
      segments: fallback.segments.map((segment) => ({
        ...segment,
        widget: segment.phase === "explore" ? {
          id: "state-space-lab",
          kind: "sandbox-lab",
          title: "상태 변화 실험",
          instruction: "슬라이더를 움직여 상태 변화가 출력에 반영되는 흐름을 관찰합니다.",
          html: '<label for="state">상태</label><input id="state" type="range" min="0" max="10" value="2"><output id="result">2</output>',
          css: "body { padding: 20px; } input { width: 100%; }",
          javascript: 'const state=document.querySelector("#state");const result=document.querySelector("#result");state.addEventListener("input",()=>{result.textContent=state.value;});',
          height: 320,
        } : null,
      })),
    };

    const normalized = normalizeGeneratedLesson(candidate, fallback);
    expect(normalized).not.toBe(fallback);
    expect(normalized.segments.find((segment) => segment.widget)?.widget?.kind).toBe("sandbox-lab");

    const unsafe = structuredClone(candidate);
    const unsafeWidget = unsafe.segments.find((segment) => segment.widget)?.widget;
    if (unsafeWidget && unsafeWidget.kind === "sandbox-lab") unsafeWidget.javascript = "fetch('https://example.com')";
    expect(normalizeGeneratedLesson(unsafe, fallback)).toBe(fallback);
  });
});
