import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SandboxLessonWidget } from "./SandboxLessonWidget";
import type { DeclarativeLessonWidget, FinalCheck, LessonWidget } from "../lib/lesson";

export function LessonWidgetView({
  widget,
  onExplore,
}: {
  widget: LessonWidget;
  onExplore(): void;
}) {
  if (widget.kind === "sandbox-lab") {
    return <SandboxLessonWidget widget={widget} onExplore={onExplore} />;
  }
  return <DeclarativeLessonWidgetView widget={widget} onExplore={onExplore} />;
}

function DeclarativeLessonWidgetView({
  widget,
  onExplore,
}: {
  widget: DeclarativeLessonWidget;
  onExplore(): void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = widget.items[Math.min(activeIndex, widget.items.length - 1)];

  useEffect(() => setActiveIndex(0), [widget.id]);

  const select = (index: number) => {
    setActiveIndex(Math.min(widget.items.length - 1, Math.max(0, index)));
    onExplore();
  };

  return (
    <figure className="lesson-widget" aria-labelledby={`${widget.id}-title`}>
      <figcaption>
        <span className="widget-kicker"><SlidersHorizontal size={14} /> 안전한 JS 위젯</span>
        <strong id={`${widget.id}-title`}>{widget.title}</strong>
        <p>{widget.instruction}</p>
      </figcaption>

      {widget.kind === "comparison" && (
        <div className="widget-tabs" role="tablist" aria-label={`${widget.title} 비교 항목`}>
          {widget.items.map((item, index) => (
            <button
              type="button"
              role="tab"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "is-active" : ""}
              key={`${widget.id}-${item.label}-${index}`}
              onClick={() => select(index)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {widget.kind === "parameter-sweep" && (
        <label className="widget-slider">
          <span>변화 단계 <strong>{activeIndex + 1}/{widget.items.length}</strong></span>
          <input
            type="range"
            min="0"
            max={widget.items.length - 1}
            step="1"
            value={activeIndex}
            onChange={(event) => select(Number(event.target.value))}
          />
        </label>
      )}

      <div className="widget-stage" aria-live="polite">
        <div className="widget-stage-head">
          <span>{String(activeIndex + 1).padStart(2, "0")}</span>
          <strong>{active.label}</strong>
          <em>{active.value}</em>
        </div>
        <div className="widget-meter" aria-label={`${active.label} 값 ${active.value}`}>
          <span style={{ width: `${active.value}%` }} />
        </div>
        <p>{active.body}</p>
      </div>

      {widget.kind === "stepper" && (
        <div className="widget-step-controls">
          <button type="button" className="button" disabled={activeIndex === 0} onClick={() => select(activeIndex - 1)}>
            <ChevronLeft size={15} /> 이전
          </button>
          <div className="widget-dots" aria-hidden="true">
            {widget.items.map((_, index) => <span className={index === activeIndex ? "is-active" : ""} key={index} />)}
          </div>
          <button type="button" className="button" disabled={activeIndex === widget.items.length - 1} onClick={() => select(activeIndex + 1)}>
            다음 <ChevronRight size={15} />
          </button>
        </div>
      )}

      <details className="widget-data-table">
        <summary>텍스트·수치로 전체 보기</summary>
        <table>
          <thead><tr><th>단계</th><th>설명</th><th>값</th></tr></thead>
          <tbody>
            {widget.items.map((item, index) => (
              <tr key={`${widget.id}-row-${index}`}><td>{item.label}</td><td>{item.body}</td><td>{item.value}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

export function FinalLessonCheck({
  check,
  onComplete,
}: {
  check: FinalCheck;
  onComplete(score: number, total: number): void;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [graded, setGraded] = useState(false);
  const checkIdentity = JSON.stringify(check);

  useEffect(() => {
    setCurrentIndex(0);
    setAnswers({});
    setGraded(false);
  }, [checkIdentity]);

  const score = useMemo(() => check.questions.reduce(
    (total, question) => total + (answers[question.id] === question.correctIndex ? 1 : 0),
    0,
  ), [answers, check.questions]);
  const answeredCount = Object.keys(answers).length;
  const question = check.questions[currentIndex];

  const grade = () => {
    if (answeredCount !== check.questions.length) return;
    setGraded(true);
    onComplete(score, check.questions.length);
  };

  const retry = () => {
    setAnswers({});
    setCurrentIndex(0);
    setGraded(false);
  };

  if (graded) {
    const percentage = Math.round((score / check.questions.length) * 100);
    return (
      <section className="final-check result" aria-live="polite">
        <div className="final-result-head">
          <CheckCircle2 size={24} />
          <div><span>마지막 확인 완료</span><strong>{score}/{check.questions.length} · {percentage}%</strong></div>
        </div>
        <div className="final-review-list">
          {check.questions.map((item, index) => {
            const correct = answers[item.id] === item.correctIndex;
            return (
              <div className={correct ? "is-correct" : "is-wrong"} key={item.id}>
                <span>{index + 1}. {correct ? "이해됨" : "다시 볼 지점"}</span>
                <strong>{item.prompt}</strong>
                <p>{item.explanation}</p>
              </div>
            );
          })}
        </div>
        <button type="button" className="button" onClick={retry}><RotateCcw size={15} /> 다시 확인</button>
      </section>
    );
  }

  return (
    <section className="final-check" aria-labelledby="final-check-title">
      <div className="final-check-head">
        <span>Final check · {currentIndex + 1}/{check.questions.length}</span>
        <h3 id="final-check-title">{question.prompt}</h3>
        <p>{check.intro}</p>
      </div>
      <div className="final-options">
        {question.options.map((option, index) => (
          <button
            type="button"
            className={answers[question.id] === index ? "is-selected" : ""}
            aria-pressed={answers[question.id] === index}
            key={`${question.id}-${index}`}
            onClick={() => setAnswers((current) => ({ ...current, [question.id]: index }))}
          >
            <span>{String.fromCharCode(65 + index)}</span>{option}
          </button>
        ))}
      </div>
      <div className="final-check-controls">
        <button type="button" className="button" disabled={currentIndex === 0} onClick={() => setCurrentIndex((value) => value - 1)}>
          <ChevronLeft size={15} /> 이전
        </button>
        <span>{answeredCount}/{check.questions.length} 답변</span>
        {currentIndex < check.questions.length - 1 ? (
          <button type="button" className="button primary" disabled={answers[question.id] === undefined} onClick={() => setCurrentIndex((value) => value + 1)}>
            다음 <ChevronRight size={15} />
          </button>
        ) : (
          <button type="button" className="button primary" disabled={answeredCount !== check.questions.length} onClick={grade}>
            <CheckCircle2 size={15} /> 한 번에 채점
          </button>
        )}
      </div>
    </section>
  );
}
