const normalizeForMatch = (value: string) => value
  .trim()
  .replace(/\s+/g, " ")
  .toLocaleLowerCase("ko-KR");

export const COMMAND_PROMPT_SUGGESTIONS = [
  "오늘 너무 피곤해. 각 과목을 최소 학습량으로 줄여줘.",
  "이번 주 React 부스트를 켜고 다른 과목은 최소 유지로 조정해줘.",
  "수학 때문에 원고가 막혔어. 다음 퀘스트 우선순위를 조정해줘.",
] as const;

export const COMMAND_PROMPT_PLACEHOLDER = "예: 오늘 너무 피곤해 · 이번 주 React 부스트 · 수학 때문에 원고가 막혔어";

export function findPromptCompletion(
  value: string,
  suggestions: readonly string[],
): string | undefined {
  const normalizedValue = normalizeForMatch(value);
  const candidates = suggestions
    .map((suggestion) => suggestion.trim())
    .filter(Boolean)
    .filter((suggestion, index, all) => (
      all.findIndex((candidate) => normalizeForMatch(candidate) === normalizeForMatch(suggestion)) === index
    ));

  if (!normalizedValue) return candidates[0];

  const completedIndex = candidates.findIndex(
    (suggestion) => normalizeForMatch(suggestion) === normalizedValue,
  );
  if (completedIndex >= 0) {
    if (candidates.length < 2) return undefined;
    return candidates[(completedIndex + 1) % candidates.length];
  }

  return candidates.find((suggestion) => {
    const normalizedSuggestion = normalizeForMatch(suggestion);
    return normalizedSuggestion.startsWith(normalizedValue);
  });
}
