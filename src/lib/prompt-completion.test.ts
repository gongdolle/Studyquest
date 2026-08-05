import { describe, expect, it } from "vitest";
import { findPromptCompletion } from "./prompt-completion";

const suggestions = [
  "오늘 너무 피곤하니 각 과목을 최소 학습량으로 줄여줘.",
  "이번 주 React를 부스트하고 다른 과목은 최소 유지로 조정해줘.",
];

describe("prompt completion", () => {
  it("offers the first suggestion for an empty prompt", () => {
    expect(findPromptCompletion("", suggestions)).toBe(suggestions[0]);
  });

  it("matches a typed prefix while ignoring repeated whitespace and case", () => {
    expect(findPromptCompletion("  이번   주 react", suggestions)).toBe(suggestions[1]);
  });

  it("does not replace a completed or unrelated prompt", () => {
    expect(findPromptCompletion(suggestions[0], suggestions)).toBeUndefined();
    expect(findPromptCompletion("수학 일정을 바꿔줘", suggestions)).toBeUndefined();
  });
});
