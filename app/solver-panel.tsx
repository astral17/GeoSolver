"use client";

import type {
  ExpressionRow,
  ParsedConstraint,
  Point,
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
  solverMaxIterations: number;
  solverTimeLimitMs: number;
  solving: boolean;
  t: Translate;
  formatNumber: (value: number) => string;
  runSolver: () => void;
  close: () => void;
};

export function SolverPanel({
  parsedKnown,
  points,
  result,
  solverMaxIterations,
  solverTimeLimitMs,
  solving,
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
                "Координаты точек — переменные. Каждое условие становится уравнением.",
                "Point coordinates are variables. Every condition becomes an equation.",
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
            <h3>{t("Численный поиск", "Numerical search")}</h3>
            <p>
              {t(
                "Несколько стартовых приближений, адаптивный метод наименьших квадратов и проверка каждого ограничения.",
                "Multiple starting approximations, adaptive least squares and a check of every constraint.",
              )}
            </p>
            <div className="method-pills">
              <span>multi-start</span>
              <span>{t("МНК", "least squares")}</span>
              <span>
                ≤ {solverMaxIterations} {t("итераций", "iterations")}
              </span>
              <span>≤ {solverTimeLimitMs} ms</span>
            </div>
          </div>
        </div>

        <div className="solve-step final-step">
          <div
            className={`step-marker ${
              result.kind === "approximate" ? "warning" : "complete"
            }`}
          >
            {result.kind === "dirty"
              ? "…"
              : result.kind === "approximate"
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
              </div>
            )}
            {result.kind === "empty" && (
              <div className="result-card pending-result">
                <span>{t("Недостаточно данных", "Not enough data")}</span>
                <p>
                  {t(
                    "Добавьте распознаваемые условия слева.",
                    "Add recognized conditions on the left.",
                  )}
                </p>
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
                      ? t("Решение найдено", "Solution found")
                      : t("Показано ближайшее", "Nearest result shown")}
                  </b>
                  <small>
                    {formatNumber(result.elapsed)} {t("мс", "ms")} ·{" "}
                    {result.iterations} {t("итер.", "iter.")}
                    {result.timedOut
                      ? ` · ${t("лимит времени", "time limit")}`
                      : ""}
                  </small>
                </div>
                <div className="result-values">
                  {result.values.length ? (
                    result.values.map((value) => (
                      <div key={value.label}>
                        <span>{value.label}</span>
                        <b>
                          {formatNumber(value.value)}
                          {value.suffix}
                        </b>
                      </div>
                    ))
                  ) : (
                    <p>
                      {t(
                        "Добавьте цель в раздел «Что найти».",
                        "Add a target in the “Find” section.",
                      )}
                    </p>
                  )}
                </div>
                <div className="residual">
                  <span>{t("Невязка", "Residual")}</span>
                  <code>{result.residual.toExponential(2)}</code>
                </div>
              </div>
            )}
            {result.kind === "approximate" && result.issues.length > 0 && (
              <div className="issues">
                <b>
                  {t("Противоречивые условия", "Conflicting conditions")}
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
          disabled={solving}
        >
          <span className={solving ? "spinner" : ""}>
            {solving ? "" : "▶"}
          </span>
          {solving
            ? t("Ищем решение…", "Searching…")
            : t("Решить систему", "Solve system")}
          <kbd>Ctrl ↵</kbd>
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
