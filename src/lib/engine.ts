import type {
  ClockTime,
  Curriculum7Day,
  CurriculumDay,
  DailyCheckIn,
  DailySchedule,
  Diagnostic,
  DiagnosticResult,
  FatigueLevel,
  ISODate,
  KnowledgeGap,
  LearningEvidence,
  LearningIntentInput,
  NaturalLanguageBoost,
  Quest,
  QuestKind,
  ScheduleBlock,
  SchedulePolicy,
  SkillDefinition,
  SkillGraph,
  SkillNode,
  StudyQuestState,
  Subject,
  SubjectRegistration,
  ThirtyMinuteLesson,
} from "./types";

const clamp = (value: number, minimum = 0, maximum = 1): number =>
  Math.min(maximum, Math.max(minimum, value));

const rounded = (value: number): number => Math.round(value * 1000) / 1000;

const normalize = (value: string): string => value.trim().toLocaleLowerCase("ko-KR");

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const assertUnitInterval = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} 값은 0과 1 사이여야 합니다.`);
  }
};

export const minutesFromClock = (time: ClockTime): number => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) throw new Error(`잘못된 시각 형식입니다: ${time}`);

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59 || (hour === 24 && minute !== 0)) {
    throw new Error(`유효하지 않은 시각입니다: ${time}`);
  }
  return hour * 60 + minute;
};

export const clockFromMinutes = (minutes: number): ClockTime => {
  if (!Number.isFinite(minutes)) throw new Error("분 값은 유한한 숫자여야 합니다.");
  const whole = Math.round(minutes);
  if (whole === 24 * 60) return "24:00";
  const normalized = ((whole % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(
    normalized % 60,
  ).padStart(2, "0")}`;
};

export const addDays = (date: ISODate, days: number): ISODate => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`잘못된 날짜 형식입니다: ${date}`);
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (value.toISOString().slice(0, 10) !== date) {
    throw new Error(`유효하지 않은 날짜입니다: ${date}`);
  }
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

export interface ResolvedScheduleWindow {
  readonly studyEnabled: boolean;
  readonly readyAt: ClockTime;
  readonly learningDeadline: ClockTime;
  readonly gameStart: ClockTime;
  readonly gameEnd: ClockTime;
}

export const resolveScheduleWindow = (
  policy: SchedulePolicy,
  date: ISODate,
): ResolvedScheduleWindow => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`잘못된 날짜 형식입니다: ${date}`);
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
  const weekday = (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const)[day];
  const override = policy.dayOverrides?.find((item) => item.weekday === weekday);
  return {
    studyEnabled: override?.studyEnabled ?? true,
    readyAt: override?.readyAt ?? policy.defaultReadyAt ?? "19:30",
    learningDeadline: override?.learningDeadline ?? policy.learningDeadline,
    gameStart: policy.gameStart,
    gameEnd: policy.gameEnd,
  };
};

const requireSubject = (state: StudyQuestState, subjectId: string): Subject => {
  const subject = state.subjects.find((candidate) => candidate.id === subjectId);
  if (!subject) throw new Error(`과목을 찾을 수 없습니다: ${subjectId}`);
  return subject;
};

export const registerSubject = (
  state: StudyQuestState,
  registration: SubjectRegistration,
): StudyQuestState => {
  const id = registration.id.trim();
  const name = registration.name.trim();
  if (!id || !name) throw new Error("과목 id와 이름은 비어 있을 수 없습니다.");
  if (
    state.subjects.some(
      (subject) => subject.id === id || normalize(subject.name) === normalize(name),
    )
  ) {
    throw new Error(`이미 등록된 과목입니다: ${name}`);
  }

  const role = registration.role ?? "support";
  const dailyTargetMinutes =
    registration.dailyTargetMinutes ?? (role === "main" ? 60 : 30);
  const minimumTouchMinutes =
    registration.minimumTouchMinutes ?? (role === "main" ? 30 : 10);
  if (dailyTargetMinutes <= 0 || minimumTouchMinutes <= 0) {
    throw new Error("학습 시간은 0보다 커야 합니다.");
  }

  const subject: Subject = {
    id,
    name,
    aliases: unique([name, ...(registration.aliases ?? [])]),
    role,
    dailyTargetMinutes,
    weeklyTargetMinutes: dailyTargetMinutes * 7,
    minimumTouchMinutes: Math.min(minimumTouchMinutes, dailyTargetMinutes),
    priorityBoost: 0,
    active: true,
  };

  return {
    ...state,
    stage: "intake",
    subjects: [...state.subjects, subject],
  };
};

export const recordLearningIntent = (
  state: StudyQuestState,
  input: LearningIntentInput,
): StudyQuestState => {
  requireSubject(state, input.subjectId);
  if (!input.goalText.trim() || !input.successEvidence.trim()) {
    throw new Error("학습 목표와 성공 증거를 입력해야 합니다.");
  }

  const goalId = `${input.id}-goal`;
  const gapId = `${input.id}-gap`;
  if (state.goals.some((goal) => goal.id === goalId)) {
    throw new Error(`이미 등록된 학습 요청입니다: ${input.id}`);
  }

  const gap: KnowledgeGap | undefined = input.unknownText?.trim()
    ? {
        id: gapId,
        subjectId: input.subjectId,
        rawText: input.unknownText.trim(),
        linkedSkillIds: unique(input.linkedSkillIds ?? []),
        urgency: clamp(input.priority ?? 0.7),
        status: "new",
      }
    : undefined;

  return {
    ...state,
    stage: "diagnostic",
    goals: [
      ...state.goals,
      {
        id: goalId,
        subjectId: input.subjectId,
        text: input.goalText.trim(),
        successEvidence: input.successEvidence.trim(),
        priority: clamp(input.priority ?? 0.7),
        targetDate: input.targetDate,
      },
    ],
    gaps: gap ? [...state.gaps, gap] : state.gaps,
  };
};

export const createSkillGraph = (
  subjectId: string,
  definitions: readonly SkillDefinition[],
): SkillGraph => {
  if (!definitions.length) throw new Error("스킬 그래프에는 노드가 하나 이상 필요합니다.");
  const ids = definitions.map((definition) => definition.id);
  if (new Set(ids).size !== ids.length) throw new Error("스킬 id는 중복될 수 없습니다.");

  const idSet = new Set(ids);
  for (const definition of definitions) {
    for (const prerequisiteId of definition.prerequisiteIds ?? []) {
      if (!idSet.has(prerequisiteId)) {
        throw new Error(`선수 스킬을 찾을 수 없습니다: ${prerequisiteId}`);
      }
      if (prerequisiteId === definition.id) {
        throw new Error(`스킬이 자기 자신을 선수 조건으로 가질 수 없습니다: ${definition.id}`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const prerequisites = new Map(
    definitions.map((definition) => [definition.id, [...(definition.prerequisiteIds ?? [])]]),
  );
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error("스킬 그래프에 순환 선수 관계가 있습니다.");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const prerequisiteId of prerequisites.get(id) ?? []) visit(prerequisiteId);
    visiting.delete(id);
    visited.add(id);
  };
  ids.forEach(visit);

  const nodes: SkillNode[] = definitions.map((definition) => {
    const mastery = definition.mastery ?? 0.2;
    const uncertainty = definition.uncertainty ?? 0.8;
    assertUnitInterval(mastery, `${definition.name} 숙련도`);
    assertUnitInterval(uncertainty, `${definition.name} 불확실성`);
    return {
      id: definition.id,
      subjectId,
      name: definition.name,
      prerequisiteIds: unique(definition.prerequisiteIds ?? []),
      mastery,
      uncertainty,
      attempts: 0,
      evidenceIds: [],
    };
  });

  return {
    subjectId,
    nodes,
    edges: nodes.flatMap((node) =>
      node.prerequisiteIds.map((prerequisiteId) => ({
        fromSkillId: prerequisiteId,
        toSkillId: node.id,
      })),
    ),
  };
};

export const upsertSkillGraph = (
  state: StudyQuestState,
  graph: SkillGraph,
): StudyQuestState => {
  requireSubject(state, graph.subjectId);
  const exists = state.skillGraphs.some((candidate) => candidate.subjectId === graph.subjectId);
  return {
    ...state,
    stage: "skill-graph",
    skillGraphs: exists
      ? state.skillGraphs.map((candidate) =>
          candidate.subjectId === graph.subjectId ? graph : candidate,
        )
      : [...state.skillGraphs, graph],
  };
};

const needScore = (state: StudyQuestState, node: SkillNode): number => {
  const gapBoost = state.gaps
    .filter((gap) => gap.status !== "resolved" && gap.linkedSkillIds.includes(node.id))
    .reduce((sum, gap) => sum + gap.urgency * 0.5, 0);
  const prerequisitesReady = node.prerequisiteIds.every((prerequisiteId) => {
    const graph = state.skillGraphs.find((candidate) => candidate.subjectId === node.subjectId);
    return (graph?.nodes.find((candidate) => candidate.id === prerequisiteId)?.mastery ?? 0) >= 0.45;
  });
  return 1 - node.mastery + node.uncertainty + gapBoost + (prerequisitesReady ? 0.15 : -0.15);
};

export const rankSkillsForLearning = (
  state: StudyQuestState,
  subjectId: string,
): SkillNode[] => {
  const graph = state.skillGraphs.find((candidate) => candidate.subjectId === subjectId);
  if (!graph) throw new Error(`스킬 그래프를 찾을 수 없습니다: ${subjectId}`);
  return [...graph.nodes].sort(
    (left, right) => needScore(state, right) - needScore(state, left) || left.id.localeCompare(right.id),
  );
};

export const createDiagnostic = (
  state: StudyQuestState,
  subjectId: string,
  questionCount = 3,
): { readonly state: StudyQuestState; readonly diagnostic: Diagnostic } => {
  const subject = requireSubject(state, subjectId);
  const ranked = rankSkillsForLearning(state, subjectId);
  const count = Math.min(ranked.length, Math.max(1, Math.floor(questionCount)));
  const sequence = state.diagnostics.filter((item) => item.subjectId === subjectId).length + 1;
  const diagnosticId = `diagnostic-${subjectId}-${sequence}`;
  const templates = [
    (skill: string) => `${skill}을(를) 책을 처음 읽는 사람에게 자신의 말로 설명하세요.`,
    (skill: string) => `${skill}이(가) 필요한 상황과 성립 조건을 예로 들어 설명하세요.`,
    (skill: string) => `${skill}을(를) 실제 문제에 적용하는 첫 단계를 작성하세요.`,
  ];

  const diagnostic: Diagnostic = {
    id: diagnosticId,
    subjectId,
    targetSkillIds: ranked.slice(0, count).map((skill) => skill.id),
    questions: ranked.slice(0, count).map((skill, index) => ({
      id: `${diagnosticId}-question-${index + 1}`,
      skillId: skill.id,
      prompt: `[${subject.name}] ${templates[index % templates.length](skill.name)}`,
      difficulty: rounded(clamp(0.3 + (1 - skill.mastery) * 0.55 + index * 0.03)),
    })),
    status: "ready",
    results: [],
  };

  const nextState: StudyQuestState = {
    ...state,
    stage: "diagnostic",
    diagnostics: [...state.diagnostics, diagnostic],
  };
  return { state: nextState, diagnostic };
};

export const scoreDiagnostic = (
  state: StudyQuestState,
  diagnosticId: string,
  results: readonly DiagnosticResult[],
): StudyQuestState => {
  const diagnostic = state.diagnostics.find((item) => item.id === diagnosticId);
  if (!diagnostic) throw new Error(`진단을 찾을 수 없습니다: ${diagnosticId}`);
  if (!results.length) throw new Error("채점할 진단 결과가 없습니다.");

  const questionIds = new Set(diagnostic.questions.map((question) => question.id));
  for (const result of results) {
    if (!questionIds.has(result.questionId)) {
      throw new Error(`진단 문항을 찾을 수 없습니다: ${result.questionId}`);
    }
    assertUnitInterval(result.score, "진단 점수");
    if (result.confidence !== undefined) assertUnitInterval(result.confidence, "확신도");
  }

  const resultByQuestion = new Map(results.map((result) => [result.questionId, result]));
  const observations = new Map<string, number[]>();
  for (const question of diagnostic.questions) {
    const result = resultByQuestion.get(question.id);
    if (!result) continue;
    const confidenceFactor = 0.85 + (result.confidence ?? 1) * 0.15;
    const hesitationPenalty = (result.hesitationSeconds ?? 0) > 90 ? 0.05 : 0;
    const observation = clamp(result.score * confidenceFactor - hesitationPenalty);
    observations.set(question.skillId, [
      ...(observations.get(question.skillId) ?? []),
      observation,
    ]);
  }

  const skillGraphs = state.skillGraphs.map((graph) => ({
    ...graph,
    nodes: graph.nodes.map((node) => {
      const values = observations.get(node.id);
      if (!values?.length) return node;
      const observation = values.reduce((sum, value) => sum + value, 0) / values.length;
      return {
        ...node,
        mastery: rounded(clamp(node.mastery * 0.35 + observation * 0.65)),
        uncertainty: rounded(
          clamp(node.uncertainty * 0.55 + Math.abs(observation - node.mastery) * 0.2, 0.05, 1),
        ),
        attempts: node.attempts + 1,
      };
    }),
  }));

  return {
    ...state,
    stage: "skill-graph",
    skillGraphs,
    diagnostics: state.diagnostics.map((item) =>
      item.id === diagnosticId ? { ...item, status: "scored", results: [...results] } : item,
    ),
  };
};

const questKindFor = (subject: Subject, dayIndex: number): QuestKind => {
  if (subject.role === "main") return "authoring";
  if (dayIndex === 6) return "review";
  return (["lesson", "practice", "practice"] as const)[dayIndex % 3];
};

export const generateSevenDayCurriculum = (
  state: StudyQuestState,
  startDate: ISODate,
): Curriculum7Day => {
  addDays(startDate, 0);
  const activeSubjects = state.subjects
    .filter((subject) => subject.active)
    .sort(
      (left, right) =>
        Number(right.role === "main") - Number(left.role === "main") ||
        right.priorityBoost - left.priorityBoost ||
        left.id.localeCompare(right.id),
    );
  if (!activeSubjects.length) throw new Error("활성 과목이 없습니다.");
  activeSubjects.forEach((subject) => rankSkillsForLearning(state, subject.id));

  const mainSubject = activeSubjects.find((subject) => subject.role === "main");
  const supportSubjects = activeSubjects.filter((subject) => subject.role === "support");
  const days: CurriculumDay[] = Array.from({ length: 7 }, (_, dayIndex) => {
    const date = addDays(startDate, dayIndex);
    const quests: Quest[] = activeSubjects.map((subject, subjectIndex) => {
      const ranked = rankSkillsForLearning(state, subject.id);
      const skill = ranked[(dayIndex + subjectIndex) % ranked.length];
      const kind = questKindFor(subject, dayIndex);
      const crossTag =
        subject.role === "main"
          ? supportSubjects.length
            ? supportSubjects[dayIndex % supportSubjects.length].id
            : undefined
          : mainSubject?.id;
      const taggedSubjectIds = crossTag ? [crossTag] : [];
      const title =
        subject.role === "main"
          ? `${skill.name}: 독자가 따라올 원고 만들기`
          : `${skill.name}: 제어공학 결과물에 연결하는 30분 퀘스트`;
      return {
        id: `quest-${date}-${subject.id}-${skill.id}`,
        date,
        title,
        description: `${subject.name}의 ${skill.name}을(를) 설명하고 실제 산출물에 적용합니다.`,
        primarySubjectId: subject.id,
        taggedSubjectIds,
        skillIds: [skill.id],
        estimatedMinutes: subject.role === "main" ? Math.max(60, subject.dailyTargetMinutes) : subject.dailyTargetMinutes,
        kind,
        requiredEvidence:
          subject.role === "main"
            ? "수식·반례·예제를 포함한 원고 수정본"
            : `${subject.name} 실습 결과와 한 문장 설명`,
        status: "planned",
      };
    });

    const activeBoosts = state.boosts.filter(
      (boost) => boost.scope === "week" || boost.scope === "persistent" || boost.scope === "today",
    );
    return {
      date,
      quests,
      plannedMinutes: quests.reduce((sum, quest) => sum + quest.estimatedMinutes, 0),
      adaptationReason: activeBoosts.length
        ? `자연어 피드백 ${activeBoosts.length}건과 최신 숙련도를 반영함`
        : "최신 진단 숙련도와 선수 관계를 반영함",
    };
  });

  return {
    id: `curriculum-${startDate}`,
    startDate,
    revision: (state.curriculum?.revision ?? 0) + 1,
    source: "local",
    days,
  };
};

export const installCurriculum = (
  state: StudyQuestState,
  curriculum: Curriculum7Day,
): StudyQuestState => ({
  ...state,
  stage: "curriculum",
  curriculum,
});

/**
 * 오늘을 첫날로 하는 온전한 7일 창을 보장합니다.
 * 같은 창이면 원본 상태를 그대로 돌려주므로 반복 호출해도 개정판이 불필요하게 늘지 않습니다.
 */
export const ensureCurrentCurriculum = (
  state: StudyQuestState,
  today: ISODate,
): StudyQuestState => {
  addDays(today, 0);
  if (!state.subjects.some((subject) => subject.active)) {
    if (!state.curriculum && state.stage === "intake") return state;
    const { curriculum: _curriculum, ...withoutCurriculum } = state;
    return { ...withoutCurriculum, stage: "intake" };
  }
  const curriculum = state.curriculum;
  const isCurrentWindow = Boolean(
    curriculum
    && curriculum.days.length === 7
    && (
      curriculum.source === "ai"
        ? curriculum.days.some((day) => day.date === today)
        : curriculum.startDate === today
          && curriculum.days.every((day, index) => day.date === addDays(today, index))
    ),
  );

  return isCurrentWindow
    ? state
    : installCurriculum(state, generateSevenDayCurriculum(state, today));
};

export const createThirtyMinuteLesson = (
  quest: Quest,
  skillName = "핵심 개념",
): ThirtyMinuteLesson => ({
  id: `lesson-${quest.id}`,
  questId: quest.id,
  title: `${quest.title} · 라이브 30분`,
  totalMinutes: 30,
  phases: [
    {
      kind: "orient",
      startMinute: 0,
      durationMinutes: 3,
      coachPrompt: `이번 학습은 ${skillName}의 핵심 구조를 먼저 읽고, 예제와 위젯에서 변화를 관찰한 뒤 마지막에만 이해를 확인합니다. 목표 결과물은 ${quest.requiredEvidence}입니다.`,
    },
    {
      kind: "explain",
      startMinute: 3,
      durationMinutes: 9,
      coachPrompt: `${skillName}을 이해할 때는 용어의 정의, 성립 조건, 입력과 출력의 관계를 분리해서 읽어야 합니다. 먼저 각 요소가 어떤 역할을 맡는지 파악하고, 조건이 달라질 때 결론이 어떻게 변하는지 연결해서 살펴봅니다.`,
    },
    {
      kind: "example",
      startMinute: 12,
      durationMinutes: 6,
      coachPrompt: `구체적인 사례에서는 주어진 조건을 표시하고, ${skillName}의 원리를 적용한 중간 과정과 결과를 차례로 비교합니다. 결과만 보지 말고 어떤 조건이 그 결과를 만들었는지 따라가면 다른 문제에도 같은 구조를 옮길 수 있습니다.`,
    },
    {
      kind: "explore",
      startMinute: 18,
      durationMinutes: 8,
      coachPrompt: `위젯의 단계를 움직이며 개념, 예제, 변형, 결과물 사이의 연결을 관찰합니다. 조작 중에는 값을 맞히는 대신 변화 전후의 차이와 유지되는 원리를 확인합니다.`,
    },
    {
      kind: "synthesize",
      startMinute: 26,
      durationMinutes: 4,
      coachPrompt: `앞의 설명과 위젯에서 확인한 원리를 ${quest.requiredEvidence}에 연결합니다. 본문을 모두 마치면 마지막 확인 문제가 열리고, 그 뒤에만 실제 결과물을 제출할 수 있습니다.`,
    },
  ],
});

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const parseFatigue = (text: string): FatigueLevel | undefined => {
  if (/너무\s*피곤|탈진|기진|못\s*하겠|완전\s*지쳤/.test(text)) return 5;
  if (/피곤|지쳤|지쳐|힘들|에너지.?없/.test(text)) return 4;
  if (/컨디션.?좋|에너지.?넘|멀쩡/.test(text)) return 1;
  if (/괜찮|할\s*만/.test(text)) return 2;
  return undefined;
};

const parseReadyAt = (text: string): ClockTime | undefined => {
  const patterns = [
    /(\d{1,2})시\s*(반|\d{1,2}분)?(?:부터|에)\s*(?:공부|시작|가능)/,
    /(?:공부|시작|가능).*?(\d{1,2})시\s*(반|\d{1,2}분)?/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    let hour = Number(match[1]);
    const minute = match[2] === "반" ? 30 : Number(match[2]?.replace("분", "") ?? 0);
    if (hour >= 1 && hour <= 11 && /저녁|퇴근/.test(text)) hour += 12;
    if (hour <= 23 && minute <= 59) return clockFromMinutes(hour * 60 + minute);
  }
  return undefined;
};

export const interpretNaturalLanguageBoost = (
  state: StudyQuestState,
  rawText: string,
): NaturalLanguageBoost => {
  const text = normalize(rawText);
  if (!text) throw new Error("자연어 피드백이 비어 있습니다.");

  const mentions = state.subjects
    .map((subject) => {
      const aliases = unique([subject.name, ...subject.aliases]).map(normalize);
      const positions = aliases
        .map((alias) => text.indexOf(alias))
        .filter((position) => position >= 0);
      return positions.length ? { subject, position: Math.min(...positions) } : undefined;
    })
    .filter((mention): mention is { subject: Subject; position: number } => Boolean(mention))
    .sort((left, right) => left.position - right.position);

  const increase = /올리|늘리|집중|강화|부스트|더\s*(?:하|해|보)|파고/;
  const decrease = /줄이|줄여|낮추|덜\s*(?:하|해)|쉬자|쉬어|건너/;
  const gapExpression = /모르|헷갈|이해.?안|막혀|막힌|애매/;

  const subjectAdjustments = mentions.flatMap((mention, index) => {
    const nextPosition = mentions[index + 1]?.position ?? text.length;
    const segment = text.slice(mention.position, nextPosition);
    if (decrease.test(segment)) {
      return [
        {
          subjectId: mention.subject.id,
          minutesDelta: -10,
          priorityDelta: -0.25,
          reason: `${mention.subject.name} 비중 축소 요청`,
        },
      ];
    }
    if (increase.test(segment) || gapExpression.test(segment)) {
      return [
        {
          subjectId: mention.subject.id,
          minutesDelta: 10,
          priorityDelta: 0.35,
          reason: `${mention.subject.name} 집중 학습 요청`,
        },
      ];
    }
    return [];
  });

  const linkedSkillIds = state.skillGraphs.flatMap((graph) =>
    graph.nodes
      .filter((node) => text.includes(normalize(node.name)))
      .map((node) => node.id),
  );
  if (!subjectAdjustments.length && linkedSkillIds.length) {
    const subjectIds = unique(
      state.skillGraphs
        .filter((graph) => graph.nodes.some((node) => linkedSkillIds.includes(node.id)))
        .map((graph) => graph.subjectId),
    );
    subjectAdjustments.push(
      ...subjectIds.map((subjectId) => ({
        subjectId,
        minutesDelta: 10,
        priorityDelta: 0.35,
        reason: "모르는 스킬을 즉시 보강",
      })),
    );
  }

  const scope = /이번\s*주|주간/.test(text)
    ? "week"
    : /계속|앞으로|항상/.test(text)
      ? "persistent"
      : /지금|당장/.test(text)
        ? "now"
        : "today";

  return {
    id: `boost-${stableHash(text)}`,
    source: "user",
    rawText: rawText.trim(),
    scope,
    subjectAdjustments,
    linkedSkillIds: unique(linkedSkillIds),
    fatigueOverride: parseFatigue(text),
    readyAtOverride: parseReadyAt(text),
    gapText: gapExpression.test(text) ? rawText.trim() : undefined,
  };
};

export const applyNaturalLanguageBoost = (
  state: StudyQuestState,
  boost: NaturalLanguageBoost,
): StudyQuestState => {
  if (state.boosts.some((candidate) => candidate.id === boost.id)) return state;
  const adjustmentBySubject = new Map(
    boost.subjectAdjustments.map((adjustment) => [adjustment.subjectId, adjustment]),
  );
  const subjects = state.subjects.map((subject) => {
    const adjustment = adjustmentBySubject.get(subject.id);
    if (!adjustment) return subject;
    const minimum = subject.role === "main" ? 30 : subject.minimumTouchMinutes;
    const maximum = subject.role === "main" ? 120 : 90;
    const dailyTargetMinutes = Math.round(
      clamp(subject.dailyTargetMinutes + adjustment.minutesDelta, minimum, maximum),
    );
    return {
      ...subject,
      dailyTargetMinutes,
      weeklyTargetMinutes: dailyTargetMinutes * 7,
      priorityBoost: rounded(clamp(subject.priorityBoost + adjustment.priorityDelta, -1, 3)),
    };
  });

  const inferredSubjectId =
    boost.subjectAdjustments[0]?.subjectId ??
    state.skillGraphs.find((graph) =>
      graph.nodes.some((node) => boost.linkedSkillIds.includes(node.id)),
    )?.subjectId;
  const gap: KnowledgeGap | undefined =
    boost.gapText && inferredSubjectId
      ? {
          id: `gap-${boost.id}`,
          subjectId: inferredSubjectId,
          rawText: boost.gapText,
          linkedSkillIds: boost.linkedSkillIds,
          urgency: 0.85,
          status: "new",
        }
      : undefined;

  const boosted: StudyQuestState = {
    ...state,
    subjects,
    gaps: gap ? [...state.gaps, gap] : state.gaps,
    boosts: [...state.boosts, boost],
  };
  if (!state.curriculum) return boosted;
  if (state.curriculum.source === "ai") {
    return {
      ...boosted,
      stage: "curriculum",
      curriculum: {
        ...state.curriculum,
        revision: state.curriculum.revision + 1,
        days: state.curriculum.days.map((day) => ({
          ...day,
          adaptationReason: `AI 원안 보존 · 자연어 피드백 ${boost.id}와 최신 우선순위를 실행 일정에 반영함`,
        })),
      },
    };
  }
  return {
    ...boosted,
    stage: "curriculum",
    curriculum: generateSevenDayCurriculum(boosted, state.curriculum.startDate),
  };
};

export const processNaturalLanguageFeedback = (
  state: StudyQuestState,
  rawText: string,
): { readonly state: StudyQuestState; readonly boost: NaturalLanguageBoost } => {
  const boost = interpretNaturalLanguageBoost(state, rawText);
  return { state: applyNaturalLanguageBoost(state, boost), boost };
};

export const deriveProactiveBoosts = (state: StudyQuestState): NaturalLanguageBoost[] => {
  const candidates = state.skillGraphs
    .flatMap((graph) => graph.nodes)
    .filter((node) => node.mastery < 0.45 || node.uncertainty > 0.65)
    .sort(
      (left, right) => needScore(state, right) - needScore(state, left) || left.id.localeCompare(right.id),
    );
  const seenSubjects = new Set<string>();
  return candidates.flatMap((node) => {
    if (seenSubjects.has(node.subjectId)) return [];
    seenSubjects.add(node.subjectId);
    return [
      {
        id: `coach-boost-${node.id}`,
        source: "coach",
        rawText: `${node.name}의 낮은 숙련도 또는 높은 불확실성을 감지했습니다.`,
        scope: "week",
        subjectAdjustments: [
          {
            subjectId: node.subjectId,
            minutesDelta: 5,
            priorityDelta: 0.2,
            reason: `${node.name} 선수 개념과 적용 문제를 보강`,
          },
        ],
        linkedSkillIds: [node.id, ...node.prerequisiteIds],
        gapText: `${node.name}을(를) 설명과 적용 모두에서 다시 확인`,
      },
    ];
  });
};

const orderedSubjectsForDay = (
  state: StudyQuestState,
  day: CurriculumDay,
): Subject[] => {
  const included = new Set(
    day.quests
      .filter((quest) => quest.status !== "completed" && quest.estimatedMinutes > 0)
      .map((quest) => quest.primarySubjectId),
  );
  return state.subjects
    .filter((subject) => subject.active && included.has(subject.id))
    .sort(
      (left, right) =>
        Number(right.role === "main") - Number(left.role === "main") ||
        right.priorityBoost - left.priorityBoost ||
        left.id.localeCompare(right.id),
    );
};

const fatigueTarget = (
  subject: Subject,
  fatigue: FatigueLevel,
  state: StudyQuestState,
  questDemand: number,
): number => {
  if (questDemand <= 0) return 0;
  if (fatigue <= 3) return questDemand;
  if (subject.role === "main") {
    const cap = fatigue === 5
      ? state.schedulePolicy.mainMinimumMinutes
      : Math.max(state.schedulePolicy.mainMinimumMinutes, 45);
    return Math.min(questDemand, cap);
  }
  const cap = fatigue === 5 ? subject.minimumTouchMinutes : 20;
  return Math.min(questDemand, cap);
};

export const buildReverseSchedule = (
  state: StudyQuestState,
  checkIn: DailyCheckIn,
  providedDay?: CurriculumDay,
  protectGameTime = true,
): DailySchedule => {
  const day =
    providedDay ?? state.curriculum?.days.find((candidate) => candidate.date === checkIn.date);
  if (!day) throw new Error(`해당 날짜의 커리큘럼이 없습니다: ${checkIn.date}`);

  const scheduleWindow = resolveScheduleWindow(state.schedulePolicy, checkIn.date);
  const readyAt = scheduleWindow.studyEnabled
    ? minutesFromClock(checkIn.readyAt)
    : minutesFromClock(scheduleWindow.learningDeadline);
  const deadline = minutesFromClock(scheduleWindow.learningDeadline);
  const wrapStart = deadline - state.schedulePolicy.wrapUpMinutes;
  const availableStudyMinutes = Math.max(0, wrapStart - readyAt);
  const subjects = orderedSubjectsForDay(state, day);
  const incompleteQuests = day.quests.filter(
    (quest) => quest.status !== "completed" && quest.estimatedMinutes > 0,
  );
  const questDemand = new Map(
    incompleteQuests.map((quest) => [quest.id, Math.max(0, Math.round(quest.estimatedMinutes))]),
  );
  const demandBySubject = new Map<string, number>();
  for (const quest of incompleteQuests) {
    demandBySubject.set(
      quest.primarySubjectId,
      (demandBySubject.get(quest.primarySubjectId) ?? 0) + (questDemand.get(quest.id) ?? 0),
    );
  }

  const mainSubjects = subjects.filter((subject) => subject.role === "main");
  const supportSubjects = subjects.filter((subject) => subject.role === "support");
  const targets = new Map(
    subjects.map((subject) => [
      subject.id,
      fatigueTarget(
        subject,
        checkIn.fatigue,
        state,
        demandBySubject.get(subject.id) ?? 0,
      ),
    ]),
  );
  const allocations = new Map(subjects.map((subject) => [subject.id, 0]));

  let remaining = availableStudyMinutes;
  const addAllocation = (subjectId: string, cap: number, requested: number): void => {
    if (remaining <= 0 || requested <= 0) return;
    const current = allocations.get(subjectId) ?? 0;
    const amount = Math.min(remaining, requested, Math.max(0, cap - current));
    allocations.set(subjectId, current + amount);
    remaining -= amount;
  };

  for (const mainSubject of mainSubjects) {
    addAllocation(
      mainSubject.id,
      targets.get(mainSubject.id) ?? 0,
      Math.min(state.schedulePolicy.mainMinimumMinutes, targets.get(mainSubject.id) ?? 0),
    );
  }
  for (const subject of supportSubjects) {
    addAllocation(
      subject.id,
      targets.get(subject.id) ?? 0,
      Math.min(subject.minimumTouchMinutes, targets.get(subject.id) ?? 0),
    );
  }

  const distributeRoundRobin = (
    candidates: readonly Subject[],
    capFor: (subject: Subject) => number,
  ): void => {
    let progressed = true;
    while (remaining > 0 && progressed) {
      progressed = false;
      for (const subject of candidates) {
        const before = remaining;
        addAllocation(subject.id, capFor(subject), 5);
        if (remaining < before) progressed = true;
        if (remaining <= 0) break;
      }
    }
  };

  distributeRoundRobin(mainSubjects, (subject) =>
    Math.min(targets.get(subject.id) ?? 0, 45));
  distributeRoundRobin(supportSubjects, (subject) => targets.get(subject.id) ?? 0);
  distributeRoundRobin(mainSubjects, (subject) => targets.get(subject.id) ?? 0);

  const allocatedByQuest = new Map(day.quests.map((quest) => [quest.id, 0]));

  let cursor = readyAt;
  const blocks: ScheduleBlock[] = [];
  for (const subject of subjects) {
    let subjectMinutes = allocations.get(subject.id) ?? 0;
    const quests = incompleteQuests.filter(
      (quest) => quest.primarySubjectId === subject.id,
    );
    for (const quest of quests) {
      if (subjectMinutes <= 0) break;
      let questMinutes = Math.min(subjectMinutes, questDemand.get(quest.id) ?? 0);
      allocatedByQuest.set(quest.id, questMinutes);
      const chunkCount = Math.ceil(questMinutes / state.schedulePolicy.maxSessionMinutes);
      let chunkIndex = 0;
      while (questMinutes > 0) {
        const duration = Math.min(questMinutes, state.schedulePolicy.maxSessionMinutes);
        blocks.push({
          id: `block-${checkIn.date}-${quest.id}-${chunkIndex + 1}`,
          kind: "study",
          start: clockFromMinutes(cursor),
          end: clockFromMinutes(cursor + duration),
          durationMinutes: duration,
          title: `${quest.title}${chunkCount > 1 ? ` ${chunkIndex + 1}/${chunkCount}` : ""}`,
          subjectId: subject.id,
          questIds: [quest.id],
        });
        cursor += duration;
        questMinutes -= duration;
        subjectMinutes -= duration;
        chunkIndex += 1;
      }
    }
  }

  if (cursor < wrapStart) {
    blocks.push({
      id: `block-${checkIn.date}-recovery`,
      kind: "recovery",
      start: clockFromMinutes(cursor),
      end: clockFromMinutes(wrapStart),
      durationMinutes: wrapStart - cursor,
      title: "저녁·회복·완충 시간",
      questIds: [],
    });
    cursor = wrapStart;
  }
  if (readyAt < deadline) {
    const actualWrapStart = Math.max(cursor, Math.min(readyAt, wrapStart));
    if (actualWrapStart < deadline) {
      blocks.push({
        id: `block-${checkIn.date}-wrap-up`,
        kind: "wrap-up",
        start: clockFromMinutes(actualWrapStart),
        end: clockFromMinutes(deadline),
        durationMinutes: deadline - actualWrapStart,
        title: "증거 저장과 내일 퀘스트 생성",
        questIds: [],
      });
    }
  }

  if (protectGameTime) {
    const gameStart = minutesFromClock(scheduleWindow.gameStart);
    const gameEnd = minutesFromClock(scheduleWindow.gameEnd);
    blocks.push({
      id: `block-${checkIn.date}-game`,
      kind: "game",
      start: scheduleWindow.gameStart,
      end: scheduleWindow.gameEnd,
      durationMinutes: Math.max(0, gameEnd - gameStart),
      title: "게임 후 PC 종료",
      questIds: [],
    });
  }

  const daySubjectIds = unique(day.quests.map((quest) => quest.primarySubjectId));
  const allocatedMinutesBySubject = Object.fromEntries(
    daySubjectIds.map((subjectId) => [subjectId, allocations.get(subjectId) ?? 0]),
  );
  const deferredMinutesBySubject = Object.fromEntries(
    daySubjectIds.map((subjectId) => [
      subjectId,
      Math.max(
        0,
        (demandBySubject.get(subjectId) ?? 0) - (allocations.get(subjectId) ?? 0),
      ),
    ]),
  );
  const allocatedMinutesByQuest = Object.fromEntries(
    day.quests.map((quest) => [quest.id, allocatedByQuest.get(quest.id) ?? 0]),
  );
  const deferredMinutesByQuest = Object.fromEntries(
    day.quests.map((quest) => [
      quest.id,
      quest.status === "completed"
        ? 0
        : Math.max(
            0,
            Math.max(0, Math.round(quest.estimatedMinutes)) -
              (allocatedByQuest.get(quest.id) ?? 0),
          ),
    ]),
  );

  return {
    id: `schedule-${checkIn.date}-${checkIn.readyAt}-${checkIn.fatigue}`,
    date: checkIn.date,
    readyAt: scheduleWindow.studyEnabled ? checkIn.readyAt : scheduleWindow.learningDeadline,
    deadline: scheduleWindow.learningDeadline,
    availableStudyMinutes,
    allocatedMinutesBySubject,
    deferredMinutesBySubject,
    allocatedMinutesByQuest,
    deferredMinutesByQuest,
    blocks,
  };
};

export const evidenceQuality = (evidence: LearningEvidence): number => {
  const { correctness, independence, transfer, explanation } = evidence.rubric;
  assertUnitInterval(correctness, "정확성");
  assertUnitInterval(independence, "독립성");
  assertUnitInterval(transfer, "전이");
  assertUnitInterval(explanation, "설명력");
  return rounded(
    correctness * 0.4 + independence * 0.25 + transfer * 0.2 + explanation * 0.15,
  );
};

export const updateMasteryFromEvidence = (
  skill: SkillNode,
  evidence: LearningEvidence,
): SkillNode => {
  if (!evidence.skillIds.includes(skill.id) || skill.evidenceIds.includes(evidence.id)) return skill;
  const quality = evidenceQuality(evidence);
  return {
    ...skill,
    mastery: rounded(clamp(skill.mastery * 0.65 + quality * 0.35)),
    uncertainty: rounded(
      clamp(skill.uncertainty * 0.72 + Math.abs(quality - skill.mastery) * 0.18, 0.05, 1),
    ),
    attempts: skill.attempts + 1,
    evidenceIds: [...skill.evidenceIds, evidence.id],
    lastPracticedOn: evidence.submittedOn,
  };
};

export const submitEvidence = (
  state: StudyQuestState,
  evidence: LearningEvidence,
): StudyQuestState => {
  if (state.evidence.some((candidate) => candidate.id === evidence.id)) return state;
  evidenceQuality(evidence);
  const questExists = state.curriculum?.days.some((day) =>
    day.quests.some((quest) => quest.id === evidence.questId),
  );
  if (!questExists) throw new Error(`퀘스트를 찾을 수 없습니다: ${evidence.questId}`);

  const skillIds = new Set(state.skillGraphs.flatMap((graph) => graph.nodes.map((node) => node.id)));
  for (const skillId of evidence.skillIds) {
    if (!skillIds.has(skillId)) throw new Error(`증거에 연결된 스킬을 찾을 수 없습니다: ${skillId}`);
  }

  const skillGraphs = state.skillGraphs.map((graph) => ({
    ...graph,
    nodes: graph.nodes.map((node) => updateMasteryFromEvidence(node, evidence)),
  }));
  const curriculum = state.curriculum
    ? {
        ...state.curriculum,
        days: state.curriculum.days.map((day) => ({
          ...day,
          quests: day.quests.map((quest) =>
            quest.id === evidence.questId ? { ...quest, status: "completed" as const } : quest,
          ),
        })),
      }
    : undefined;

  return {
    ...state,
    stage: "review",
    skillGraphs,
    curriculum,
    evidence: [...state.evidence, evidence],
  };
};
