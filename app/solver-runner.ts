import type {
  AngleUnit,
  ExpressionRow,
  Point,
  Shape,
  SolverMode,
  SolverProgress,
  SolveResult,
} from "./domain";
import { solveAnalytically } from "./analytic-solver";
import { solveNumerically } from "./expressions";

export type SolverRequest = {
  id: number;
  points: Point[];
  shapes: Shape[];
  known: ExpressionRow[];
  unknown: ExpressionRow[];
  mode: SolverMode;
  angleUnit: AngleUnit;
  tolerance: number;
  maxIterations: number;
  timeLimitMs: number;
};

export type SolverResponse = {
  points: Point[];
  result: SolveResult;
};

export function mergeSolvedPointCoordinates(
  current: Point[],
  solved: Point[],
) {
  const solvedMap = new Map(solved.map((point) => [point.id, point]));
  return current.map((point) => solvedMap.get(point.id) ?? point);
}

export function runSolverRequest(
  request: SolverRequest,
  onProgress?: (progress: SolverProgress) => void,
): SolverResponse {
  const startedAt = performance.now();
  if (request.mode === "analytic") {
    const solved = solveAnalytically(
      request.points,
      request.shapes,
      request.known,
      request.unknown,
      request.angleUnit,
      request.tolerance,
      request.maxIterations,
      request.timeLimitMs,
    );
    solved.result.elapsed = performance.now() - startedAt;
    solved.result.timedOut =
      solved.result.timedOut || solved.result.elapsed >= request.timeLimitMs;
    return solved;
  }

  // Exact rules are useful as target hints, but they share the same public
  // deadline with the coordinate search instead of receiving a second limit.
  const hintBudget = Math.max(
    1,
    Math.min(350, Math.floor(request.timeLimitMs * 0.15)),
  );
  onProgress?.({
    points: request.points,
    residual: Number.POSITIVE_INFINITY,
    elapsed: 0,
    iterations: 0,
    phase: "preparing",
  });
  const analyticHints = solveAnalytically(
    request.points,
    request.shapes,
    request.known,
    request.unknown,
    request.angleUnit,
    request.tolerance,
    Math.min(request.maxIterations, 300),
    hintBudget,
    false,
  );
  if (analyticHints.result.kind === "inconsistent") {
    analyticHints.result.elapsed = performance.now() - startedAt;
    return analyticHints;
  }
  const targetHints = Object.fromEntries(
    analyticHints.result.values
      .filter((value) => Number.isFinite(value.value))
      .map((value) => [value.label, value.value]),
  );
  const remainingMs = Math.max(
    1,
    request.timeLimitMs - (performance.now() - startedAt),
  );
  const solved = solveNumerically(
    request.points,
    request.shapes,
    request.known,
    request.unknown,
    request.tolerance,
    request.angleUnit,
    request.maxIterations,
    remainingMs,
    targetHints,
    (progress) =>
      onProgress?.({
        ...progress,
        elapsed: performance.now() - startedAt,
      }),
  );
  solved.result.elapsed = performance.now() - startedAt;
  solved.result.timedOut =
    solved.result.timedOut || solved.result.elapsed >= request.timeLimitMs;
  return solved;
}
