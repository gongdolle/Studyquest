import {
  createDiagnostic,
  createSkillGraph,
  generateSevenDayCurriculum,
} from "./engine";
import type { SkillGraph, StudyQuestState, Subject } from "./types";

export const KOREAN_SEED_START_DATE = "2026-08-04";

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
    learningDeadline: "23:00",
    wrapUpMinutes: 10,
    gameStart: "23:00",
    gameEnd: "24:00",
    mainMinimumMinutes: 30,
    mainPreferredMinutes: 80,
    maxSessionMinutes: 30,
  },
});

export const seedSubjects: readonly Subject[] = [
  {
    id: "control-book",
    name: "제어공학 저서 집필",
    aliases: ["제어공학", "저서", "원고", "책"],
    role: "main",
    dailyTargetMinutes: 60,
    weeklyTargetMinutes: 420,
    minimumTouchMinutes: 30,
    priorityBoost: 0.8,
    active: true,
  },
  {
    id: "css",
    name: "CSS",
    aliases: ["css", "스타일", "스타일링"],
    role: "support",
    dailyTargetMinutes: 30,
    weeklyTargetMinutes: 210,
    minimumTouchMinutes: 10,
    priorityBoost: 0,
    active: true,
  },
  {
    id: "react",
    name: "React",
    aliases: ["react", "리액트"],
    role: "support",
    dailyTargetMinutes: 30,
    weeklyTargetMinutes: 210,
    minimumTouchMinutes: 10,
    priorityBoost: 0,
    active: true,
  },
  {
    id: "mathematics",
    name: "수학",
    aliases: ["수학", "선형대수", "미분방정식"],
    role: "support",
    dailyTargetMinutes: 30,
    weeklyTargetMinutes: 210,
    minimumTouchMinutes: 10,
    priorityBoost: 0,
    active: true,
  },
  {
    id: "english",
    name: "영어",
    aliases: ["영어", "영문", "논문 읽기"],
    role: "support",
    dailyTargetMinutes: 30,
    weeklyTargetMinutes: 210,
    minimumTouchMinutes: 10,
    priorityBoost: 0,
    active: true,
  },
];

export const seedSkillGraphs: readonly SkillGraph[] = [
  createSkillGraph("control-book", [
    {
      id: "control-feedback",
      name: "피드백의 의미",
      mastery: 0.68,
      uncertainty: 0.3,
    },
    {
      id: "control-transfer-function",
      name: "전달함수와 폐루프",
      prerequisiteIds: ["control-feedback"],
      mastery: 0.58,
      uncertainty: 0.4,
    },
    {
      id: "control-state-space",
      name: "상태공간 표현",
      prerequisiteIds: ["control-transfer-function"],
      mastery: 0.42,
      uncertainty: 0.7,
    },
    {
      id: "control-controllability",
      name: "가제어성과 가관측성",
      prerequisiteIds: ["control-state-space"],
      mastery: 0.28,
      uncertainty: 0.84,
    },
    {
      id: "control-pid-windup",
      name: "PID와 anti-windup",
      prerequisiteIds: ["control-feedback"],
      mastery: 0.38,
      uncertainty: 0.72,
    },
    {
      id: "control-authoring",
      name: "제어 개념을 독자 관점으로 설명하기",
      prerequisiteIds: ["control-transfer-function"],
      mastery: 0.35,
      uncertainty: 0.76,
    },
  ]),
  createSkillGraph("css", [
    {
      id: "css-box-model",
      name: "박스 모델",
      mastery: 0.62,
      uncertainty: 0.34,
    },
    {
      id: "css-layout",
      name: "Flexbox와 Grid 레이아웃",
      prerequisiteIds: ["css-box-model"],
      mastery: 0.5,
      uncertainty: 0.48,
    },
    {
      id: "css-responsive",
      name: "반응형 화면",
      prerequisiteIds: ["css-layout"],
      mastery: 0.34,
      uncertainty: 0.68,
    },
    {
      id: "css-control-visual",
      name: "제어 그래프 스타일링",
      prerequisiteIds: ["css-layout"],
      mastery: 0.24,
      uncertainty: 0.8,
    },
  ]),
  createSkillGraph("react", [
    {
      id: "react-component",
      name: "컴포넌트 설계",
      mastery: 0.64,
      uncertainty: 0.32,
    },
    {
      id: "react-state",
      name: "상태와 단방향 데이터 흐름",
      prerequisiteIds: ["react-component"],
      mastery: 0.54,
      uncertainty: 0.46,
    },
    {
      id: "react-hooks",
      name: "Hooks와 부수 효과",
      prerequisiteIds: ["react-state"],
      mastery: 0.42,
      uncertainty: 0.66,
    },
    {
      id: "react-control-visualizer",
      name: "제어 응답 시각화 컴포넌트",
      prerequisiteIds: ["react-hooks"],
      mastery: 0.26,
      uncertainty: 0.82,
    },
  ]),
  createSkillGraph("mathematics", [
    {
      id: "math-linear-algebra",
      name: "선형대수 기초",
      mastery: 0.56,
      uncertainty: 0.4,
    },
    {
      id: "math-differential-equation",
      name: "미분방정식 모델링",
      mastery: 0.48,
      uncertainty: 0.54,
    },
    {
      id: "math-laplace",
      name: "라플라스 변환",
      prerequisiteIds: ["math-differential-equation"],
      mastery: 0.4,
      uncertainty: 0.65,
    },
    {
      id: "math-eigen",
      name: "고유값과 시스템 안정성",
      prerequisiteIds: ["math-linear-algebra"],
      mastery: 0.34,
      uncertainty: 0.72,
    },
  ]),
  createSkillGraph("english", [
    {
      id: "english-terms",
      name: "제어공학 영문 용어",
      mastery: 0.58,
      uncertainty: 0.38,
    },
    {
      id: "english-paper-reading",
      name: "영문 논문 핵심 읽기",
      prerequisiteIds: ["english-terms"],
      mastery: 0.5,
      uncertainty: 0.5,
    },
    {
      id: "english-explanation",
      name: "수식의 영어 설명",
      prerequisiteIds: ["english-terms"],
      mastery: 0.38,
      uncertainty: 0.66,
    },
    {
      id: "english-technical-writing",
      name: "기술 문단 영작",
      prerequisiteIds: ["english-paper-reading", "english-explanation"],
      mastery: 0.3,
      uncertainty: 0.76,
    },
  ]),
];

export const createKoreanSeedState = (
  startDate = KOREAN_SEED_START_DATE,
): StudyQuestState => {
  const baseState: StudyQuestState = {
    stage: "intake",
    subjects: seedSubjects.map((subject) => ({ ...subject, aliases: [...subject.aliases] })),
    resources: [
      {
        id: "resource-control-manuscript",
        subjectId: "control-book",
        kind: "manuscript",
        title: "집필 중인 제어공학 저서 원고",
        currentSection: "상태공간과 가제어성",
      },
    ],
    goals: [
      {
        id: "goal-control-book",
        subjectId: "control-book",
        text: "모르는 부분을 피하지 않고 검증 가능한 설명으로 바꾸어 저서를 완성한다.",
        successEvidence: "수식, 반례, 시뮬레이션이 연결된 원고 수정본",
        priority: 1,
      },
      {
        id: "goal-css",
        subjectId: "css",
        text: "학습 앱과 제어 그래프를 읽기 쉽게 스타일링한다.",
        successEvidence: "반응형 CSS가 적용된 화면",
        priority: 0.55,
      },
      {
        id: "goal-react",
        subjectId: "react",
        text: "제어공학 개념을 조작하며 확인할 React 시각화기를 만든다.",
        successEvidence: "입력에 따라 응답 곡선이 바뀌는 컴포넌트",
        priority: 0.65,
      },
      {
        id: "goal-mathematics",
        subjectId: "mathematics",
        text: "제어 이론에 쓰는 수식을 유도하고 가정을 설명한다.",
        successEvidence: "중간 단계를 생략하지 않은 유도 노트",
        priority: 0.7,
      },
      {
        id: "goal-english",
        subjectId: "english",
        text: "영문 제어 자료를 읽고 내 말로 정확히 요약한다.",
        successEvidence: "근거 문장과 용어를 포함한 영문 요약",
        priority: 0.55,
      },
    ],
    gaps: [
      {
        id: "gap-controllability-intuition",
        subjectId: "control-book",
        rawText: "가제어성을 행렬 랭크 계산이 아니라 독자가 직관적으로 이해하게 설명하기 어렵다.",
        linkedSkillIds: ["control-state-space", "control-controllability", "control-authoring"],
        urgency: 0.95,
        status: "new",
      },
      {
        id: "gap-control-visualizer",
        subjectId: "react",
        rawText: "제어 응답 시각화의 상태 구조와 그래프 스타일을 함께 설계하고 싶다.",
        linkedSkillIds: ["react-control-visualizer", "css-control-visual"],
        urgency: 0.75,
        status: "new",
      },
    ],
    skillGraphs: seedSkillGraphs.map((graph) => ({
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        prerequisiteIds: [...node.prerequisiteIds],
        evidenceIds: [...node.evidenceIds],
      })),
      edges: graph.edges.map((edge) => ({ ...edge })),
    })),
    diagnostics: [],
    sessions: [],
    evidence: [],
    boosts: [],
    schedulePolicy: {
      learningDeadline: "23:00",
      wrapUpMinutes: 10,
      gameStart: "23:00",
      gameEnd: "24:00",
      mainMinimumMinutes: 30,
      mainPreferredMinutes: 80,
      maxSessionMinutes: 30,
    },
  };

  const withDiagnostic = createDiagnostic(baseState, "control-book", 4).state;
  return {
    ...withDiagnostic,
    stage: "curriculum",
    curriculum: generateSevenDayCurriculum(withDiagnostic, startDate),
  };
};

export const koreanSeedState: StudyQuestState = createKoreanSeedState();
