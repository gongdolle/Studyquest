import { describe, expect, it } from "vitest";
import {
  COMMAND_PROMPT_SUGGESTIONS,
  findPromptCompletion,
} from "./prompt-completion";

const suggestions = [
  "오늘 너무 피곤하니 각 과목을 최소 학습량으로 줄여줘.",
  "이번 주 React를 부스트하고 다른 과목은 최소 유지로 조정해줘.",
  "수학 때문에 원고가 막혔어. 다음 퀘스트 우선순위를 조정해줘.",
];

describe("prompt completion", () => {
  it("offers the first suggestion for an empty prompt", () => {
    expect(findPromptCompletion("", suggestions)).toBe(suggestions[0]);
  });

  it("matches a typed prefix while ignoring repeated whitespace and case", () => {
    expect(findPromptCompletion("  이번   주 react", suggestions)).toBe(suggestions[1]);
  });

  it("cycles completed suggestions and wraps after the last one", () => {
    expect(findPromptCompletion(suggestions[0], suggestions)).toBe(suggestions[1]);
    expect(findPromptCompletion(suggestions[1], suggestions)).toBe(suggestions[2]);
    expect(findPromptCompletion(suggestions[2], suggestions)).toBe(suggestions[0]);
    expect(findPromptCompletion(`  ${suggestions[0]}  `, suggestions)).toBe(suggestions[1]);
  });

  it("does not replace an unrelated prompt or loop a single suggestion", () => {
    expect(findPromptCompletion("수학 일정을 바꿔줘", suggestions)).toBeUndefined();
    expect(findPromptCompletion(suggestions[0], [suggestions[0]])).toBeUndefined();
    expect(findPromptCompletion(suggestions[0], [suggestions[0], `  ${suggestions[0]}  `])).toBeUndefined();
  });

  it("completes every short phrase shown in the command placeholder", () => {
    expect(findPromptCompletion("오늘 너무 피곤해", COMMAND_PROMPT_SUGGESTIONS))
      .toBe(COMMAND_PROMPT_SUGGESTIONS[0]);
    expect(findPromptCompletion("이번 주 React 부스트", COMMAND_PROMPT_SUGGESTIONS))
      .toBe(COMMAND_PROMPT_SUGGESTIONS[1]);
    expect(findPromptCompletion("수학 때문에 원고가 막혔어", COMMAND_PROMPT_SUGGESTIONS))
      .toBe(COMMAND_PROMPT_SUGGESTIONS[2]);
  });
});
