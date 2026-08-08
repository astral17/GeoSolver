"use client";

import type {
  ExpressionRow,
  ParsedConstraint,
  Point,
  SolverMode,
  SolverProgress,
  SolveResult,
} from "./domain";
import { equationText } from "./expressions";

type Translate = (russian: string, english: string) => string;

type SolverPanelProps = {
  parsedKnown: (ExpressionRow & {
    parsed: ParsedConstraint | null;
  })[];
  points: Point[];
  result: SolveResult;
  solverMode: SolverMode;
  solverMaxIterations: number;
  solverTimeLimitMs: number;
  solving: boolean;
  solverProgress: SolverProgress | null;
  t: Translate;
  formatNumber: (value: number) => string;
  runSolver: () => void;
  close: () => void;
};

export function SolverPanel({
  parsedKnown,
  points,
  result,
  solverMode,
  solverMaxIterations,
  solverTimeLimitMs,
  solving,
  solverProgress,
  t,
  formatNumber,
  runSolver,
  close,
}: SolverPanelProps) {
  const constraints = parsedKnown.filter(
    (item) => item.parsed && item.parsed.kind !== "definition",
  );
  const definitions = parsedKnown.filter(
    (item) => item.parsed?.kind === "definition",
  );
  const analyticSteps = [
    ...(result.steps ?? []),
    ...result.values.flatMap((value) => value.steps ?? []),
    ...(result.statements ?? []).flatMap((statement) => statement.steps),
  ].filter(
    (step, index, steps) =>
      steps.findIndex(
        (candidate) =>
          candidate.expression === step.expression &&
          candidate.title.ru === step.title.ru,
      ) === index,
  );
  const proofResults = (result.statements?.length ?? 0) > 0 && (
    <div className="proof-results">
      {result.statements?.map((statement, index) => (
        <div
          className={`proof-result ${statement.verdict}`}
          key={`${statement.label}-${index}`}
        >
          <span>{statement.label}</span>
          <b>
            {statement.verdict === "proved"
              ? t("Доказано", "Proved")
              : statement.verdict === "disproved"
                ? t("Опровергнуто", "Disproved")
                : t("Не установлено", "Undetermined")}
          </b>
          <small>{t(statement.detail.ru, statement.detail.en)}</small>
        </div>
      ))}
    </div>
  );
  const hasIncompleteGoals = Boolean(
    result.goalSummary &&
      result.goalSummary.completed < result.goalSummary.total,
  );
  const goalProgress = result.goalSummary && result.goalSummary.total > 0 && (
    <div
      className={`goal-progress ${hasIncompleteGoals ? "incomplete" : "complete"}`}
      role={hasIncompleteGoals ? "status" : undefined}
    >
      <div>
        <b>
          {hasIncompleteGoals
            ? t("Не все цели выполнены", "Not all targets completed")
            : t("Все цели выполнены", "All targets completed")}
        </b>
        <span>
          {result.goalSummary.completed} {t("из", "of")} {result.goalSummary.total}
        </span>
      </div>
      {hasIncompleteGoals && result.goalSummary.unresolved.length > 0 && (
        <ul>
          {result.goalSummary.unresolved.map((label, index) => (
            <li key={`${label}-${index}`}><code>{label}</code></li>
          ))}
        </ul>
      )}
    </div>
  );
  const drawingProgress = result.drawing && (
    <div className={`drawing-progress ${result.drawing.status}`}>
      <span>
        {result.drawing.status === "rebuilt"
          ? t("Чертёж перестроен", "Drawing rebuilt")
          : result.drawing.status === "approximate"
            ? t("Чертёж перестроен приближённо", "Drawing rebuilt approximately")
            : t("Чертёж оставлен без изменений", "Drawing left unchanged")}
      </span>
      {result.drawing.status !== "unchanged" && (
        <code>Δ {result.drawing.residual.toExponential(2)}</code>
      )}
    </div>
  );

  return (
    <aside className="solver-panel">
      <div className="solver-header">
        <div>
          <span className="eyebrow">{t("РЕШАТЕЛЬ", "SOLVER")}</span>
          <h2>{t("Ход решения", "Solution steps")}</h2>
        </div>
        <button onClick={close} aria-label={t("Закрыть решение", "Close solution")}>
          ×
        </button>
      </div>

      <div
        className="solver-scroll"
        role="region"
        aria-label={t("Ход решения", "Solution steps")}
        tabIndex={0}
      >
        <div className="solve-step">
          <div className="step-marker">1</div>
          <div className="step-content">
            <h3>{t("Система ограничений", "Constraint system")}</h3>
            <p>
              {t(
                solverMode === "analytic"
                  ? "Условия преобразуются в точные факты и связи между величинами."
                  : "Координаты точек — переменные. Каждое условие становится уравнением.",
                solverMode === "analytic"
                  ? "Conditions become exact facts and relations between quantities."
                  : "Point coordinates are variables. Every condition becomes an equation.",
              )}
            </p>
            <div className="equation-card">
              {parsedKnown
                .filter(
                  (
                    item,
                  ): item is ExpressionRow & {
                    parsed: ParsedConstraint;
                  } => Boolean(item.parsed),
                )
                .map((item) => (
                  <div className="equation" key={item.id}>
                    <i style={{ background: item.color }} />
                    <code>{equationText(item.parsed)}</code>
                  </div>
                ))}
              {!parsedKnown.some((item) => item.parsed) && (
                <div className="empty-equations">
                  {t(
                    "Добавьте хотя бы одно условие",
                    "Add at least one condition",
                  )}
                </div>
              )}
            </div>
            <span className="equation-count">
              {constraints.length} {t("ограничений", "constraints")} ·{" "}
              {definitions.length} {t("переменных", "variables")} ·{" "}
              {points.length * 2} {t("координат", "coordinates")}
            </span>
          </div>
        </div>

        <div className="solve-step">
          <div className="step-marker">2</div>
          <div className="step-content">
            <h3>
              {solverMode === "analytic"
                ? t("Точный вывод", "Exact derivation")
                : t("Численный поиск", "Numerical search")}
            </h3>
            <p>
              {solverMode === "analytic"
                ? t(
                    "Решатель применяет только поддерживаемые теоремы и сохраняет кратчайшую найденную цепочку преобразований.",
                    "The solver applies supported theorems only and keeps the shortest derivation it finds.",
                  )
                : t(
                    "Несколько стартовых приближений, адаптивный метод наименьших квадратов и проверка каждого ограничения.",
                    "Multiple starting approximations, adaptive least squares and a check of every constraint.",
                  )}
            </p>
            <div className="method-pills">
              {solverMode === "analytic" ? (
                <>
                  <span>{t("точная арифметика", "exact arithmetic")}</span>
                  <span>{t("теоремы", "theorem rules")}</span>
                  <span>{t("минимальный путь", "shortest path")}</span>
                </>
              ) : (
                <>
                  <span>multi-start</span>
                  <span>{t("МНК", "least squares")}</span>
                  <span>
                    ≤ {solverMaxIterations} {t("итераций", "iterations")}
                  </span>
                  <span>≤ {solverTimeLimitMs} ms</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="solve-step final-step">
          <div
            className={`step-marker ${
              result.kind === "approximate" || hasIncompleteGoals
                || result.kind === "inconsistent"
                ? "warning"
                : "complete"
            }`}
          >
            {result.kind === "dirty"
              ? "…"
              : result.kind === "approximate" || hasIncompleteGoals
                  || result.kind === "inconsistent"
                ? "!"
                : "✓"}
          </div>
          <div className="step-content">
            <h3>{t("Результат", "Result")}</h3>
            {result.kind === "dirty" && (
              <div className="result-card pending-result">
                <span>{t("Условия изменились", "Conditions changed")}</span>
                <p>
                  {t(
                    "Запустите решатель, чтобы пересчитать чертёж.",
                    "Run the solver to update the drawing.",
                  )}
                </p>
                {proofResults}
              </div>
            )}
            {result.kind === "empty" && (
              <div className="result-card pending-result">
                <span>{t("Недостаточно данных", "Not enough data")}</span>
                <p>
                  {t(
                    solverMode === "analytic"
                      ? "Для этих целей пока не найдена поддерживаемая цепочка точных преобразований."
                      : "Добавьте распознаваемые условия слева.",
                    solverMode === "analytic"
                      ? "No supported exact derivation was found for these targets yet."
                      : "Add recognized conditions on the left.",
                  )}
                </p>
                {goalProgress}
                {drawingProgress}
              </div>
            )}
            {result.kind === "inconsistent" && (
              <div className="result-card inconsistent-result" role="alert">
                <span>{t("Система условий противоречива", "The constraint system is inconsistent")}</span>
                <p>
                  {t(
                    "Ни один чертёж не может одновременно выполнить перечисленные условия.",
                    "No drawing can satisfy the listed conditions at the same time.",
                  )}
                </p>
                {(result.contradictions ?? []).map((contradiction, index) => (
                  <div className="contradiction" key={index}>
                    <p>{t(contradiction.detail.ru, contradiction.detail.en)}</p>
                    {contradiction.expressions.map((expression) => (
                      <code key={expression}>{expression}</code>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {(result.kind === "exact" ||
              result.kind === "approximate") && (
              <div
                className={`result-card ${
                  result.kind === "approximate" ? "approximate" : ""
                }`}
              >
                <div className="result-state">
                  <span className="state-dot" />
                  <b>
                    {result.kind === "exact"
                      ? solverMode === "analytic"
                        ? t("Анализ завершён", "Analysis complete")
                        : t("Решение найдено", "Solution found")
                      : t("Показано ближайшее", "Nearest result shown")}
                  </b>
                  <small>
                    {formatNumber(result.elapsed)} {t("мс", "ms")} ·{" "}
                    {result.iterations} {t("итер.", "iter.")}
                    {result.timedOut
                      ? ` · ${t("лимит времени", "time limit")}`
                      : ""}
                    {result.stopped
                      ? ` · ${t("остановлено", "stopped")}`
                      : ""}
                  </small>
                </div>
                <div className="result-values">
                  {result.values.length ? (
                    result.values.map((value, index) => (
                      <div key={`${value.label}-${index}`}>
                        <span>{value.label}</span>
                        <b>
                          {[
                            value.exact ?? formatNumber(value.value),
                            ...(value.alternatives ?? []).map(
                              (alternative) =>
                                alternative.exact ??
                                formatNumber(alternative.value),
                            ),
                          ].join(t(" или ", " or "))}
                          {value.suffix}
                        </b>
                        {value.exact && (
                          <small className="exact-approximation">
                            ≈ {[
                              formatNumber(value.value),
                              ...(value.alternatives ?? []).map(
                                (alternative) =>
                                  formatNumber(alternative.value),
                              ),
                            ].join(t(" или ", " or "))}
                            {value.suffix}
                          </small>
                        )}
                      </div>
                    ))
                  ) : !(result.statements?.length ?? 0) ? (
                    <p>
                      {t(
                        "Добавьте цель в раздел «Что найти».",
                        "Add a target in the “Find” section.",
                      )}
                    </p>
                  ) : null}
                </div>
                {proofResults}
                {goalProgress}
                {solverMode === "analytic" && analyticSteps.length > 0 && (
                  <div className="analytic-steps">
                    <b>{t("Кратчайший вывод", "Shortest derivation")}</b>
                    <ol>
                      {analyticSteps.map((step, index) => (
                        <li key={`${step.title.ru}-${step.expression ?? index}`}>
                          <span>{t(step.title.ru, step.title.en)}</span>
                          <small>{t(step.detail.ru, step.detail.en)}</small>
                          {step.expression && <code>{step.expression}</code>}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {drawingProgress}
                <div className="residual">
                  <span>
                    {solverMode === "analytic"
                      ? t("Точный вывод", "Exact derivation")
                      : t("Невязка", "Residual")}
                  </span>
                  <code>
                    {solverMode === "analytic"
                      ? t("без округления", "without rounding")
                      : result.residual.toExponential(2)}
                  </code>
                </div>
              </div>
            )}
            {result.kind === "approximate" && result.issues.length > 0 && (
              <div className="issues">
                <b>
                  {t("Наибольшие невязки", "Largest residuals")}
                </b>
                {result.issues.map((issue) => (
                  <div key={issue.expression}>
                    <span>{issue.expression}</span>
                    <em>Δ {formatNumber(issue.error)}</em>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="solver-footer">
        <button
          className="solve-button"
          onClick={runSolver}
        >
          <span className={solving ? "spinner" : ""}>
            {solving ? "■" : "▶"}
          </span>
          {solving
            ? t("Остановить", "Stop")
            : t("Решить систему", "Solve system")}
          {solving && solverProgress ? (
            <small className="solver-live-progress">
              {`${formatNumber(solverProgress.elapsed)} ${t("мс", "ms")} · `}
              {`${solverProgress.iterations} ${t("итер.", "iter.")}`}
            </small>
          ) : (
            <kbd>Ctrl ↵</kbd>
          )}
        </button>
        <small>
          {t(
            "Вычисляется локально · данные не покидают браузер",
            "Computed locally · data never leaves your browser",
          )}
        </small>
      </div>
    </aside>
  );
}
