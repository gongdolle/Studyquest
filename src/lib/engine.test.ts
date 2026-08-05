import assert from "node:assert/strict";
import { test } from "vitest";

import {
  applyNaturalLanguageBoost,
  buildReverseSchedule,
  createDiagnostic,
  createSkillGraph,
  createThirtyMinuteLesson,
  deriveProactiveBoosts,
  ensureCurrentCurriculum,
  generateSevenDayCurriculum,
  interpretNaturalLanguageBoost,
  processNaturalLanguageFeedback,
  recordLearningIntent,
  registerSubject,
  resolveScheduleWindow,
  scoreDiagnostic,
  submitEvidence,
} from "./engine";
import { createEmptyStudyState, createKoreanSeedState, koreanSeedState } from "./seed";

test("새 설치는 과목과 커리큘럼이 없는 인터뷰 대기 상태를 유지한다", () => {
  const empty = createEmptyStudyState();
  const ensured = ensureCurrentCurriculum(empty, "2026-08-04");
  assert.equal(ensured, empty);
  assert.equal(ensured.stage, "intake");
  assert.deepEqual(ensured.subjects, []);
  assert.equal(ensured.curriculum, undefined);
});

test("AI 인터뷰로 정한 요일 예외와 게임 보호 해제가 역산 일정에 반영된다", () => {
  const base = createKoreanSeedState();
  const date = "2026-08-05";
  const day = base.curriculum?.days.find((item) => item.date === date);
  assert.ok(day);
  const state = {
    ...base,
    schedulePolicy: {
      ...base.schedulePolicy,
      defaultReadyAt: "19:30",
      dayOverrides: [{
        weekday: "wed" as const,
        studyEnabled: true,
        readyAt: "21:00",
        learningDeadline: "22:30",
        note: "수요일 야근",
      }],
    },
  };
  const window = resolveScheduleWindow(state.schedulePolicy, date);
  assert.equal(window.readyAt, "21:00");
  assert.equal(window.learningDeadline, "22:30");
  const schedule = buildReverseSchedule(state, { date, readyAt: window.readyAt, fatigue: 2 }, day, false);
  assert.equal(schedule.deadline, "22:30");
  assert.equal(schedule.availableStudyMinutes, 80);
  assert.equal(schedule.blocks.some((block) => block.kind === "game"), false);
});

test("한국어 시드는 메인 저서와 CSS·React·수학·영어를 명시적으로 등록한다", () => {
  assert.deepEqual(
    koreanSeedState.subjects.map((subject) => subject.name),
    ["제어공학 저서 집필", "CSS", "React", "수학", "영어"],
  );
  assert.equal(koreanSeedState.curriculum?.days.length, 7);
  assert.equal(koreanSeedState.curriculum?.days[0].quests.length, 5);
});

test("과목과 모름·목표 등록은 원본 상태를 바꾸지 않고 다음 단계로 이동한다", () => {
  const original = createKoreanSeedState();
  const registered = registerSubject(original, {
    id: "physics",
    name: "물리",
    dailyTargetMinutes: 20,
  });
  assert.equal(original.subjects.length, 5);
  assert.equal(registered.subjects.length, 6);
  assert.equal(registered.stage, "intake");

  const withIntent = recordLearningIntent(registered, {
    id: "intent-physics-1",
    subjectId: "physics",
    goalText: "상태방정식의 물리적 의미를 연결한다.",
    unknownText: "질량-스프링 모델에서 상태 선택이 헷갈린다.",
    successEvidence: "상태 선택 근거를 포함한 유도 노트",
  });
  assert.equal(withIntent.stage, "diagnostic");
  assert.equal(withIntent.goals.at(-1)?.subjectId, "physics");
  assert.match(withIntent.gaps.at(-1)?.rawText ?? "", /헷갈린다/);
});

test("스킬 그래프는 선수 관계를 간선으로 만들고 순환 관계를 거부한다", () => {
  const graph = createSkillGraph("sample", [
    { id: "basic", name: "기초" },
    { id: "advanced", name: "응용", prerequisiteIds: ["basic"] },
  ]);
  assert.deepEqual(graph.edges, [{ fromSkillId: "basic", toSkillId: "advanced" }]);
  assert.throws(
    () =>
      createSkillGraph("cycle", [
        { id: "a", name: "A", prerequisiteIds: ["b"] },
        { id: "b", name: "B", prerequisiteIds: ["a"] },
      ]),
    /순환/,
  );
});

test("진단 테스트 결과는 연결된 스킬 숙련도와 불확실성을 결정적으로 갱신한다", () => {
  const base = createKoreanSeedState();
  const { state, diagnostic } = createDiagnostic(base, "mathematics", 3);
  const targetSkillId = diagnostic.questions[0].skillId;
  const before = state.skillGraphs
    .flatMap((graph) => graph.nodes)
    .find((skill) => skill.id === targetSkillId);
  const results = diagnostic.questions.map((question) => ({
    questionId: question.id,
    score: 0.9,
    confidence: 0.8,
    hesitationSeconds: 20,
  }));
  const scored = scoreDiagnostic(state, diagnostic.id, results);
  const after = scored.skillGraphs
    .flatMap((graph) => graph.nodes)
    .find((skill) => skill.id === targetSkillId);

  assert.equal(scored.stage, "skill-graph");
  assert.ok((after?.mastery ?? 0) > (before?.mastery ?? 1));
  assert.equal(scored.diagnostics.find((item) => item.id === diagnostic.id)?.status, "scored");
});

test("7일 커리큘럼은 같은 입력에 항상 같은 날짜와 퀘스트를 만든다", () => {
  const state = createKoreanSeedState();
  const first = generateSevenDayCurriculum(state, "2026-08-10");
  const second = generateSevenDayCurriculum(state, "2026-08-10");
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.days.map((day) => day.date),
    [
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
    ],
  );
  assert.ok(first.days.every((day) => day.quests.some((quest) => quest.kind === "authoring")));
});

test("라이브 강의는 글과 탐색을 먼저 제공하고 초반에 질문하지 않으며 정확히 30분이다", () => {
  const quest = createKoreanSeedState().curriculum?.days[0].quests[0];
  assert.ok(quest);
  const lesson = createThirtyMinuteLesson(quest, "가제어성");
  assert.equal(
    lesson.phases.reduce((sum, phase) => sum + phase.durationMinutes, 0),
    30,
  );
  assert.deepEqual(
    lesson.phases.map((phase) => phase.kind),
    ["orient", "explain", "example", "explore", "synthesize"],
  );
  const instructionFirst = lesson.phases.slice(0, -1).map((phase) => phase.coachPrompt).join("\n");
  assert.doesNotMatch(instructionFirst, /[?？]|\b(?:question|answer)\b|(?:질문|답변|회상|진단)/iu);
});

test("자연어 피드백은 CSS 부스트·영어 축소·피로도를 즉시 계획에 반영한다", () => {
  const state = createKoreanSeedState();
  const text = "이번 주 CSS 비중 올리고 영어는 줄여. 오늘 너무 피곤해.";
  const interpreted = interpretNaturalLanguageBoost(state, text);
  assert.equal(interpreted.scope, "week");
  assert.equal(interpreted.fatigueOverride, 5);
  assert.equal(
    interpreted.subjectAdjustments.find((item) => item.subjectId === "css")?.minutesDelta,
    10,
  );
  assert.equal(
    interpreted.subjectAdjustments.find((item) => item.subjectId === "english")?.minutesDelta,
    -10,
  );

  const processed = processNaturalLanguageFeedback(state, text);
  assert.equal(processed.state.subjects.find((subject) => subject.id === "css")?.dailyTargetMinutes, 40);
  assert.equal(processed.state.subjects.find((subject) => subject.id === "english")?.dailyTargetMinutes, 20);
  assert.equal(processed.state.curriculum?.revision, (state.curriculum?.revision ?? 0) + 1);
  assert.equal(applyNaturalLanguageBoost(processed.state, interpreted), processed.state);
});

test("AI 능동 부스트는 낮은 숙련도나 높은 불확실성을 과목별로 한 번씩 추천한다", () => {
  const state = createKoreanSeedState();
  const boosts = deriveProactiveBoosts(state);
  const subjectIds = boosts.map((boost) => boost.subjectAdjustments[0].subjectId);
  assert.equal(new Set(subjectIds).size, subjectIds.length);
  assert.ok(boosts.some((boost) => boost.subjectAdjustments[0].subjectId === "control-book"));
  assert.ok(boosts.every((boost) => boost.linkedSkillIds.length > 0));
  assert.ok(boosts.every((boost) => boost.source === "coach"));
});

test("19:30 시작 일정은 미완료 퀘스트 수요인 저서 60분과 네 과목 각 30분을 배정한다", () => {
  const state = createKoreanSeedState();
  const schedule = buildReverseSchedule(state, {
    date: "2026-08-04",
    readyAt: "19:30",
    fatigue: 2,
  });
  assert.equal(schedule.availableStudyMinutes, 200);
  assert.equal(schedule.allocatedMinutesBySubject["control-book"], 60);
  for (const subjectId of ["css", "react", "mathematics", "english"]) {
    assert.equal(schedule.allocatedMinutesBySubject[subjectId], 30);
    assert.equal(schedule.deferredMinutesBySubject[subjectId], 0);
  }
  assert.equal(
    schedule.blocks.filter((block) => block.kind === "study").reduce((sum, block) => sum + block.durationMinutes, 0),
    180,
  );
  assert.ok(
    schedule.blocks.filter((block) => block.kind === "study").every((block) => block.durationMinutes <= 30),
  );
  assert.ok(schedule.blocks.some((block) => block.kind === "recovery" && block.durationMinutes === 20));
  assert.ok(
    schedule.blocks
      .filter((block) => block.kind === "study")
      .every((block) => block.questIds.length === 1),
  );
  assert.deepEqual(
    schedule.blocks.find((block) => block.kind === "wrap-up"),
    {
      id: "block-2026-08-04-wrap-up",
      kind: "wrap-up",
      start: "22:50",
      end: "23:00",
      durationMinutes: 10,
      title: "증거 저장과 내일 퀘스트 생성",
      questIds: [],
    },
  );
  assert.equal(schedule.blocks.at(-1)?.start, "23:00");
  assert.equal(schedule.blocks.at(-1)?.end, "24:00");
});

test("완료 퀘스트는 다시 배정하지 않고 블록은 실제 미완료 퀘스트를 가리킨다", () => {
  const state = createKoreanSeedState();
  const originalDay = state.curriculum!.days[0];
  const completedQuest = originalDay.quests.find((quest) => quest.primarySubjectId === "css")!;
  const day = {
    ...originalDay,
    quests: originalDay.quests.map((quest) =>
      quest.id === completedQuest.id ? { ...quest, status: "completed" as const } : quest,
    ),
  };
  const schedule = buildReverseSchedule(
    state,
    { date: day.date, readyAt: "19:30", fatigue: 2 },
    day,
  );

  assert.equal(schedule.allocatedMinutesBySubject.css, 0);
  assert.equal(schedule.deferredMinutesBySubject.css, 0);
  assert.equal(schedule.allocatedMinutesByQuest?.[completedQuest.id], 0);
  assert.equal(schedule.deferredMinutesByQuest?.[completedQuest.id], 0);
  assert.equal(
    schedule.blocks.some((block) => block.questIds.includes(completedQuest.id)),
    false,
  );
  const incompleteQuestIds = new Set(
    day.quests.filter((quest) => quest.status !== "completed").map((quest) => quest.id),
  );
  assert.ok(
    schedule.blocks
      .filter((block) => block.kind === "study")
      .every((block) => block.questIds.length === 1 && incompleteQuestIds.has(block.questIds[0])),
  );
});

test("23시 전 남은 시간보다 긴 퀘스트는 가능한 만큼만 배정하고 나머지를 부채로 남긴다", () => {
  const state = createKoreanSeedState();
  const sourceDay = state.curriculum!.days[0];
  const sourceQuest = sourceDay.quests.find((quest) => quest.primarySubjectId === "control-book")!;
  const longQuest = {
    ...sourceQuest,
    id: "quest-long-authoring",
    title: "제어공학 장 전체 개정",
    estimatedMinutes: 180,
    status: "planned" as const,
  };
  const day = { ...sourceDay, quests: [longQuest], plannedMinutes: 180 };
  const schedule = buildReverseSchedule(
    state,
    { date: day.date, readyAt: "22:00", fatigue: 2 },
    day,
  );

  assert.equal(schedule.availableStudyMinutes, 50);
  assert.equal(schedule.allocatedMinutesBySubject["control-book"], 50);
  assert.equal(schedule.deferredMinutesBySubject["control-book"], 130);
  assert.equal(schedule.allocatedMinutesByQuest?.[longQuest.id], 50);
  assert.equal(schedule.deferredMinutesByQuest?.[longQuest.id], 130);
  assert.deepEqual(
    schedule.blocks.filter((block) => block.kind === "study").map((block) => block.durationMinutes),
    [30, 20],
  );
  assert.ok(
    schedule.blocks
      .filter((block) => block.kind === "study")
      .every((block) => block.questIds[0] === longQuest.id),
  );
});

test("오늘 기준 7일 창은 유지하고 낡은 창은 오늘 시작 계획으로 교체한다", () => {
  const current = createKoreanSeedState("2026-08-04");
  assert.equal(ensureCurrentCurriculum(current, "2026-08-04"), current);

  const refreshed = ensureCurrentCurriculum(current, "2026-08-05");
  assert.notEqual(refreshed, current);
  assert.equal(refreshed.curriculum?.startDate, "2026-08-05");
  assert.deepEqual(
    refreshed.curriculum?.days.map((day) => day.date),
    [
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
      "2026-08-10",
      "2026-08-11",
    ],
  );
  assert.equal(refreshed.curriculum?.revision, (current.curriculum?.revision ?? 0) + 1);
});

test("AI가 만든 7일 계획은 창 안에서 날짜가 바뀌어도 로컬 템플릿으로 덮지 않는다", () => {
  const seeded = createKoreanSeedState("2026-08-04");
  const aiState = {
    ...seeded,
    curriculum: { ...seeded.curriculum!, source: "ai" as const, generatedBy: "codex" as const },
  };
  const nextDay = ensureCurrentCurriculum(aiState, "2026-08-05");
  assert.equal(nextDay, aiState);
  assert.equal(nextDay.curriculum?.source, "ai");
  assert.equal(nextDay.curriculum?.startDate, "2026-08-04");
});

test("늦은 시작과 탈진은 최소 접촉과 학습 부채로 축소된다", () => {
  const state = createKoreanSeedState();
  const late = buildReverseSchedule(state, {
    date: "2026-08-04",
    readyAt: "20:30",
    fatigue: 2,
  });
  assert.equal(late.availableStudyMinutes, 140);
  assert.equal(late.allocatedMinutesBySubject["control-book"], 45);
  assert.ok(
    ["css", "react", "mathematics", "english"].every(
      (subjectId) => late.allocatedMinutesBySubject[subjectId] >= 20,
    ),
  );
  assert.ok(Object.values(late.deferredMinutesBySubject).some((minutes) => minutes > 0));

  const exhausted = buildReverseSchedule(state, {
    date: "2026-08-04",
    readyAt: "19:30",
    fatigue: 5,
  });
  assert.equal(exhausted.allocatedMinutesBySubject["control-book"], 30);
  assert.ok(
    ["css", "react", "mathematics", "english"].every(
      (subjectId) => exhausted.allocatedMinutesBySubject[subjectId] === 10,
    ),
  );
  assert.ok(exhausted.blocks.some((block) => block.kind === "recovery"));
});

test("제출 증거는 루브릭으로 숙련도를 갱신하고 퀘스트를 완료 처리한다", () => {
  const state = createKoreanSeedState();
  const quest = state.curriculum?.days[0].quests[0];
  assert.ok(quest);
  const skillId = quest.skillIds[0];
  const before = state.skillGraphs.flatMap((graph) => graph.nodes).find((skill) => skill.id === skillId);
  const next = submitEvidence(state, {
    id: "evidence-control-1",
    questId: quest.id,
    skillIds: [skillId],
    type: "manuscript",
    content: "가제어성의 직관, 랭크 조건, 반례를 연결한 원고 문단",
    submittedOn: "2026-08-04",
    rubric: {
      correctness: 0.95,
      independence: 0.85,
      transfer: 0.9,
      explanation: 0.92,
    },
  });
  const after = next.skillGraphs.flatMap((graph) => graph.nodes).find((skill) => skill.id === skillId);
  assert.equal(state.evidence.length, 0);
  assert.equal(next.evidence.length, 1);
  assert.ok((after?.mastery ?? 0) > (before?.mastery ?? 1));
  assert.equal(after?.evidenceIds.includes("evidence-control-1"), true);
  assert.equal(
    next.curriculum?.days[0].quests.find((candidate) => candidate.id === quest.id)?.status,
    "completed",
  );
});
