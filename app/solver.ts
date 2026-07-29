export type SolverPoint = {
  id: string;
  x: number;
  y: number;
};

export type SolverPointMap = Map<string, SolverPoint>;

export type CoordinateSearchResult = {
  points: SolverPoint[];
  errors: number[];
  residual: number;
  elapsed: number;
  iterations: number;
  timedOut: boolean;
};

export type SolverOptions = {
  maxIterations: number;
  timeLimitMs: number;
  restartCount?: number;
};

function rootMeanSquare(errors: number[]) {
  return Math.sqrt(
    errors.reduce((sum, error) => sum + error * error, 0) /
      Math.max(errors.length, 1),
  );
}

function solveLinearSystem(matrix: number[][], right: number[]) {
  const size = right.length;
  const augmented = matrix.map((row, index) => [
    ...row,
    right[index],
  ]);

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (
        Math.abs(augmented[row][column]) >
        Math.abs(augmented[pivot][column])
      ) {
        pivot = row;
      }
    }
    if (Math.abs(augmented[pivot][column]) < 1e-16) return null;
    [augmented[column], augmented[pivot]] = [
      augmented[pivot],
      augmented[column],
    ];

    const divisor = augmented[column][column];
    for (let item = column; item <= size; item += 1) {
      augmented[column][item] /= divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      if (Math.abs(factor) < 1e-20) continue;
      for (let item = column; item <= size; item += 1) {
        augmented[row][item] -= factor * augmented[column][item];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

/**
 * Finds one coordinate assignment with a small residual. Geometry-specific
 * parsing stays outside this module: callers only provide residual functions.
 */
export function solveCoordinates(
  currentPoints: SolverPoint[],
  tolerance: number,
  evaluateResiduals: (points: SolverPointMap) => number[],
  options: SolverOptions = {
    maxIterations: 1200,
    timeLimitMs: 2500,
  },
): CoordinateSearchResult {
  const startedAt = performance.now();
  const deadline =
    startedAt + Math.max(50, Math.min(options.timeLimitMs, 60_000));
  const maxIterations = Math.max(
    1,
    Math.min(Math.floor(options.maxIterations), 100_000),
  );
  const restartCount = Math.max(
    1,
    Math.min(Math.floor(options.restartCount ?? 6), 24),
  );
  const baseline = currentPoints.flatMap((point) => [point.x, point.y]);
  const ids = currentPoints.map((point) => point.id);
  let randomState = 7919;
  const random = () => {
    randomState = (randomState * 48271) % 2147483647;
    return randomState / 2147483647;
  };

  const unpack = (values: number[]): SolverPointMap =>
    new Map(
      ids.map((id, index) => [
        id,
        { id, x: values[index * 2], y: values[index * 2 + 1] },
      ]),
    );
  const errorsFor = (values: number[]) =>
    evaluateResiduals(unpack(values)).map((error) =>
      Number.isFinite(error) ? error : 1e6,
    );
  const scoreFor = (errors: number[]) =>
    errors.reduce((sum, error) => sum + error * error, 0) /
    Math.max(errors.length, 1);

  let best = [...baseline];
  let bestErrors = errorsFor(best);
  let bestScore = scoreFor(bestErrors);
  let iterations = 0;
  let timedOut = false;
  // The public tolerance decides whether a system is acceptable. Keep
  // polishing a valid solution beyond that threshold: derived values such as
  // an area can amplify a tiny coordinate error and otherwise expose several
  // noisy decimal places (for example 135.00005 instead of 135).
  const targetScore = Math.max(tolerance * 0.00001, 1e-14) ** 2;

  if (!baseline.length || bestScore <= tolerance ** 2) {
    return {
      points: currentPoints,
      errors: bestErrors.map(Math.abs),
      residual: rootMeanSquare(bestErrors),
      elapsed: performance.now() - startedAt,
      iterations,
      timedOut,
    };
  }

  const xs = currentPoints.map((point) => point.x);
  const ys = currentPoints.map((point) => point.y);
  const span = Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
    1,
  );
  const baselineIterationLimit = Math.max(
    12,
    Math.ceil(maxIterations * (restartCount === 1 ? 1 : 0.65)),
  );
  const restartIterationLimit = Math.max(
    12,
    Math.ceil(
      (maxIterations - baselineIterationLimit) /
        Math.max(restartCount - 1, 1),
    ),
  );

  outer: for (
    let restart = 0;
    restart < restartCount && iterations < maxIterations;
    restart += 1
  ) {
    const localIterationLimit =
      restart === 0 ? baselineIterationLimit : restartIterationLimit;
    let values =
      restart === 0
        ? [...baseline]
        : baseline.map(
            (value) =>
              value +
              (random() - 0.5) *
                span *
                Math.min(2.4, 0.45 + restart * 0.22),
          );
    let errors = errorsFor(values);
    let localScore = scoreFor(errors);
    let damping = restart === 0 ? 1e-3 : 1e-2;
    let rejectedSteps = 0;

    if (localScore < bestScore) {
      bestScore = localScore;
      best = [...values];
      bestErrors = [...errors];
    }

    for (
      let localIteration = 0;
      localIteration < localIterationLimit &&
      iterations < maxIterations;
      localIteration += 1
    ) {
      if (localScore <= targetScore) break outer;
      if (performance.now() >= deadline) {
        timedOut = true;
        break outer;
      }
      iterations += 1;

      const residualCount = Math.max(errors.length, 1);
      const dimension = values.length;
      const jacobian = Array.from(
        { length: residualCount },
        () => Array(dimension).fill(0) as number[],
      );

      for (let column = 0; column < dimension; column += 1) {
        if (performance.now() >= deadline) {
          timedOut = true;
          break outer;
        }
        const original = values[column];
        const differenceStep =
          1e-7 * Math.max(1, Math.abs(original));
        values[column] = original + differenceStep;
        const high = errorsFor(values);
        values[column] = original - differenceStep;
        const low = errorsFor(values);
        values[column] = original;
        for (let row = 0; row < residualCount; row += 1) {
          jacobian[row][column] =
            ((high[row] ?? 0) - (low[row] ?? 0)) /
            (2 * differenceStep);
        }
      }

      const normal = Array.from(
        { length: dimension },
        () => Array(dimension).fill(0) as number[],
      );
      const right = Array(dimension).fill(0) as number[];
      for (let row = 0; row < residualCount; row += 1) {
        for (let first = 0; first < dimension; first += 1) {
          right[first] -= jacobian[row][first] * (errors[row] ?? 0);
          for (let second = 0; second <= first; second += 1) {
            normal[first][second] +=
              jacobian[row][first] * jacobian[row][second];
          }
        }
      }
      for (let first = 0; first < dimension; first += 1) {
        for (let second = 0; second < first; second += 1) {
          normal[second][first] = normal[first][second];
        }
        normal[first][first] +=
          damping * Math.max(normal[first][first], 1e-6) + 1e-12;
      }

      const step = solveLinearSystem(normal, right);
      if (!step || step.some((value) => !Number.isFinite(value))) {
        damping *= 10;
        rejectedSteps += 1;
        if (rejectedSteps >= 8) break;
        continue;
      }
      const longestStep = Math.max(...step.map(Math.abs), 0);
      const stepScale =
        longestStep > span * 0.8 ? (span * 0.8) / longestStep : 1;
      const candidate = values.map(
        (value, index) => value + step[index] * stepScale,
      );
      const candidateErrors = errorsFor(candidate);
      const candidateScore = scoreFor(candidateErrors);

      if (candidateScore < localScore) {
        values = candidate;
        errors = candidateErrors;
        localScore = candidateScore;
        damping = Math.max(damping * 0.3, 1e-12);
        rejectedSteps = 0;
        if (candidateScore < bestScore) {
          bestScore = candidateScore;
          best = [...candidate];
          bestErrors = [...candidateErrors];
        }
      } else {
        damping = Math.min(damping * 10, 1e14);
        rejectedSteps += 1;
        if (rejectedSteps >= 10) break;
      }
    }
  }

  const solvedMap = unpack(best);
  const errors = bestErrors.map(Math.abs);
  return {
    points: ids.map((id) => solvedMap.get(id) as SolverPoint),
    errors,
    residual: rootMeanSquare(errors),
    elapsed: performance.now() - startedAt,
    iterations,
    timedOut,
  };
}
