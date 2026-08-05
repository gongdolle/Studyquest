export type ID = string;
export type ISODate = string;
export type ClockTime = string;
export type SubjectRole = "main" | "support";
export type FatigueLevel = 1 | 2 | 3 | 4 | 5;
export type WeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type WorkflowStage =
  | "subjects"
  | "intake"
  | "diagnostic"
  | "skill-graph"
  | "curriculum"
  | "daily-plan"
  | "lesson"
  | "review";

export interface Subject {
  readonly id: ID;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly role: SubjectRole;
  readonly dailyTargetMinutes: number;
  readonly weeklyTargetMinutes: number;
  readonly minimumTouchMinutes: number;
  readonly priorityBoost: number;
  readonly active: boolean;
}

export interface SubjectRegistration {
  readonly id: ID;
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly role?: SubjectRole;
  readonly dailyTargetMinutes?: number;
  readonly minimumTouchMinutes?: number;
}

export interface LearningResource {
  readonly id: ID;
  readonly subjectId: ID;
  readonly kind: "book" | "manuscript" | "course" | "repository" | "note";
  readonly title: string;
  readonly uri?: string;
  readonly currentSection?: string;
}

export interface LearningGoal {
  readonly id: ID;
  readonly subjectId: ID;
  readonly text: string;
  readonly successEvidence: string;
  readonly priority: number;
  readonly targetDate?: ISODate;
}

export interface KnowledgeGap {
  readonly id: ID;
  readonly subjectId: ID;
  readonly rawText: string;
  readonly linkedSkillIds: readonly ID[];
  readonly urgency: number;
  readonly status: "new" | "probing" | "learning" | "resolved";
}

export interface LearningIntentInput {
  readonly id: ID;
  readonly subjectId: ID;
  readonly goalText: string;
  readonly successEvidence: string;
  readonly unknownText?: string;
  readonly linkedSkillIds?: readonly ID[];
  readonly priority?: number;
  readonly targetDate?: ISODate;
}

export interface SkillDefinition {
  readonly id: ID;
  readonly name: string;
  readonly prerequisiteIds?: readonly ID[];
  readonly mastery?: number;
  readonly uncertainty?: number;
}

export interface SkillNode {
  readonly id: ID;
  readonly subjectId: ID;
  readonly name: string;
  readonly prerequisiteIds: readonly ID[];
  readonly mastery: number;
  readonly uncertainty: number;
  readonly attempts: number;
  readonly evidenceIds: readonly ID[];
  readonly lastPracticedOn?: ISODate;
}

export interface SkillEdge {
  readonly fromSkillId: ID;
  readonly toSkillId: ID;
}

export interface SkillGraph {
  readonly subjectId: ID;
  readonly nodes: readonly SkillNode[];
  readonly edges: readonly SkillEdge[];
}

export interface DiagnosticQuestion {
  readonly id: ID;
  readonly skillId: ID;
  readonly prompt: string;
  readonly difficulty: number;
}

export interface DiagnosticResult {
  readonly questionId: ID;
  readonly score: number;
  readonly confidence?: number;
  readonly hesitationSeconds?: number;
}

export interface Diagnostic {
  readonly id: ID;
  readonly subjectId: ID;
  readonly targetSkillIds: readonly ID[];
  readonly questions: readonly DiagnosticQuestion[];
  readonly status: "ready" | "running" | "scored";
  readonly results: readonly DiagnosticResult[];
}

export type QuestKind =
  | "diagnostic"
  | "lesson"
  | "practice"
  | "authoring"
  | "review";

export interface Quest {
  readonly id: ID;
  readonly date: ISODate;
  readonly title: string;
  readonly description: string;
  readonly primarySubjectId: ID;
  readonly taggedSubjectIds: readonly ID[];
  readonly skillIds: readonly ID[];
  readonly estimatedMinutes: number;
  readonly kind: QuestKind;
  readonly requiredEvidence: string;
  readonly status: "planned" | "active" | "completed" | "deferred";
}

export interface CurriculumDay {
  readonly date: ISODate;
  readonly quests: readonly Quest[];
  readonly plannedMinutes: number;
  readonly adaptationReason?: string;
}

export interface Curriculum7Day {
  readonly id: ID;
  readonly startDate: ISODate;
  readonly revision: number;
  readonly source?: "ai" | "local";
  readonly generatedBy?: "codex" | "claude" | "openai" | "anthropic" | "deepseek";
  readonly days: readonly CurriculumDay[];
}

export type LessonPhaseKind =
  | "orient"
  | "explain"
  | "example"
  | "explore"
  | "synthesize";

export interface LessonPhase {
  readonly kind: LessonPhaseKind;
  readonly startMinute: number;
  readonly durationMinutes: number;
  readonly coachPrompt: string;
}

export interface ThirtyMinuteLesson {
  readonly id: ID;
  readonly questId: ID;
  readonly title: string;
  readonly phases: readonly LessonPhase[];
  readonly totalMinutes: 30;
}

export interface LessonMessage {
  readonly role: "learner" | "coach" | "reviewer";
  readonly text: string;
  readonly atMinute: number;
}

export interface LessonSession {
  readonly id: ID;
  readonly lessonId: ID;
  readonly questId: ID;
  readonly status: "ready" | "running" | "submitted" | "reviewed";
  readonly messages: readonly LessonMessage[];
  readonly evidenceId?: ID;
}

export interface EvidenceRubric {
  readonly correctness: number;
  readonly independence: number;
  readonly transfer: number;
  readonly explanation: number;
}

export interface LearningEvidence {
  readonly id: ID;
  readonly questId: ID;
  readonly skillIds: readonly ID[];
  readonly type: "answer" | "code" | "derivation" | "manuscript" | "diagram";
  readonly content: string;
  readonly uri?: string;
  readonly submittedOn: ISODate;
  readonly rubric: EvidenceRubric;
}

export interface SubjectBoostAdjustment {
  readonly subjectId: ID;
  readonly minutesDelta: number;
  readonly priorityDelta: number;
  readonly reason: string;
}

export interface NaturalLanguageBoost {
  readonly id: ID;
  readonly source: "user" | "coach";
  readonly rawText: string;
  readonly scope: "now" | "today" | "week" | "persistent";
  readonly subjectAdjustments: readonly SubjectBoostAdjustment[];
  readonly linkedSkillIds: readonly ID[];
  readonly fatigueOverride?: FatigueLevel;
  readonly readyAtOverride?: ClockTime;
  readonly gapText?: string;
}

export interface SchedulePolicy {
  readonly learningDeadline: ClockTime;
  readonly wrapUpMinutes: number;
  readonly gameStart: ClockTime;
  readonly gameEnd: ClockTime;
  readonly mainMinimumMinutes: number;
  readonly mainPreferredMinutes: number;
  readonly maxSessionMinutes: number;
  readonly configuredBy?: "fallback" | "ai-interview" | "manual";
  readonly defaultReadyAt?: ClockTime;
  readonly dayOverrides?: readonly ScheduleDayOverride[];
  readonly constraintsSummary?: string;
}

export interface ScheduleDayOverride {
  readonly weekday: WeekdayKey;
  readonly studyEnabled: boolean;
  readonly readyAt: ClockTime;
  readonly learningDeadline: ClockTime;
  readonly note: string;
}

export interface DailyCheckIn {
  readonly date: ISODate;
  readonly readyAt: ClockTime;
  readonly fatigue: FatigueLevel;
  readonly note?: string;
}

export type ScheduleBlockKind = "study" | "recovery" | "wrap-up" | "game";

export interface ScheduleBlock {
  readonly id: ID;
  readonly kind: ScheduleBlockKind;
  readonly start: ClockTime;
  readonly end: ClockTime;
  readonly durationMinutes: number;
  readonly title: string;
  readonly subjectId?: ID;
  readonly questIds: readonly ID[];
}

export interface DailySchedule {
  readonly id: ID;
  readonly date: ISODate;
  readonly readyAt: ClockTime;
  readonly deadline: ClockTime;
  readonly availableStudyMinutes: number;
  readonly allocatedMinutesBySubject: Readonly<Record<ID, number>>;
  readonly deferredMinutesBySubject: Readonly<Record<ID, number>>;
  /** 퀘스트별 실제 배정량. 이전 소비자와의 호환을 위해 선택 필드로 공개합니다. */
  readonly allocatedMinutesByQuest?: Readonly<Record<ID, number>>;
  /** 완료되지 않은 퀘스트 수요 중 오늘 배정하지 못한 시간입니다. */
  readonly deferredMinutesByQuest?: Readonly<Record<ID, number>>;
  readonly blocks: readonly ScheduleBlock[];
}

export interface StudyQuestState {
  readonly stage: WorkflowStage;
  readonly subjects: readonly Subject[];
  readonly resources: readonly LearningResource[];
  readonly goals: readonly LearningGoal[];
  readonly gaps: readonly KnowledgeGap[];
  readonly skillGraphs: readonly SkillGraph[];
  readonly diagnostics: readonly Diagnostic[];
  readonly curriculum?: Curriculum7Day;
  readonly sessions: readonly LessonSession[];
  readonly evidence: readonly LearningEvidence[];
  readonly boosts: readonly NaturalLanguageBoost[];
  readonly schedulePolicy: SchedulePolicy;
}
