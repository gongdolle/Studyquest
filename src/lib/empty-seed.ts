import type { StudyQuestState } from "./types";

export const createEmptyStudyState = (): StudyQuestState => ({
  stage: "intake",
  subjects: [],
  resources: [],
  goals: [],
  gaps: [],
  skillGraphs: [],
  diagnostics: [],
  sessions: [],
  evidence: [],
  boosts: [],
  schedulePolicy: {
    configuredBy: "fallback",
    defaultReadyAt: "19:30",
    learningDeadline: "23:00",
    wrapUpMinutes: 10,
    gameStart: "23:00",
    gameEnd: "24:00",
    mainMinimumMinutes: 30,
    mainPreferredMinutes: 80,
    maxSessionMinutes: 30,
    dayOverrides: [],
    constraintsSummary: "아직 사용자 인터뷰로 확정되지 않은 안전 기본값",
  },
});
