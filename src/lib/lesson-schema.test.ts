import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";

const schema = JSON.parse(readFileSync(resolve("schemas/lesson.schema.json"), "utf8"));
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
const article = "정의와 조건을 먼저 분리해 읽고, 입력이 바뀔 때 출력과 중간 상태가 어떤 순서로 변하는지 구체적인 예를 따라간다. 결과만 암기하지 않고 변화 전후에 유지되는 원리를 연결하면 새로운 상황에도 같은 구조를 적용할 수 있다. ".repeat(3);

const validLesson = {
  title: "읽기 우선 강의",
  objective: "설명과 예제를 읽고 위젯으로 변화를 관찰한다.",
  segments: ["orient", "explain", "example", "explore"].map((phase, index) => ({
    phase,
    minutes: index === 3 ? 9 : 7,
    heading: `본문 ${index + 1}`,
    content: article,
    readingGuide: "정의, 조건, 변화의 연결을 관찰한다.",
    widget: index === 3 ? {
      id: "safe-widget",
      kind: "parameter-sweep",
      title: "조건 변화",
      instruction: "슬라이더를 움직여 사전 계산된 단계의 차이를 살펴본다.",
      items: [
        { label: "낮음", body: "첫 번째 조건의 설명", value: 20 },
        { label: "높음", body: "두 번째 조건의 설명", value: 80 },
      ],
    } : null,
  })),
  finalCheck: {
    intro: "본문을 모두 마친 뒤 진행한다.",
    questions: [1, 2].map((number) => ({
      id: `question-${number}`,
      prompt: `핵심 원리를 고르는 문항 ${number}`,
      options: ["선택 1", "선택 2", "선택 3", "선택 4"],
      correctIndex: 1,
      explanation: "본문의 조건과 변화 관계에 따른 해설이다.",
    })),
  },
  successEvidence: "직접 만든 결과물",
  reviewPrompt: "결과물은 AI가 근거에 따라 평가한다.",
};

describe("lesson JSON schema safety", () => {
  it("accepts article blocks, allowlisted widget data and a separate final check", () => {
    expect(validate(validLesson)).toBe(true);
  });

  it("rejects arbitrary script fields in widget data", () => {
    const lesson = structuredClone(validLesson);
    Object.assign(lesson.segments[3].widget!, { script: "window.open('https://example.com')" });

    expect(validate(lesson)).toBe(false);
  });

  it("rejects the legacy per-segment Q&A contract", () => {
    const lesson = structuredClone(validLesson) as typeof validLesson & { segments: Array<Record<string, unknown>> };
    lesson.segments[0].phase = "recall";
    lesson.segments[0].userAction = "지금 답하세요.";

    expect(validate(lesson)).toBe(false);
  });
});
