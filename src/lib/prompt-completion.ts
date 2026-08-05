const normalizeForMatch = (value: string) => value
  .trimStart()
  .replace(/\s+/g, " ")
  .toLocaleLowerCase("ko-KR");

export function findPromptCompletion(
  value: string,
  suggestions: readonly string[],
): string | undefined {
  const normalizedValue = normalizeForMatch(value);
  const candidates = suggestions
    .map((suggestion) => suggestion.trim())
    .filter(Boolean);

  if (!normalizedValue) return candidates[0];

  return candidates.find((suggestion) => {
    const normalizedSuggestion = normalizeForMatch(suggestion);
    return normalizedSuggestion !== normalizedValue
      && normalizedSuggestion.startsWith(normalizedValue);
  });
}
