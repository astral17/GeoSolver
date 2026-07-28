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
};

/**
 * Finds one coordinate assignment with a small residual. Geometry-specific
 * parsing stays outside this module: callers only provide residual functions.
 */
export function solveCoordinates(
  currentPoints: SolverPoint[],
  tolerance: number,
  evaluateResiduals: (points: SolverPointMap) => number[],
): CoordinateSearchResult {
  const targetScore = tolerance ** 2;
  const startedAt = performance.now();
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
  const score = (values: number[]) => {
    const errors = evaluateResiduals(unpack(values));
    const constraintScore =
      errors.reduce((sum, error) => sum + error * error, 0) /
      Math.max(errors.length, 1);
    const tether =
      values.reduce((sum, value, index) => {
        const delta = value - baseline[index];
        return sum + delta * delta;
      }, 0) * 1e-9;
    return constraintScore + tether;
  };

  let best = [...baseline];
  let bestScore = score(best);
  const restartCount = bestScore < targetScore ? 1 : 7;
  for (let restart = 0; restart < restartCount; restart += 1) {
    let values = baseline.map((value) =>
      restart === 0 ? value : value + (random() - 0.5) * 6,
    );
    const firstMoment = values.map(() => 0);
    const secondMoment = values.map(() => 0);
    let localScore = score(values);
    if (localScore < bestScore) {
      bestScore = localScore;
      best = [...values];
    }

    for (let iteration = 1; iteration <= 260; iteration += 1) {
      if (localScore < targetScore) break;
      const finiteDifferenceStep = 0.0008;
      const gradient = values.map((_, index) => {
        const original = values[index];
        values[index] = original + finiteDifferenceStep;
        const high = score(values);
        values[index] = original - finiteDifferenceStep;
        const low = score(values);
        values[index] = original;
        return (high - low) / (2 * finiteDifferenceStep);
      });
      const learningRate = 0.085 * Math.max(0.2, 1 - iteration / 340);
      values = values.map((value, index) => {
        firstMoment[index] =
          0.9 * firstMoment[index] + 0.1 * gradient[index];
        secondMoment[index] =
          0.999 * secondMoment[index] + 0.001 * gradient[index] ** 2;
        const firstCorrected =
          firstMoment[index] / (1 - 0.9 ** iteration);
        const secondCorrected =
          secondMoment[index] / (1 - 0.999 ** iteration);
        return (
          value -
          (learningRate * firstCorrected) /
            (Math.sqrt(secondCorrected) + 1e-8)
        );
      });
      localScore = score(values);
      if (localScore < bestScore) {
        bestScore = localScore;
        best = [...values];
      }
    }
  }

  const solvedMap = unpack(best);
  const errors = evaluateResiduals(solvedMap).map(Math.abs);
  return {
    points: ids.map((id) => solvedMap.get(id) as SolverPoint),
    errors,
    residual: Math.sqrt(
      errors.reduce((sum, error) => sum + error ** 2, 0) /
        Math.max(errors.length, 1),
    ),
    elapsed: performance.now() - startedAt,
  };
}
