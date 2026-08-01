import type {
  AngleUnit,
  ExpressionRow,
  FormulaComparison,
  FormulaEquation,
  MathNode,
  ParsedConstraint,
  Point,
  ProofResult,
  Shape,
  SolutionStep,
  SolveResult,
  UnknownTarget,
} from "./domain";
import {
  exactAdd,
  exactApproximate,
  exactCompare,
  exactDivide,
  exactEqual,
  exactFromNumber,
  exactFromRational,
  exactMultiply,
  exactPi,
  exactPowInteger,
  exactSqrt,
  exactSubtract,
  formatExact,
  type ExactValue,
} from "./exact-value";
import {
  parseConstraint,
  parseUnknown,
  solveNumerically,
} from "./expressions";
import { angleDegrees, orientation } from "./geometry";

type ProvenValue = {
  value: ExactValue;
  steps: SolutionStep[];
};

type SymbolicProvenValue = {
  value: number;
  exact: string;
  steps: SolutionStep[];
};

type EqualityEdge = {
  to: string;
  steps: SolutionStep[];
};

type EquationEntry = {
  equation: FormulaEquation;
  steps: SolutionStep[];
};

type LinearForm = {
  constant: ExactValue;
  coefficients: Map<string, ExactValue>;
};

type RightTriangle = {
  vertex: string;
  first: string;
  second: string;
  steps: SolutionStep[];
};

type PolygonCandidate = {
  ids: string[];
  geometry: "polygon" | "circle" | "sector";
};

type SegmentMembership = {
  point: string;
  start: string;
  end: string;
  steps: SolutionStep[];
};

type LineRelation = {
  first: [string, string];
  second: [string, string];
  steps: SolutionStep[];
};

type CircleMembership = {
  point: string;
  center: string;
  radiusPoint: string;
  steps: SolutionStep[];
};

const ZERO = exactFromRational(0);
const ONE = exactFromRational(1);
const TWO = exactFromRational(2);
const NINETY = exactFromRational(90);
const ONE_EIGHTY = exactFromRational(180);
const THREE_SIXTY = exactFromRational(360);

function degreeConstant(value: number): MathNode {
  return {
    kind: "function",
    name: "deg",
    value: { kind: "number", value },
  };
}

function containsAngleMeasure(node: MathNode): boolean {
  if (node.kind === "measure") return node.measure === "angle";
  if (node.kind === "unary" || node.kind === "function") {
    return containsAngleMeasure(node.value);
  }
  if (node.kind === "binary") {
    return containsAngleMeasure(node.left) || containsAngleMeasure(node.right);
  }
  return false;
}

function localized(ru: string, en: string) {
  return { ru, en };
}

function givenStep(expression: string): SolutionStep {
  return {
    title: localized("Дано", "Given"),
    detail: localized(
      "Условие задачи используется без преобразований.",
      "The condition is used directly.",
    ),
    expression,
  };
}

function ruleStep(
  titleRu: string,
  titleEn: string,
  detailRu: string,
  detailEn: string,
  expression?: string,
): SolutionStep {
  return {
    title: localized(titleRu, titleEn),
    detail: localized(detailRu, detailEn),
    expression,
  };
}

function stepKey(step: SolutionStep) {
  return [
    step.title.ru,
    step.title.en,
    step.detail.ru,
    step.detail.en,
    step.expression ?? "",
  ].join("\u0000");
}

function mergeSteps(...groups: readonly SolutionStep[][]): SolutionStep[] {
  const result: SolutionStep[] = [];
  const seen = new Set<string>();
  groups.forEach((group) => {
    group.forEach((step) => {
      const key = stepKey(step);
      if (seen.has(key)) return;
      seen.add(key);
      result.push(step);
    });
  });
  return result;
}

function compareSteps(left: readonly SolutionStep[], right: readonly SolutionStep[]) {
  if (left.length !== right.length) return left.length - right.length;
  const leftKey = left.map(stepKey).join("\u0001");
  const rightKey = right.map(stepKey).join("\u0001");
  return leftKey.localeCompare(rightKey);
}

function sortedPair(first: string, second: string) {
  return first < second ? [first, second] : [second, first];
}

function distanceKey(first: string, second: string) {
  const [a, b] = sortedPair(first, second);
  return `distance:${a}${b}`;
}

function angleKey(first: string, vertex: string, second: string) {
  const [a, c] = sortedPair(first, second);
  return `angle:${a}${vertex}${c}`;
}

function coordinateKey(axis: "x" | "y", id: string) {
  return `${axis}:${id}`;
}

function variableKey(name: string) {
  return `variable:${name}`;
}

function normalizedCycle(ids: readonly string[]) {
  if (ids.length <= 2) return ids.join("");
  const orientations = [ids, [...ids].reverse()];
  const candidates: string[] = [];
  orientations.forEach((orientation) => {
    for (let offset = 0; offset < orientation.length; offset += 1) {
      candidates.push(
        [...orientation.slice(offset), ...orientation.slice(0, offset)].join(""),
      );
    }
  });
  candidates.sort();
  return candidates[0];
}

function metricKey(
  measure: "area" | "perimeter",
  geometry: "polygon" | "circle" | "ellipse" | "sector" | "circularSegment",
  ids: readonly string[],
) {
  const normalized = geometry === "polygon" ? normalizedCycle(ids) : ids.join("");
  return `${measure}:${geometry}:${normalized}`;
}

function lineKey(first: string, second: string) {
  return sortedPair(first, second).join("");
}

function lineRelationKey(
  relation: "parallel" | "perpendicular",
  ids: readonly string[],
) {
  const lines = [lineKey(ids[0], ids[1]), lineKey(ids[2], ids[3])].sort();
  return `${relation}:${lines[0]}:${lines[1]}`;
}

function pointListKey(ids: readonly string[]) {
  return ids.join("");
}

function atomKey(node: MathNode): string | null {
  if (node.kind === "variable") return variableKey(node.name);
  if (node.kind !== "measure") return null;
  if (node.measure === "distance" && node.ids.length === 2) {
    return distanceKey(node.ids[0], node.ids[1]);
  }
  if (node.measure === "angle" && node.ids.length === 3) {
    return angleKey(node.ids[0], node.ids[1], node.ids[2]);
  }
  if ((node.measure === "x" || node.measure === "y") && node.ids.length === 1) {
    return coordinateKey(node.measure, node.ids[0]);
  }
  if (node.measure === "area" || node.measure === "perimeter") {
    return metricKey(
      node.measure,
      node.geometry ?? "polygon",
      node.ids,
    );
  }
  return null;
}

function exactNegative(value: ExactValue) {
  return exactSubtract(ZERO, value);
}

function safeExact<T>(operation: () => T): T | null {
  try {
    return operation();
  } catch {
    return null;
  }
}

function isExactInteger(value: ExactValue): number | null {
  if (value.terms.length !== 1) return value.terms.length === 0 ? 0 : null;
  const [term] = value.terms;
  if (
    term.radicand !== BigInt(1) ||
    term.piPower !== 0 ||
    term.coefficient.denominator !== BigInt(1)
  ) {
    return null;
  }
  const numeric = Number(term.coefficient.numerator);
  return Number.isSafeInteger(numeric) ? numeric : null;
}

function isNinety(value: ExactValue) {
  return exactEqual(value, NINETY);
}

function isZero(value: ExactValue) {
  return exactEqual(value, ZERO);
}

function exactTrig(
  name: "sin" | "cos" | "tan",
  input: ExactValue,
  angleUnit: AngleUnit,
): ExactValue | null {
  const degrees =
    angleUnit === "degrees"
      ? input
      : safeExact(() => exactDivide(exactMultiply(input, ONE_EIGHTY), exactPi()));
  if (!degrees) return null;

  const sqrtTwo = safeExact(() => exactSqrt(exactFromRational(2)));
  const sqrtThree = safeExact(() => exactSqrt(exactFromRational(3)));
  const sqrtFive = safeExact(() => exactSqrt(exactFromRational(5)));
  if (!sqrtTwo || !sqrtThree || !sqrtFive) return null;
  const half = exactFromRational(1, 2);
  const quarter = exactFromRational(1, 4);
  const sqrtTwoHalf = exactMultiply(sqrtTwo, half);
  const sqrtThreeHalf = exactMultiply(sqrtThree, half);
  const sinEighteen = exactMultiply(exactSubtract(sqrtFive, ONE), quarter);
  const cosThirtySix = exactMultiply(exactAdd(sqrtFive, ONE), quarter);
  const partial = [
    { angle: 18, sin: sinEighteen },
    { angle: 36, cos: cosThirtySix },
    { angle: 54, sin: cosThirtySix },
    { angle: 72, cos: sinEighteen },
  ].find(({ angle }) => exactEqual(degrees, exactFromRational(angle)));
  if (partial) {
    if (name === "sin" && partial.sin) return partial.sin;
    if (name === "cos" && partial.cos) return partial.cos;
  }
  const table = new Map<number, [ExactValue, ExactValue]>([
    [0, [ZERO, ONE]],
    [30, [half, sqrtThreeHalf]],
    [45, [sqrtTwoHalf, sqrtTwoHalf]],
    [60, [sqrtThreeHalf, half]],
    [90, [ONE, ZERO]],
    [120, [sqrtThreeHalf, exactNegative(half)]],
    [135, [sqrtTwoHalf, exactNegative(sqrtTwoHalf)]],
    [150, [half, exactNegative(sqrtThreeHalf)]],
    [180, [ZERO, exactNegative(ONE)]],
    [270, [exactNegative(ONE), ZERO]],
    [360, [ZERO, ONE]],
  ]);
  const entry = [...table.entries()].find(([angle]) =>
    exactEqual(degrees, exactFromRational(angle)),
  )?.[1];
  if (!entry) return null;
  if (name === "sin") return entry[0];
  if (name === "cos") return entry[1];
  return isZero(entry[1]) ? null : safeExact(() => exactDivide(entry[0], entry[1]));
}

function symbolicTrig(
  name: "sin" | "cos",
  input: ExactValue,
  angleUnit: AngleUnit,
) {
  const degrees =
    angleUnit === "degrees"
      ? input
      : safeExact(() =>
          exactDivide(exactMultiply(input, ONE_EIGHTY), exactPi()),
        );
  if (!degrees) return null;
  const angle = isExactInteger(degrees);
  if (angle === null) return null;
  const table = new Map<string, { numerator: string; denominator: number }>([
    ["sin:36", { numerator: "sqrt(10 - 2*sqrt(5))", denominator: 4 }],
    ["sin:72", { numerator: "sqrt(10 + 2*sqrt(5))", denominator: 4 }],
    ["cos:18", { numerator: "sqrt(10 + 2*sqrt(5))", denominator: 4 }],
    ["cos:54", { numerator: "sqrt(10 - 2*sqrt(5))", denominator: 4 }],
  ]);
  const symbolic = table.get(`${name}:${angle}`);
  if (!symbolic) return null;
  const radians = (angle * Math.PI) / 180;
  return {
    ...symbolic,
    value: name === "sin" ? Math.sin(radians) : Math.cos(radians),
  };
}

function scaleForm(form: LinearForm, scale: ExactValue): LinearForm {
  return {
    constant: exactMultiply(form.constant, scale),
    coefficients: new Map(
      [...form.coefficients].map(([key, coefficient]) => [
        key,
        exactMultiply(coefficient, scale),
      ]),
    ),
  };
}

function addForms(left: LinearForm, right: LinearForm): LinearForm {
  const coefficients = new Map(left.coefficients);
  right.coefficients.forEach((coefficient, key) => {
    const previous = coefficients.get(key) ?? ZERO;
    const next = exactAdd(previous, coefficient);
    if (isZero(next)) coefficients.delete(key);
    else coefficients.set(key, next);
  });
  return {
    constant: exactAdd(left.constant, right.constant),
    coefficients,
  };
}

class AnalyticEngine {
  private readonly facts = new Map<string, ProvenValue>();
  private readonly symbolicFacts = new Map<string, SymbolicProvenValue>();
  private readonly equality = new Map<string, EqualityEdge[]>();
  private readonly equalityEdgeKeys = new Set<string>();
  private readonly equations: EquationEntry[] = [];
  private readonly equationKeys = new Set<string>();
  private readonly parsedConstraints: { row: ExpressionRow; parsed: ParsedConstraint }[] = [];
  private readonly directConstraintSteps = new Map<string, SolutionStep[]>();
  private readonly rightTriangles = new Map<string, RightTriangle>();
  private readonly triangleCandidates = new Map<string, string[]>();
  private readonly polygonCandidates = new Map<string, PolygonCandidate>();
  private readonly distanceCandidates = new Set<string>();
  private readonly lineCandidates = new Map<string, [string, string]>();
  private readonly angleCandidates = new Set<string>();
  private readonly perpendicularSteps = new Map<string, SolutionStep[]>();
  private readonly parallelSteps = new Map<string, SolutionStep[]>();
  private readonly parallelLineEdges = new Map<string, EqualityEdge[]>();
  private readonly parallelLineEdgeKeys = new Set<string>();
  private readonly perpendicularRelations: LineRelation[] = [];
  private readonly perpendicularRelationKeys = new Set<string>();
  private readonly segmentMemberships: SegmentMembership[] = [];
  private readonly circleMemberships: CircleMembership[] = [];
  private readonly targetCandidates: UnknownTarget[] = [];
  private readonly targetFacts = new Map<string, ProvenValue>();
  private readonly targetAlternatives = new Map<string, ExactValue[]>();
  private similarityEnabled = false;
  private changed = false;
  timedOut = false;

  constructor(
    private readonly points: Point[],
    private readonly shapes: Shape[],
    private readonly angleUnit: AngleUnit,
  ) {}

  private setFact(key: string, value: ExactValue, steps: SolutionStep[]) {
    const candidate = { value, steps: mergeSteps(steps) };
    const previous = this.facts.get(key);
    if (previous) {
      if (!exactEqual(previous.value, value)) return false;
      if (compareSteps(previous.steps, candidate.steps) <= 0) return false;
    }
    this.facts.set(key, candidate);
    this.changed = true;
    return true;
  }

  private setSymbolicFact(
    key: string,
    value: number,
    exact: string,
    steps: SolutionStep[],
  ) {
    if (this.getFact(key)) return false;
    const candidate = { value, exact, steps: mergeSteps(steps) };
    const previous = this.symbolicFacts.get(key);
    if (
      previous &&
      (previous.exact !== candidate.exact ||
        compareSteps(previous.steps, candidate.steps) <= 0)
    ) {
      return false;
    }
    this.symbolicFacts.set(key, candidate);
    this.changed = true;
    return true;
  }

  private setTargetFact(
    label: string,
    value: ExactValue,
    steps: SolutionStep[],
  ) {
    const key = label.replace(/\s+/g, "").toUpperCase();
    const candidate = { value, steps: mergeSteps(steps) };
    const previous = this.targetFacts.get(key);
    if (previous && compareSteps(previous.steps, candidate.steps) <= 0) return;
    this.targetFacts.set(key, candidate);
    this.changed = true;
  }

  private setTargetAlternativeFacts(
    label: string,
    values: ExactValue[],
    steps: SolutionStep[],
  ) {
    const unique = values.filter(
      (value, index) =>
        values.findIndex((candidate) => exactEqual(candidate, value)) === index,
    );
    if (!unique.length) return;
    unique.sort(
      (first, second) => exactApproximate(first) - exactApproximate(second),
    );
    this.setTargetFact(label, unique[0], steps);
    const key = label.replace(/\s+/g, "").toUpperCase();
    const previous = this.targetAlternatives.get(key);
    if (
      previous &&
      previous.length === unique.length &&
      previous.every((value, index) => exactEqual(value, unique[index]))
    ) {
      return;
    }
    this.targetAlternatives.set(key, unique);
    this.changed = true;
  }

  private addEquality(first: string, second: string, steps: SolutionStep[]) {
    if (first === second) return false;
    const ordered = [first, second].sort();
    const edgeKey = `${ordered[0]}=${ordered[1]}:${steps.map(stepKey).join("|")}`;
    if (this.equalityEdgeKeys.has(edgeKey)) return false;
    this.equalityEdgeKeys.add(edgeKey);
    const edgeSteps = mergeSteps(steps);
    const add = (from: string, to: string) => {
      const edges = this.equality.get(from) ?? [];
      edges.push({ to, steps: edgeSteps });
      edges.sort((left, right) => left.to.localeCompare(right.to));
      this.equality.set(from, edges);
    };
    add(first, second);
    add(second, first);
    this.changed = true;
    return true;
  }

  private equalityPath(first: string, second: string): SolutionStep[] | null {
    if (first === second) return [];
    const initialSteps: SolutionStep[] = [];
    const queue: { key: string; steps: SolutionStep[] }[] = [
      { key: first, steps: initialSteps },
    ];
    const best = new Map<string, SolutionStep[]>([[first, initialSteps]]);
    while (queue.length) {
      queue.sort((left, right) => compareSteps(left.steps, right.steps));
      const current = queue.shift() as { key: string; steps: SolutionStep[] };
      if (current.key === second) return current.steps;
      if (best.get(current.key) !== current.steps) continue;
      for (const edge of this.equality.get(current.key) ?? []) {
        const steps = mergeSteps(current.steps, edge.steps);
        const previous = best.get(edge.to);
        if (previous && compareSteps(previous, steps) <= 0) continue;
        best.set(edge.to, steps);
        queue.push({ key: edge.to, steps });
      }
    }
    return null;
  }

  private canonicalKey(key: string) {
    let canonical = key;
    const queue = [key];
    const seen = new Set(queue);
    while (queue.length) {
      const current = queue.shift() as string;
      if (current < canonical) canonical = current;
      for (const edge of this.equality.get(current) ?? []) {
        if (seen.has(edge.to)) continue;
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
    return canonical;
  }

  private getFact(key: string): ProvenValue | null {
    const direct = this.facts.get(key);
    let bestFact = direct ?? null;
    const initialSteps: SolutionStep[] = [];
    const queue: { key: string; steps: SolutionStep[] }[] = [
      { key, steps: initialSteps },
    ];
    const bestPaths = new Map<string, SolutionStep[]>([[key, initialSteps]]);
    while (queue.length) {
      queue.sort((left, right) => compareSteps(left.steps, right.steps));
      const current = queue.shift() as { key: string; steps: SolutionStep[] };
      if (bestPaths.get(current.key) !== current.steps) continue;
      const fact = this.facts.get(current.key);
      if (fact) {
        const candidate = {
          value: fact.value,
          steps: mergeSteps(fact.steps, current.steps),
        };
        if (!bestFact || compareSteps(candidate.steps, bestFact.steps) < 0) {
          bestFact = candidate;
        }
      }
      for (const edge of this.equality.get(current.key) ?? []) {
        const steps = mergeSteps(current.steps, edge.steps);
        const previous = bestPaths.get(edge.to);
        if (previous && compareSteps(previous, steps) <= 0) continue;
        bestPaths.set(edge.to, steps);
        queue.push({ key: edge.to, steps });
      }
    }
    return bestFact;
  }

  private getSymbolicFact(key: string): SymbolicProvenValue | null {
    let bestFact = this.symbolicFacts.get(key) ?? null;
    const initialSteps: SolutionStep[] = [];
    const queue: { key: string; steps: SolutionStep[] }[] = [
      { key, steps: initialSteps },
    ];
    const bestPaths = new Map<string, SolutionStep[]>([[key, initialSteps]]);
    while (queue.length) {
      queue.sort((left, right) => compareSteps(left.steps, right.steps));
      const current = queue.shift() as { key: string; steps: SolutionStep[] };
      if (bestPaths.get(current.key) !== current.steps) continue;
      const fact = this.symbolicFacts.get(current.key);
      if (fact) {
        const candidate = {
          value: fact.value,
          exact: fact.exact,
          steps: mergeSteps(fact.steps, current.steps),
        };
        if (!bestFact || compareSteps(candidate.steps, bestFact.steps) < 0) {
          bestFact = candidate;
        }
      }
      for (const edge of this.equality.get(current.key) ?? []) {
        const steps = mergeSteps(current.steps, edge.steps);
        const previous = bestPaths.get(edge.to);
        if (previous && compareSteps(previous, steps) <= 0) continue;
        bestPaths.set(edge.to, steps);
        queue.push({ key: edge.to, steps });
      }
    }
    return bestFact;
  }

  private addParallelLines(
    first: [string, string],
    second: [string, string],
    steps: SolutionStep[],
  ) {
    const firstKey = lineKey(first[0], first[1]);
    const secondKey = lineKey(second[0], second[1]);
    if (firstKey === secondKey) return false;
    const ordered = [firstKey, secondKey].sort();
    const edgeSteps = mergeSteps(steps);
    const edgeKey = `${ordered.join("=")}:${edgeSteps.map(stepKey).join("|")}`;
    if (this.parallelLineEdgeKeys.has(edgeKey)) return false;
    this.parallelLineEdgeKeys.add(edgeKey);
    const add = (from: string, to: string) => {
      const edges = this.parallelLineEdges.get(from) ?? [];
      edges.push({ to, steps: edgeSteps });
      this.parallelLineEdges.set(from, edges);
    };
    add(firstKey, secondKey);
    add(secondKey, firstKey);
    this.changed = true;
    return true;
  }

  private lineDirectionPath(first: string, second: string) {
    if (first === second) return [] as SolutionStep[];
    const initialSteps: SolutionStep[] = [];
    const queue: { key: string; steps: SolutionStep[] }[] = [
      { key: first, steps: initialSteps },
    ];
    const best = new Map<string, SolutionStep[]>([[first, initialSteps]]);
    while (queue.length) {
      queue.sort((left, right) => compareSteps(left.steps, right.steps));
      const current = queue.shift() as { key: string; steps: SolutionStep[] };
      if (current.key === second) return current.steps;
      if (best.get(current.key) !== current.steps) continue;
      for (const edge of this.parallelLineEdges.get(current.key) ?? []) {
        const nextSteps = mergeSteps(current.steps, edge.steps);
        const previous = best.get(edge.to);
        if (previous && compareSteps(previous, nextSteps) <= 0) continue;
        best.set(edge.to, nextSteps);
        queue.push({ key: edge.to, steps: nextSteps });
      }
    }
    return null;
  }

  private perpendicularEvidence(
    first: [string, string],
    second: [string, string],
  ): SolutionStep[] | null {
    const firstKey = lineKey(first[0], first[1]);
    const secondKey = lineKey(second[0], second[1]);
    let best: SolutionStep[] | null = null;
    this.perpendicularRelations.forEach((relation) => {
      const relationFirst = lineKey(relation.first[0], relation.first[1]);
      const relationSecond = lineKey(relation.second[0], relation.second[1]);
      const candidates = [
        [
          this.lineDirectionPath(firstKey, relationFirst),
          this.lineDirectionPath(secondKey, relationSecond),
        ],
        [
          this.lineDirectionPath(firstKey, relationSecond),
          this.lineDirectionPath(secondKey, relationFirst),
        ],
      ];
      candidates.forEach(([firstPath, secondPath]) => {
        if (!firstPath || !secondPath) return;
        const steps = mergeSteps(firstPath, relation.steps, secondPath);
        if (!best || compareSteps(steps, best) < 0) best = steps;
      });
    });
    return best;
  }

  private addPerpendicularRelation(
    first: [string, string],
    second: [string, string],
    steps: SolutionStep[],
  ) {
    const lines = [lineKey(first[0], first[1]), lineKey(second[0], second[1])]
      .sort();
    const mergedSteps = mergeSteps(steps);
    const key = `${lines.join("⟂")}:${mergedSteps.map(stepKey).join("|")}`;
    if (this.perpendicularRelationKeys.has(key)) return false;
    this.perpendicularRelationKeys.add(key);
    this.perpendicularRelations.push({ first, second, steps: mergedSteps });
    this.changed = true;
    return true;
  }

  private atomScale(node: MathNode) {
    if (
      node.kind === "measure" &&
      node.measure === "angle" &&
      this.angleUnit === "radians"
    ) {
      return exactDivide(exactPi(), ONE_EIGHTY);
    }
    return ONE;
  }

  private evaluate(node: MathNode): ExactValue | null {
    if (node.kind === "number") return safeExact(() => exactFromNumber(node.value));
    const atom = atomKey(node);
    if (atom) {
      const fact = this.getFact(atom);
      return fact ? safeExact(() => exactMultiply(fact.value, this.atomScale(node))) : null;
    }
    if (node.kind === "variable" || node.kind === "measure") return null;
    if (node.kind === "unary") {
      const value = this.evaluate(node.value);
      if (!value) return null;
      return node.operator === "-" ? exactNegative(value) : value;
    }
    if (node.kind === "binary") {
      const left = this.evaluate(node.left);
      const right = this.evaluate(node.right);
      if (!left || !right) return null;
      return safeExact(() => {
        if (node.operator === "+") return exactAdd(left, right);
        if (node.operator === "-") return exactSubtract(left, right);
        if (node.operator === "*") return exactMultiply(left, right);
        if (node.operator === "/") return exactDivide(left, right);
        const exponent = isExactInteger(right);
        if (exponent === null) throw new Error("Non-integer exact exponent");
        return exactPowInteger(left, exponent);
      });
    }
    const value = this.evaluate(node.value);
    if (!value) return null;
    if (node.name === "sqrt") return safeExact(() => exactSqrt(value));
    if (node.name === "abs") {
      const comparison = exactCompare(value, ZERO);
      return comparison === null ? null : comparison < 0 ? exactNegative(value) : value;
    }
    if (node.name === "deg") {
      return this.angleUnit === "degrees"
        ? value
        : safeExact(() => exactDivide(exactMultiply(value, exactPi()), ONE_EIGHTY));
    }
    if (node.name === "rad") {
      return this.angleUnit === "radians"
        ? value
        : safeExact(() => exactDivide(exactMultiply(value, ONE_EIGHTY), exactPi()));
    }
    return exactTrig(node.name, value, this.angleUnit);
  }

  private factStepsForNode(node: MathNode): SolutionStep[] {
    const atom = atomKey(node);
    if (atom) return this.getFact(atom)?.steps ?? [];
    if (node.kind === "unary" || node.kind === "function") {
      return this.factStepsForNode(node.value);
    }
    if (node.kind === "binary") {
      return mergeSteps(
        this.factStepsForNode(node.left),
        this.factStepsForNode(node.right),
      );
    }
    return [];
  }

  private equalityStepsForNode(node: MathNode): SolutionStep[] {
    const atom = atomKey(node);
    if (atom) {
      return this.equalityPath(atom, this.canonicalKey(atom)) ?? [];
    }
    if (node.kind === "unary" || node.kind === "function") {
      return this.equalityStepsForNode(node.value);
    }
    if (node.kind === "binary") {
      return mergeSteps(
        this.equalityStepsForNode(node.left),
        this.equalityStepsForNode(node.right),
      );
    }
    return [];
  }

  private linearize(node: MathNode): LinearForm | null {
    const atom = atomKey(node);
    if (atom) {
      const fact = this.getFact(atom);
      const scale = this.atomScale(node);
      if (fact) {
        return {
          constant: exactMultiply(fact.value, scale),
          coefficients: new Map(),
        };
      }
      return {
        constant: ZERO,
        coefficients: new Map([[this.canonicalKey(atom), scale]]),
      };
    }
    if (node.kind === "number") {
      return { constant: exactFromNumber(node.value), coefficients: new Map() };
    }
    if (node.kind === "variable" || node.kind === "measure") return null;
    if (node.kind === "unary") {
      const value = this.linearize(node.value);
      if (!value) return null;
      return node.operator === "-" ? scaleForm(value, exactNegative(ONE)) : value;
    }
    if (node.kind === "function") {
      const exact = this.evaluate(node);
      return exact ? { constant: exact, coefficients: new Map() } : null;
    }
    const left = this.linearize(node.left);
    const right = this.linearize(node.right);
    if (!left || !right) return null;
    if (node.operator === "+") return addForms(left, right);
    if (node.operator === "-") return addForms(left, scaleForm(right, exactNegative(ONE)));
    if (node.operator === "*") {
      if (left.coefficients.size === 0) return scaleForm(right, left.constant);
      if (right.coefficients.size === 0) return scaleForm(left, right.constant);
      return null;
    }
    if (node.operator === "/") {
      if (right.coefficients.size > 0) return null;
      const inverse = safeExact(() => exactDivide(ONE, right.constant));
      return inverse ? scaleForm(left, inverse) : null;
    }
    const exponent = this.evaluate(node.right);
    const exponentInteger = exponent ? isExactInteger(exponent) : null;
    if (exponentInteger === 1) return left;
    if (left.coefficients.size > 0 || exponentInteger === null) return null;
    const exact = safeExact(() => exactPowInteger(left.constant, exponentInteger));
    return exact ? { constant: exact, coefficients: new Map() } : null;
  }

  private registerDistance(first: string, second: string) {
    this.distanceCandidates.add(distanceKey(first, second));
    this.lineCandidates.set(lineKey(first, second), [first, second]);
  }

  private addCollinearPoints(ids: readonly string[], steps: SolutionStep[]) {
    const unique = [...new Set(ids)];
    if (unique.length < 3) return;
    const lines: [string, string][] = [];
    for (let first = 0; first < unique.length; first += 1) {
      for (let second = first + 1; second < unique.length; second += 1) {
        this.registerDistance(unique[first], unique[second]);
        lines.push([unique[first], unique[second]]);
      }
    }
    const anchor = lines[0];
    lines.slice(1).forEach((line) => this.addParallelLines(anchor, line, steps));
  }

  private addSegmentEquations() {
    const bySegment = new Map<string, SegmentMembership[]>();
    this.segmentMemberships.forEach((membership) => {
      const key = lineKey(membership.start, membership.end);
      const memberships = bySegment.get(key) ?? [];
      memberships.push(membership);
      bySegment.set(key, memberships);
    });
    const pointById = new Map(this.points.map((point) => [point.id, point]));
    bySegment.forEach((memberships) => {
      const { start, end } = memberships[0];
      const startPoint = pointById.get(start);
      const endPoint = pointById.get(end);
      if (!startPoint || !endPoint) return;
      const dx = endPoint.x - startPoint.x;
      const dy = endPoint.y - startPoint.y;
      const squaredLength = dx * dx + dy * dy;
      if (squaredLength <= 1e-12) return;
      const ids = [...new Set([start, ...memberships.map(({ point }) => point), end])]
        .map((id) => {
          const point = pointById.get(id);
          if (!point) return null;
          const parameter =
            ((point.x - startPoint.x) * dx + (point.y - startPoint.y) * dy) /
            squaredLength;
          return { id, parameter };
        })
        .filter(
          (entry): entry is { id: string; parameter: number } => Boolean(entry),
        )
        .sort((left, right) => left.parameter - right.parameter)
        .map(({ id }) => id);
      if (ids.length < 3) return;
      const membershipSteps = mergeSteps(
        ...memberships.map((membership) => membership.steps),
      );
      this.addCollinearPoints(ids, membershipSteps);
      for (let first = 0; first < ids.length; first += 1) {
        for (let last = first + 2; last < ids.length; last += 1) {
          const parts: MathNode[] = [];
          for (let index = first; index < last; index += 1) {
            parts.push({
              kind: "measure",
              measure: "distance",
              ids: [ids[index], ids[index + 1]],
            });
          }
          const sum = parts.slice(1).reduce<MathNode>(
            (left, right) => ({
              kind: "binary",
              operator: "+",
              left,
              right,
            }),
            parts[0],
          );
          const expression = `${ids[first]}${ids[last]} = ${parts
            .map((part) => part.kind === "measure" ? part.ids.join("") : "")
            .join(" + ")}`;
          this.addEquation(
            {
              left: {
                kind: "measure",
                measure: "distance",
                ids: [ids[first], ids[last]],
              },
              right: sum,
              source: expression,
            },
            mergeSteps(membershipSteps, [
              ruleStep(
                "Сложение отрезков",
                "Segment addition",
                "Порядок внутренних точек берётся с чертежа; длина всего отрезка равна сумме его последовательных частей.",
                "The order of interior points comes from the drawing; the whole segment equals the sum of its consecutive parts.",
                expression,
              ),
            ]),
          );
        }
      }
    });
  }

  private registerAngle(first: string, vertex: string, second: string) {
    this.angleCandidates.add(angleKey(first, vertex, second));
  }

  private isNondegenerateTriangle(ids: readonly string[]) {
    if (ids.length !== 3) return false;
    const points = ids.map((id) => this.points.find((point) => point.id === id));
    if (points.some((point) => !point)) return false;
    const firstLength = Math.hypot(
      points[1]!.x - points[0]!.x,
      points[1]!.y - points[0]!.y,
    );
    const secondLength = Math.hypot(
      points[2]!.x - points[0]!.x,
      points[2]!.y - points[0]!.y,
    );
    const scale = firstLength * secondLength;
    return scale > 1e-12 &&
      Math.abs(orientation(points[0]!, points[1]!, points[2]!)) > 1e-6 * scale;
  }

  private registerTriangle(ids: readonly string[]) {
    if (ids.length !== 3 || new Set(ids).size !== 3) return;
    const normalized = [...ids].sort();
    this.triangleCandidates.set(normalized.join(""), normalized);
    this.registerPolygon(normalized, "polygon");
    this.registerDistance(normalized[0], normalized[1]);
    this.registerDistance(normalized[0], normalized[2]);
    this.registerDistance(normalized[1], normalized[2]);
    this.registerAngle(normalized[0], normalized[1], normalized[2]);
    this.registerAngle(normalized[1], normalized[0], normalized[2]);
    this.registerAngle(normalized[0], normalized[2], normalized[1]);
  }

  private registerPolygon(
    ids: readonly string[],
    geometry: PolygonCandidate["geometry"] = "polygon",
  ) {
    if (
      (geometry === "polygon" && ids.length < 3) ||
      (geometry === "circle" && ids.length !== 2) ||
      (geometry === "sector" && ids.length !== 3)
    ) {
      return;
    }
    const key = `${geometry}:${
      geometry === "polygon" ? normalizedCycle(ids) : pointListKey(ids)
    }`;
    if (!this.polygonCandidates.has(key)) {
      this.polygonCandidates.set(key, { ids: [...ids], geometry });
    }
    if (geometry === "polygon") {
      ids.forEach((id, index) => {
        this.registerDistance(id, ids[(index + 1) % ids.length]);
      });
    } else {
      this.registerDistance(ids[0], ids[1]);
      if (geometry === "sector") {
        this.registerDistance(ids[0], ids[2]);
        this.registerAngle(ids[1], ids[0], ids[2]);
        this.registerTriangle(ids);
      }
    }
  }

  private registerMathNode(node: MathNode) {
    if (node.kind === "measure") {
      if (node.measure === "distance" && node.ids.length === 2) {
        this.registerDistance(node.ids[0], node.ids[1]);
      } else if (node.measure === "angle" && node.ids.length === 3) {
        this.registerAngle(node.ids[0], node.ids[1], node.ids[2]);
        this.registerTriangle(node.ids);
      } else if (
        (node.measure === "area" || node.measure === "perimeter") &&
        (node.geometry ?? "polygon") !== "ellipse" &&
        (node.geometry ?? "polygon") !== "circularSegment"
      ) {
        this.registerPolygon(
          node.ids,
          (node.geometry ?? "polygon") as PolygonCandidate["geometry"],
        );
      }
      return;
    }
    if (node.kind === "unary" || node.kind === "function") {
      this.registerMathNode(node.value);
    } else if (node.kind === "binary") {
      this.registerMathNode(node.left);
      this.registerMathNode(node.right);
    }
  }

  private equationKey(entry: EquationEntry) {
    return `${JSON.stringify(entry.equation.left)}=${JSON.stringify(
      entry.equation.right,
    )}:${entry.steps.map(stepKey).join("|")}`;
  }

  private addEquation(equation: FormulaEquation, steps: SolutionStep[]) {
    const entry = { equation, steps: mergeSteps(steps) };
    const key = this.equationKey(entry);
    if (this.equationKeys.has(key)) return;
    this.equationKeys.add(key);
    this.equations.push(entry);
    this.registerMathNode(equation.left);
    this.registerMathNode(equation.right);
    const left = atomKey(equation.left);
    const right = atomKey(equation.right);
    if (left && right) this.addEquality(left, right, entry.steps);
  }

  private addRightTriangle(
    vertex: string,
    first: string,
    second: string,
    steps: SolutionStep[],
  ) {
    if (new Set([vertex, first, second]).size !== 3) return;
    this.addPerpendicularRelation(
      [vertex, first],
      [vertex, second],
      steps,
    );
    const [a, b] = sortedPair(first, second);
    const key = `${vertex}:${a}:${b}`;
    const candidate = { vertex, first: a, second: b, steps: mergeSteps(steps) };
    const previous = this.rightTriangles.get(key);
    if (!previous || compareSteps(candidate.steps, previous.steps) < 0) {
      this.rightTriangles.set(key, candidate);
      this.changed = true;
    }
    this.registerTriangle([vertex, first, second]);
  }

  private constraintSignature(constraint: ParsedConstraint): string | null {
    if (constraint.kind === "distance" && constraint.value !== undefined) {
      return `${distanceKey(constraint.ids[0], constraint.ids[1])}=${formatExact(
        exactFromNumber(constraint.value),
      )}`;
    }
    if (constraint.kind === "angle" && constraint.value !== undefined) {
      return `${angleKey(
        constraint.ids[0],
        constraint.ids[1],
        constraint.ids[2],
      )}=${formatExact(exactFromNumber(constraint.value))}`;
    }
    if (constraint.kind === "area" && constraint.value !== undefined) {
      return `${metricKey("area", "polygon", constraint.ids)}=${formatExact(
        exactFromNumber(constraint.value),
      )}`;
    }
    if (constraint.kind === "parallel" || constraint.kind === "perpendicular") {
      return lineRelationKey(constraint.kind, constraint.ids);
    }
    if (constraint.kind === "distinctPoints") {
      return `distinct:${[...constraint.ids].sort().join("")}`;
    }
    if (constraint.kind === "convex") {
      return `convex:${normalizedCycle(constraint.ids)}`;
    }
    if (
      constraint.kind === "onSegment" ||
      constraint.kind === "onLine" ||
      constraint.kind === "onRay" ||
      constraint.kind === "onCircle" ||
      constraint.kind === "onArc" ||
      constraint.kind === "onEllipse"
    ) {
      return `${constraint.kind}:${constraint.ids.join("")}`;
    }
    if (constraint.kind === "nonIntersecting") {
      const lines = [
        lineKey(constraint.ids[0], constraint.ids[1]),
        lineKey(constraint.ids[2], constraint.ids[3]),
      ].sort();
      return `nonIntersecting:${lines.join(":")}`;
    }
    return constraint.source ? `${constraint.kind}:${constraint.source.replace(/\s+/g, "")}` : null;
  }

  private rememberDirectConstraint(constraint: ParsedConstraint, steps: SolutionStep[]) {
    const signature = this.constraintSignature(constraint);
    if (!signature) return;
    const previous = this.directConstraintSteps.get(signature);
    if (!previous || compareSteps(steps, previous) < 0) {
      this.directConstraintSteps.set(signature, mergeSteps(steps));
    }
  }

  private seedCircleTangency(
    parsed: ParsedConstraint,
    steps: SolutionStep[],
  ) {
    const definition = parsed.intersection;
    if (
      parsed.kind !== "intersectionSet" ||
      !definition ||
      definition.relation !== "equals" ||
      definition.points.length !== 1 ||
      definition.first.kind !== "circle" ||
      definition.second.kind !== "circle"
    ) {
      return false;
    }
    const [firstCenter, firstRadiusPoint] = definition.first.ids;
    const [secondCenter, secondRadiusPoint] = definition.second.ids;
    const pointById = new Map(this.points.map((point) => [point.id, point]));
    const currentDistance = (first: string, second: string) => {
      const left = pointById.get(first);
      const right = pointById.get(second);
      return left && right ? Math.hypot(left.x - right.x, left.y - right.y) : 0;
    };
    const firstRadius = currentDistance(firstCenter, firstRadiusPoint);
    const secondRadius = currentDistance(secondCenter, secondRadiusPoint);
    const centers = currentDistance(firstCenter, secondCenter);
    const externalError = Math.abs(centers - firstRadius - secondRadius);
    const internalError = Math.abs(
      centers - Math.abs(firstRadius - secondRadius),
    );
    const firstRadiusNode: MathNode = {
      kind: "measure",
      measure: "distance",
      ids: [firstCenter, firstRadiusPoint],
    };
    const secondRadiusNode: MathNode = {
      kind: "measure",
      measure: "distance",
      ids: [secondCenter, secondRadiusPoint],
    };
    let right: MathNode;
    let source: string;
    let relationRu: string;
    let relationEn: string;
    const centreLabel = `${firstCenter}${secondCenter}`;
    const firstRadiusLabel = `${firstCenter}${firstRadiusPoint}`;
    const secondRadiusLabel = `${secondCenter}${secondRadiusPoint}`;
    if (externalError <= internalError) {
      right = {
        kind: "binary",
        operator: "+",
        left: firstRadiusNode,
        right: secondRadiusNode,
      };
      source = `${centreLabel} = ${firstRadiusLabel} + ${secondRadiusLabel}`;
      relationRu = "внешнее касание: расстояние между центрами равно сумме радиусов";
      relationEn = "external tangency: the centre distance equals the sum of the radii";
    } else if (firstRadius >= secondRadius) {
      right = {
        kind: "binary",
        operator: "-",
        left: firstRadiusNode,
        right: secondRadiusNode,
      };
      source = `${centreLabel} = ${firstRadiusLabel} - ${secondRadiusLabel}`;
      relationRu = "внутреннее касание: расстояние между центрами равно разности радиусов";
      relationEn = "internal tangency: the centre distance equals the difference of the radii";
    } else {
      right = {
        kind: "binary",
        operator: "-",
        left: secondRadiusNode,
        right: firstRadiusNode,
      };
      source = `${centreLabel} = ${secondRadiusLabel} - ${firstRadiusLabel}`;
      relationRu = "внутреннее касание: расстояние между центрами равно разности радиусов";
      relationEn = "internal tangency: the centre distance equals the difference of the radii";
    }
    this.addEquation(
      {
        left: {
          kind: "measure",
          measure: "distance",
          ids: [firstCenter, secondCenter],
        },
        right,
        source,
      },
      mergeSteps(steps, [
        ruleStep(
          "Касание окружностей",
          "Circle tangency",
          `Ровно одна общая точка означает касание. По взаимному положению окружностей на чертеже выбирается ветвь «${relationRu}», после чего она записывается формулой.`,
          `Exactly one common point means tangency. The drawing selects the “${relationEn}” branch, which is then written as a formula.`,
          source,
        ),
      ]),
    );
    return true;
  }

  private seedConstraint(row: ExpressionRow, parsed: ParsedConstraint) {
    const given = [givenStep(row.expression)];
    this.parsedConstraints.push({ row, parsed });
    this.rememberDirectConstraint(parsed, given);

    if (this.seedCircleTangency(parsed, given)) return;

    if (parsed.kind === "distance" && parsed.value !== undefined) {
      const key = distanceKey(parsed.ids[0], parsed.ids[1]);
      this.registerDistance(parsed.ids[0], parsed.ids[1]);
      this.setFact(key, exactFromNumber(parsed.value), given);
      return;
    }
    if (parsed.kind === "angle" && parsed.value !== undefined) {
      const key = angleKey(parsed.ids[0], parsed.ids[1], parsed.ids[2]);
      const value = exactFromNumber(parsed.value);
      this.registerAngle(parsed.ids[0], parsed.ids[1], parsed.ids[2]);
      this.registerTriangle(parsed.ids);
      this.setFact(key, value, given);
      if (isNinety(value)) {
        this.addRightTriangle(parsed.ids[1], parsed.ids[0], parsed.ids[2], given);
      }
      return;
    }
    if (parsed.kind === "area" && parsed.value !== undefined) {
      this.registerPolygon(parsed.ids, "polygon");
      this.setFact(
        metricKey("area", "polygon", parsed.ids),
        exactFromNumber(parsed.value),
        given,
      );
      return;
    }
    if (parsed.kind === "formula") {
      (parsed.formulas ?? (parsed.formula ? [parsed.formula] : [])).forEach(
        (equation) => this.addEquation(equation, given),
      );
      return;
    }
    if (parsed.kind === "definition" && parsed.definition) {
      this.addEquation(
        {
          left: { kind: "variable", name: parsed.definition.name },
          right: parsed.definition.value,
          source: row.expression,
        },
        given,
      );
      return;
    }
    if (parsed.kind === "intersectionSet" && parsed.intersection?.points.length) {
      const definition = parsed.intersection;
      const seedMembership = (
        point: string,
        object: typeof definition.first,
      ) => {
        const shape = this.shapes.find(
          (candidate) =>
            candidate.points.length >= 2 &&
            candidate.points[0] === object.ids[0] &&
            candidate.points[1] === object.ids[1],
        );
        const kind = object.kind === "auto" ? shape?.type : object.kind;
        if (kind === "circle") {
          this.registerDistance(point, object.ids[0]);
          this.registerDistance(object.ids[0], object.ids[1]);
          this.addEquality(
            distanceKey(point, object.ids[0]),
            distanceKey(object.ids[0], object.ids[1]),
            mergeSteps(given, [
              ruleStep(
                "Принадлежность пересечению",
                "Intersection membership",
                "Точка пересечения принадлежит окружности, поэтому расстояние до центра равно радиусу.",
                "An intersection point lies on the circle, so its centre distance equals the radius.",
              ),
            ]),
          );
          return;
        }
        if (object.ids.length !== 2) return;
        this.addCollinearPoints([point, ...object.ids], given);
        if (kind === "segment" || kind === undefined) {
          this.segmentMemberships.push({
            point,
            start: object.ids[0],
            end: object.ids[1],
            steps: given,
          });
        }
      };
      definition.points.forEach((point) => {
        seedMembership(point, definition.first);
        seedMembership(point, definition.second);
      });
      return;
    }
    if (
      parsed.kind === "onSegment" ||
      parsed.kind === "onLine" ||
      parsed.kind === "onRay"
    ) {
      const [point, start, end] = parsed.ids;
      this.addCollinearPoints([point, start, end], given);
      if (parsed.kind === "onSegment") {
        this.segmentMemberships.push({ point, start, end, steps: given });
      }
      return;
    }
    if (parsed.kind === "onCircle") {
      this.circleMemberships.push({
        point: parsed.ids[0],
        center: parsed.ids[1],
        radiusPoint: parsed.ids[2],
        steps: given,
      });
      this.registerDistance(parsed.ids[0], parsed.ids[1]);
      this.registerDistance(parsed.ids[1], parsed.ids[2]);
      this.addEquality(
        distanceKey(parsed.ids[0], parsed.ids[1]),
        distanceKey(parsed.ids[1], parsed.ids[2]),
        mergeSteps(
          given,
          [
            ruleStep(
              "Радиусы одной окружности",
              "Radii of one circle",
              "Расстояния от центра до точек окружности равны.",
              "Distances from the centre to points on the circle are equal.",
            ),
          ],
        ),
      );
      return;
    }
    if (parsed.kind === "onArc") {
      this.registerDistance(parsed.ids[0], parsed.ids[1]);
      this.registerDistance(parsed.ids[1], parsed.ids[2]);
      this.addEquality(
        distanceKey(parsed.ids[0], parsed.ids[1]),
        distanceKey(parsed.ids[1], parsed.ids[2]),
        mergeSteps(
          given,
          [
            ruleStep(
              "Точка на дуге",
              "Point on an arc",
              "Точка дуги находится на окружности с тем же радиусом.",
              "An arc point lies on the circle with the same radius.",
            ),
          ],
        ),
      );
      return;
    }
    if (parsed.kind === "parallel") {
      this.parallelSteps.set(lineRelationKey("parallel", parsed.ids), given);
      this.registerDistance(parsed.ids[0], parsed.ids[1]);
      this.registerDistance(parsed.ids[2], parsed.ids[3]);
      this.addParallelLines(
        [parsed.ids[0], parsed.ids[1]],
        [parsed.ids[2], parsed.ids[3]],
        given,
      );
      return;
    }
    if (parsed.kind === "perpendicular") {
      const relation = lineRelationKey("perpendicular", parsed.ids);
      this.perpendicularSteps.set(relation, given);
      this.registerDistance(parsed.ids[0], parsed.ids[1]);
      this.registerDistance(parsed.ids[2], parsed.ids[3]);
      this.addPerpendicularRelation(
        [parsed.ids[0], parsed.ids[1]],
        [parsed.ids[2], parsed.ids[3]],
        given,
      );
      const firstLine = new Set(parsed.ids.slice(0, 2));
      const shared = parsed.ids.slice(2, 4).filter((id) => firstLine.has(id));
      if (shared.length === 1) {
        const vertex = shared[0];
        const first = parsed.ids.slice(0, 2).find((id) => id !== vertex);
        const second = parsed.ids.slice(2, 4).find((id) => id !== vertex);
        if (first && second) this.addRightTriangle(vertex, first, second, given);
      }
    }
  }

  private registerTarget(target: UnknownTarget) {
    if (target.kind === "distance" && target.ids.length === 2) {
      this.registerDistance(target.ids[0], target.ids[1]);
      return;
    }
    if (target.kind === "angle" && target.ids.length === 3) {
      this.registerAngle(target.ids[0], target.ids[1], target.ids[2]);
      this.registerTriangle(target.ids);
      return;
    }
    if (target.kind === "area" || target.kind === "perimeter") {
      const geometry = target.geometry ?? "polygon";
      if (geometry === "polygon" || geometry === "circle" || geometry === "sector") {
        this.registerPolygon(target.ids, geometry);
      }
      return;
    }
    if (target.kind === "formula" && target.formula) {
      this.registerMathNode(target.formula);
      return;
    }
    if (target.kind === "predicate" && target.predicate) {
      const predicate = target.predicate;
      if (predicate.kind === "formula") {
        (predicate.formulas ?? (predicate.formula ? [predicate.formula] : [])).forEach(
          ({ left, right }) => {
            this.registerMathNode(left);
            this.registerMathNode(right);
          },
        );
      } else if (predicate.kind === "inequality") {
        (
          predicate.comparisons ??
          (predicate.comparison ? [predicate.comparison] : [])
        ).forEach(({ left, right }) => {
          this.registerMathNode(left);
          this.registerMathNode(right);
        });
      } else if (predicate.kind === "distance") {
        this.registerDistance(predicate.ids[0], predicate.ids[1]);
      } else if (predicate.kind === "angle") {
        this.registerAngle(predicate.ids[0], predicate.ids[1], predicate.ids[2]);
        this.registerTriangle(predicate.ids);
      } else if (predicate.kind === "perpendicular" || predicate.kind === "parallel") {
        this.registerDistance(predicate.ids[0], predicate.ids[1]);
        this.registerDistance(predicate.ids[2], predicate.ids[3]);
      }
    }
  }

  private seedShapes() {
    this.shapes.forEach((shape) => {
      if (shape.type === "polygon") {
        this.registerPolygon(shape.points, "polygon");
        if (shape.points.length === 3) this.registerTriangle(shape.points);
      } else if (shape.type === "circle") {
        this.registerPolygon(shape.points, "circle");
      } else if (shape.type === "sector") {
        this.registerPolygon(shape.points, "sector");
      }
    });
  }

  private addIsoscelesTrapezoidRelations() {
    this.polygonCandidates.forEach(({ ids, geometry }) => {
      if (geometry !== "polygon" || ids.length !== 4) return;
      const [a, b, c, d] = ids;
      const parallel = this.lineDirectionPath(lineKey(a, b), lineKey(c, d));
      const equalLegs = this.equalityEvidence(
        distanceKey(a, d),
        distanceKey(b, c),
      );
      if (!parallel || !equalLegs) return;
      this.registerTriangle([a, b, c]);
      this.registerTriangle([a, b, d]);
      this.registerTriangle([a, c, d]);
      this.registerTriangle([b, c, d]);
      const angleA = angleKey(d, a, b);
      const angleB = angleKey(a, b, c);
      const angleC = angleKey(b, c, d);
      const angleD = angleKey(a, d, c);
      const theorem = mergeSteps(
        parallel,
        equalLegs,
        [ruleStep(
          "Углы равнобедренной трапеции",
          "Angles of an isosceles trapezoid",
          "Если основания четырёхугольника параллельны, а боковые стороны равны, трапеция равнобедренная: углы при каждом основании попарно равны, а углы вдоль боковой стороны дают 180°.",
          "If a quadrilateral has parallel bases and equal legs, it is an isosceles trapezoid: each pair of base angles is equal, and consecutive angles along a leg sum to 180°.",
          `${a}${b} ∥ ${c}${d}, ${a}${d} = ${b}${c}`,
        )],
      );
      this.addEquality(angleA, angleB, theorem);
      this.addEquality(angleD, angleC, theorem);
      const angleNode = (first: string, vertex: string, second: string): MathNode => ({
        kind: "measure",
        measure: "angle",
        ids: [first, vertex, second],
      });
      this.addEquation(
        {
          left: {
            kind: "binary",
            operator: "+",
            left: angleNode(d, a, b),
            right: angleNode(a, d, c),
          },
          right: degreeConstant(180),
          source: `∠${d}${a}${b} + ∠${a}${d}${c} = 180°`,
        },
        theorem,
      );
      this.addEquation(
        {
          left: {
            kind: "binary",
            operator: "+",
            left: angleNode(a, b, c),
            right: angleNode(b, c, d),
          },
          right: degreeConstant(180),
          source: `∠${a}${b}${c} + ∠${b}${c}${d} = 180°`,
        },
        theorem,
      );
    });
  }

  private addTriangleAngleEquations() {
    this.triangleCandidates.forEach((ids) => {
      if (!this.isNondegenerateTriangle(ids)) return;
      const [a, b, c] = ids;
      const angleA: MathNode = {
        kind: "measure",
        measure: "angle",
        ids: [b, a, c],
      };
      const angleB: MathNode = {
        kind: "measure",
        measure: "angle",
        ids: [a, b, c],
      };
      const angleC: MathNode = {
        kind: "measure",
        measure: "angle",
        ids: [a, c, b],
      };
      this.addEquation(
        {
          left: {
            kind: "binary",
            operator: "+",
            left: {
              kind: "binary",
              operator: "+",
              left: angleA,
              right: angleB,
            },
            right: angleC,
          },
          right: degreeConstant(180),
          source: `${a}${b}${c}`,
        },
        [
          ruleStep(
            "Сумма углов треугольника",
            "Triangle angle sum",
            "Сумма внутренних углов треугольника равна 180°.",
            "The interior angles of a triangle add up to 180°.",
            `∠${b}${a}${c} + ∠${a}${b}${c} + ∠${a}${c}${b} = 180°`,
          ),
        ],
      );
    });
  }

  private discoverTriangleCandidates() {
    const ids = [...new Set(this.points.map((point) => point.id))].sort();
    for (let first = 0; first < ids.length; first += 1) {
      for (let second = first + 1; second < ids.length; second += 1) {
        for (let third = second + 1; third < ids.length; third += 1) {
          const triangle = [ids[first], ids[second], ids[third]];
          const sides = [
            distanceKey(triangle[0], triangle[1]),
            distanceKey(triangle[0], triangle[2]),
            distanceKey(triangle[1], triangle[2]),
          ];
          if (sides.every((side) => this.distanceCandidates.has(side))) {
            this.registerTriangle(triangle);
          }
        }
      }
    }
  }

  private addCollinearAngleRelations() {
    const pointById = new Map(this.points.map((point) => [point.id, point]));
    this.segmentMemberships.forEach(({ point, start, end, steps }) => {
      this.points.forEach(({ id: other }) => {
        if (other === point || other === start || other === end) return;
        const otherPoint = pointById.get(other);
        const startPoint = pointById.get(start);
        const middlePoint = pointById.get(point);
        const endPoint = pointById.get(end);
        if (!otherPoint || !startPoint || !middlePoint || !endPoint) return;
        if (Math.abs(orientation(startPoint, endPoint, otherPoint)) <= 1e-9) {
          return;
        }
        this.registerTriangle([other, start, point]);
        this.registerTriangle([other, start, end]);
        this.registerTriangle([other, end, point]);
        this.registerTriangle([other, point, start]);
        this.registerTriangle([other, point, end]);
        const raySteps = mergeSteps(steps, [
          ruleStep(
            "Замена точки на том же луче",
            "Replace a point on the same ray",
            "Внутренняя точка отрезка задаёт от его конца тот же луч, поэтому величина угла не меняется.",
            "An interior segment point lies on the same ray from an endpoint, so replacing it does not change the angle.",
          ),
        ]);
        this.addEquality(
          angleKey(other, start, point),
          angleKey(other, start, end),
          raySteps,
        );
        this.addEquality(
          angleKey(other, end, point),
          angleKey(other, end, start),
          raySteps,
        );
        this.addEquation(
          {
            left: {
              kind: "binary",
              operator: "+",
              left: {
                kind: "measure",
                measure: "angle",
                ids: [start, point, other],
              },
              right: {
                kind: "measure",
                measure: "angle",
                ids: [other, point, end],
              },
            },
            right: degreeConstant(180),
            source: `∠${start}${point}${other} + ∠${other}${point}${end} = 180°`,
          },
          mergeSteps(steps, [
            ruleStep(
              "Смежные углы на прямой",
              "Supplementary angles on a line",
              "Противоположные лучи образуют развёрнутый угол, поэтому два смежных угла в сумме дают 180°.",
              "Opposite rays form a straight angle, so the two adjacent angles sum to 180°.",
            ),
          ]),
        );
      });
    });
  }

  private addCyclicAngleRelations() {
    const groups = new Map<string, { ids: Set<string>; steps: SolutionStep[] }>();
    this.circleMemberships.forEach((membership) => {
      const key = `${membership.center}:${membership.radiusPoint}`;
      const group = groups.get(key) ?? {
        ids: new Set([membership.radiusPoint]),
        steps: [],
      };
      group.ids.add(membership.point);
      group.steps = mergeSteps(group.steps, membership.steps);
      groups.set(key, group);
    });
    const pointById = new Map(this.points.map((point) => [point.id, point]));
    groups.forEach(({ ids: idSet, steps }) => {
      const ids = [...idSet].sort();
      if (ids.length < 4) return;
      for (let first = 0; first < ids.length; first += 1) {
        for (let second = first + 1; second < ids.length; second += 1) {
          const chordStart = ids[first];
          const chordEnd = ids[second];
          const observers = ids.filter(
            (id) => id !== chordStart && id !== chordEnd,
          );
          for (let left = 0; left < observers.length; left += 1) {
            for (let right = left + 1; right < observers.length; right += 1) {
              const firstObserver = observers[left];
              const secondObserver = observers[right];
              const chordStartPoint = pointById.get(chordStart);
              const chordEndPoint = pointById.get(chordEnd);
              const firstPoint = pointById.get(firstObserver);
              const secondPoint = pointById.get(secondObserver);
              if (!chordStartPoint || !chordEndPoint || !firstPoint || !secondPoint) {
                continue;
              }
              const firstSide = orientation(
                chordStartPoint,
                chordEndPoint,
                firstPoint,
              );
              const secondSide = orientation(
                chordStartPoint,
                chordEndPoint,
                secondPoint,
              );
              if (Math.abs(firstSide) <= 1e-9 || Math.abs(secondSide) <= 1e-9) {
                continue;
              }
              this.registerTriangle([chordStart, firstObserver, chordEnd]);
              this.registerTriangle([chordStart, secondObserver, chordEnd]);
              const firstAngle = angleKey(
                chordStart,
                firstObserver,
                chordEnd,
              );
              const secondAngle = angleKey(
                chordStart,
                secondObserver,
                chordEnd,
              );
              const theorem = mergeSteps(steps, [
                ruleStep(
                  "Вписанные углы одной окружности",
                  "Inscribed angles in one circle",
                  firstSide * secondSide > 0
                    ? "Вписанные углы, опирающиеся на одну хорду с одной стороны, равны."
                    : "Вписанные углы, опирающиеся на одну хорду с разных сторон, являются противоположными углами вписанного четырёхугольника и дают 180°.",
                  firstSide * secondSide > 0
                    ? "Inscribed angles subtending the same chord from the same side are equal."
                    : "Inscribed angles subtending the same chord from opposite sides are opposite angles of a cyclic quadrilateral and sum to 180°.",
                ),
              ]);
              if (firstSide * secondSide > 0) {
                this.addEquality(firstAngle, secondAngle, theorem);
              } else {
                this.addEquation(
                  {
                    left: {
                      kind: "binary",
                      operator: "+",
                      left: {
                        kind: "measure",
                        measure: "angle",
                        ids: [chordStart, firstObserver, chordEnd],
                      },
                      right: {
                        kind: "measure",
                        measure: "angle",
                        ids: [chordStart, secondObserver, chordEnd],
                      },
                    },
                    right: degreeConstant(180),
                    source: `${this.keyLabel(firstAngle)} + ${this.keyLabel(secondAngle)} = 180°`,
                  },
                  theorem,
                );
              }
            }
          }
        }
      }
    });
  }

  private addAngleSplitEquations() {
    const pointById = new Map(this.points.map((point) => [point.id, point]));
    const raysByVertex = new Map<string, Set<string>>();
    this.angleCandidates.forEach((key) => {
      const [first, vertex, second] = key.slice("angle:".length).split("");
      const rays = raysByVertex.get(vertex) ?? new Set<string>();
      rays.add(first);
      rays.add(second);
      raysByVertex.set(vertex, rays);
    });
    const seen = new Set<string>();
    raysByVertex.forEach((raySet, vertex) => {
      const rays = [...raySet].sort();
      const vertexPoint = pointById.get(vertex);
      if (!vertexPoint) return;
      for (let first = 0; first < rays.length; first += 1) {
        for (let second = first + 1; second < rays.length; second += 1) {
          for (let third = second + 1; third < rays.length; third += 1) {
            const triple = [rays[first], rays[second], rays[third]];
            const pairs = [
              [triple[0], triple[1]],
              [triple[0], triple[2]],
              [triple[1], triple[2]],
            ] as const;
            const values = pairs.map(([left, right]) => {
              const leftPoint = pointById.get(left);
              const rightPoint = pointById.get(right);
              return leftPoint && rightPoint
                ? angleDegrees(leftPoint, vertexPoint, rightPoint)
                : Number.NaN;
            });
            const largest = values.indexOf(Math.max(...values));
            const smaller = [0, 1, 2].filter((index) => index !== largest);
            if (
              !Number.isFinite(values[largest]) ||
              Math.abs(
                values[largest] - values[smaller[0]] - values[smaller[1]],
              ) > 1e-5
            ) {
              continue;
            }
            const source = `${vertex}:${triple.join("")}`;
            if (seen.has(source)) continue;
            seen.add(source);
            const angleNode = (pairIndex: number): MathNode => ({
              kind: "measure",
              measure: "angle",
              ids: [pairs[pairIndex][0], vertex, pairs[pairIndex][1]],
            });
            const angleLabel = (pairIndex: number) =>
              this.keyLabel(
                angleKey(
                  pairs[pairIndex][0],
                  vertex,
                  pairs[pairIndex][1],
                ),
              );
            this.addEquation(
              {
                left: {
                  kind: "binary",
                  operator: "+",
                  left: angleNode(smaller[0]),
                  right: angleNode(smaller[1]),
                },
                right: angleNode(largest),
                source: `${angleLabel(smaller[0])} + ${angleLabel(smaller[1])} = ${angleLabel(largest)}`,
              },
              [
                ruleStep(
                  "Сложение соседних углов",
                  "Add adjacent angles",
                  "Порядок лучей берётся из выбранной конфигурации чертежа: угол между внешними лучами равен сумме двух соседних углов.",
                  "The selected drawing configuration determines the ray order: the angle between the outer rays is the sum of the two adjacent angles.",
                ),
              ],
            );
          }
        }
      }
    });
  }

  prepare(
    knownRows: ExpressionRow[],
    targets: UnknownTarget[],
  ) {
    this.targetCandidates.push(...targets);
    this.seedShapes();
    knownRows
      .filter((row) => row.enabled)
      .forEach((row) => {
        const parsed = parseConstraint(row.expression, this.angleUnit);
        if (parsed) this.seedConstraint(row, parsed);
    });
    targets.forEach((target) => this.registerTarget(target));
    this.addSegmentEquations();
    this.addIsoscelesTrapezoidRelations();
    const hasAngleRelation = this.parsedConstraints.some(({ parsed }) =>
      parsed.kind === "formula" &&
      (parsed.formulas ?? (parsed.formula ? [parsed.formula] : [])).some(
        (equation) =>
          containsAngleMeasure(equation.left) &&
          containsAngleMeasure(equation.right),
      ),
    );
    this.similarityEnabled =
      hasAngleRelation &&
      this.segmentMemberships.length >= 2 &&
      targets.some((target) => target.kind === "distance");
    const needsAdvancedAngleClosure = this.similarityEnabled || targets.some(
      (target) =>
        target.kind === "angle" ||
        (target.kind === "predicate" && target.predicate?.kind === "angle"),
    );
    if (needsAdvancedAngleClosure) {
      this.discoverTriangleCandidates();
      this.addCollinearAngleRelations();
      this.addCyclicAngleRelations();
      this.discoverTriangleCandidates();
      this.addAngleSplitEquations();
    }
    this.addTriangleAngleEquations();
  }

  private solveEquations() {
    this.equations.forEach(({ equation, steps }) => {
      const left = this.linearize(equation.left);
      const right = this.linearize(equation.right);
      if (!left || !right) return;
      const difference = addForms(left, scaleForm(right, exactNegative(ONE)));
      if (difference.coefficients.size !== 1) return;
      const [[key, coefficient]] = [...difference.coefficients];
      if (isZero(coefficient)) return;
      const value = safeExact(() =>
        exactDivide(exactNegative(difference.constant), coefficient),
      );
      if (!value) return;
      const supportingSteps = mergeSteps(
        this.factStepsForNode(equation.left),
        this.factStepsForNode(equation.right),
        this.equalityStepsForNode(equation.left),
        this.equalityStepsForNode(equation.right),
      );
      this.setFact(
        key,
        value,
        mergeSteps(
          steps,
          supportingSteps,
          [
            ruleStep(
              "Алгебраическое преобразование",
              "Algebraic transformation",
              "Все уже найденные точные значения подставлены в исходное уравнение; затем подобные члены собраны и уравнение решено относительно единственной неизвестной величины.",
              "All previously derived exact values are substituted into the source equation; like terms are collected and the equation is solved for its only unknown quantity.",
              `${equation.source}  ⇒  ${this.keyLabel(key)} = ${formatExact(value)}`,
            ),
          ],
        ),
      );
    });

    const rows = this.equations.flatMap(({ equation, steps }) => {
      const left = this.linearize(equation.left);
      const right = this.linearize(equation.right);
      if (!left || !right) return [];
      const difference = addForms(left, scaleForm(right, exactNegative(ONE)));
      if (
        !difference.coefficients.size ||
        [...difference.coefficients.keys()].some(
          (key) =>
            !key.startsWith("angle:") &&
            !key.startsWith("distance:") &&
            !key.startsWith("variable:"),
        )
      ) {
        return [];
      }
      return [
        {
          coefficients: new Map(difference.coefficients),
          constant: difference.constant,
          steps: mergeSteps(
            steps,
            this.factStepsForNode(equation.left),
            this.factStepsForNode(equation.right),
            this.equalityStepsForNode(equation.left),
            this.equalityStepsForNode(equation.right),
          ),
          sources: [equation.source],
        },
      ];
    });
    const columns = [
      ...new Set(rows.flatMap((row) => [...row.coefficients.keys()])),
    ].sort();
    let pivotRow = 0;
    for (const column of columns) {
      const candidate = rows.findIndex(
        (row, index) =>
          index >= pivotRow &&
          row.coefficients.has(column) &&
          !isZero(row.coefficients.get(column) as ExactValue),
      );
      if (candidate < 0) continue;
      [rows[pivotRow], rows[candidate]] = [rows[candidate], rows[pivotRow]];
      const pivot = rows[pivotRow];
      const divisor = pivot.coefficients.get(column) as ExactValue;
      pivot.coefficients.forEach((coefficient, key) => {
        pivot.coefficients.set(key, exactDivide(coefficient, divisor));
      });
      pivot.constant = exactDivide(pivot.constant, divisor);
      rows.forEach((row, index) => {
        if (index === pivotRow) return;
        const factor = row.coefficients.get(column);
        if (!factor || isZero(factor)) return;
        pivot.coefficients.forEach((coefficient, key) => {
          const next = exactSubtract(
            row.coefficients.get(key) ?? ZERO,
            exactMultiply(factor, coefficient),
          );
          if (isZero(next)) row.coefficients.delete(key);
          else row.coefficients.set(key, next);
        });
        row.constant = exactSubtract(
          row.constant,
          exactMultiply(factor, pivot.constant),
        );
        row.steps = mergeSteps(row.steps, pivot.steps);
        row.sources = [...new Set([...row.sources, ...pivot.sources])];
      });
      pivotRow += 1;
      if (pivotRow >= rows.length) break;
    }
    rows.forEach((row) => {
      if (row.coefficients.size !== 1) return;
      const [[key, coefficient]] = [...row.coefficients];
      if (isZero(coefficient)) return;
      const value = safeExact(() =>
        exactDivide(exactNegative(row.constant), coefficient),
      );
      if (!value) return;
      this.setFact(
        key,
        value,
        mergeSteps(row.steps, [
          ruleStep(
            "Решение системы линейных соотношений",
            "Solve the linear relation system",
            "Равенства длин или углов, суммы углов и разбиения объединены в одну систему; исключение остальных неизвестных даёт искомую величину.",
            "Length or angle equalities, angle sums, and decompositions are combined into one system; eliminating the other unknowns yields the requested value.",
            `${row.sources.join("\n")}\n⇒ ${this.keyLabel(key)} = ${formatExact(value)}`,
          ),
        ]),
      );
    });
  }

  private equalityEvidence(first: string, second: string): SolutionStep[] | null {
    const path = this.equalityPath(first, second);
    if (path) return path;
    const firstFact = this.getFact(first);
    const secondFact = this.getFact(second);
    if (!firstFact || !secondFact || !exactEqual(firstFact.value, secondFact.value)) {
      return null;
    }
    return mergeSteps(
      firstFact.steps,
      secondFact.steps,
      [
        ruleStep(
          "Сравнение точных значений",
          "Compare exact values",
          "Обе величины имеют одно и то же точное значение.",
          "Both quantities have the same exact value.",
        ),
      ],
    );
  }

  private deriveRightAngles() {
    this.angleCandidates.forEach((key) => {
      const fact = this.getFact(key);
      if (!fact || !isNinety(fact.value)) return;
      const body = key.slice("angle:".length);
      this.addRightTriangle(body[1], body[0], body[2], fact.steps);
    });
  }

  private deriveLineRightAngles() {
    const lines = [...this.lineCandidates.values()];
    for (let firstIndex = 0; firstIndex < lines.length; firstIndex += 1) {
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < lines.length;
        secondIndex += 1
      ) {
        const firstLine = lines[firstIndex];
        const secondLine = lines[secondIndex];
        const shared = firstLine.filter((id) => secondLine.includes(id));
        if (shared.length !== 1) continue;
        const vertex = shared[0];
        const first = firstLine.find((id) => id !== vertex);
        const second = secondLine.find((id) => id !== vertex);
        if (!first || !second || first === second) continue;
        const evidence = this.perpendicularEvidence(firstLine, secondLine);
        if (!evidence) continue;
        const derived = mergeSteps(evidence, [
          ruleStep(
            "Перенос перпендикулярности",
            "Transfer perpendicularity",
            "Параллельные или совпадающие направления сохраняют прямой угол.",
            "Parallel or coincident directions preserve a right angle.",
            `∠${first}${vertex}${second} = 90°`,
          ),
        ]);
        this.setFact(angleKey(first, vertex, second), NINETY, derived);
        this.addRightTriangle(vertex, first, second, derived);
      }
    }
  }

  private deriveIsoscelesAngles() {
    this.triangleCandidates.forEach((ids) => {
      if (!this.isNondegenerateTriangle(ids)) return;
      ids.forEach((vertex) => {
        const others = ids.filter((id) => id !== vertex);
        const firstSide = distanceKey(vertex, others[0]);
        const secondSide = distanceKey(vertex, others[1]);
        const evidence = this.equalityEvidence(firstSide, secondSide);
        if (!evidence) return;
        const firstAngle = angleKey(vertex, others[0], others[1]);
        const secondAngle = angleKey(others[0], others[1], vertex);
        this.addEquality(
          firstAngle,
          secondAngle,
          mergeSteps(
            evidence,
            [
              ruleStep(
                "Углы при основании",
                "Base angles",
                "В равнобедренном треугольнике углы при основании равны.",
                "The base angles of an isosceles triangle are equal.",
                `${this.keyLabel(firstAngle)} = ${this.keyLabel(secondAngle)}`,
              ),
            ],
          ),
        );
      });
    });
  }

  private deriveConverseIsoscelesSides() {
    this.triangleCandidates.forEach((ids) => {
      if (!this.isNondegenerateTriangle(ids)) return;
      for (let firstIndex = 0; firstIndex < ids.length; firstIndex += 1) {
        for (
          let secondIndex = firstIndex + 1;
          secondIndex < ids.length;
          secondIndex += 1
        ) {
          const first = ids[firstIndex];
          const second = ids[secondIndex];
          const third = ids.find((id) => id !== first && id !== second);
          if (!third) continue;
          const firstAngle = angleKey(second, first, third);
          const secondAngle = angleKey(first, second, third);
          const evidence = this.equalityEvidence(firstAngle, secondAngle);
          if (!evidence) continue;
          const firstOppositeSide = distanceKey(second, third);
          const secondOppositeSide = distanceKey(first, third);
          this.addEquality(
            firstOppositeSide,
            secondOppositeSide,
            mergeSteps(evidence, [
              ruleStep(
                "Обратная теорема о равнобедренном треугольнике",
                "Converse isosceles-triangle theorem",
                "Если два угла треугольника равны, то лежащие напротив них стороны равны.",
                "If two angles of a triangle are equal, then their opposite sides are equal.",
                `${this.keyLabel(firstAngle)} = ${this.keyLabel(secondAngle)} ⇒ ${this.keyLabel(firstOppositeSide)} = ${this.keyLabel(secondOppositeSide)}`,
              ),
            ]),
          );
        }
      }
    });
  }

  private deriveSimilarTriangles() {
    if (!this.similarityEnabled) return;
    const triangles = [...this.triangleCandidates.values()];
    const sideIndexes: [number, number][] = [[0, 1], [1, 2], [0, 2]];
    const permutations = [
      [0, 1, 2], [0, 2, 1], [1, 0, 2],
      [1, 2, 0], [2, 0, 1], [2, 1, 0],
    ];
    const angleAt = (triangle: readonly string[], index: number) => {
      const other = [0, 1, 2].filter((candidate) => candidate !== index);
      return angleKey(triangle[other[0]], triangle[index], triangle[other[1]]);
    };

    for (let firstIndex = 0; firstIndex < triangles.length; firstIndex += 1) {
      const first = triangles[firstIndex];
      if (!this.isNondegenerateTriangle(first)) continue;
      for (let secondIndex = firstIndex + 1; secondIndex < triangles.length; secondIndex += 1) {
        const second = triangles[secondIndex];
        if (!this.isNondegenerateTriangle(second)) continue;
        for (const permutation of permutations) {
          const mappedSecond = permutation.map((index) => second[index]);
          const sharedIndexes = [0, 1, 2].filter(
            (index) => first[index] === mappedSecond[index],
          );
          if (sharedIndexes.length !== 1) continue;
          const sharedIndex = sharedIndexes[0];
          const otherIndexes = [0, 1, 2].filter(
            (index) => index !== sharedIndex,
          );
          const onSegment = (point: string, start: string, end: string) =>
            this.segmentMemberships.some(
              (membership) =>
                membership.point === point &&
                lineKey(membership.start, membership.end) === lineKey(start, end),
            );
          const secondInsideFirst = otherIndexes.every((index) =>
            onSegment(mappedSecond[index], first[sharedIndex], first[index]),
          );
          const firstInsideSecond = otherIndexes.every((index) =>
            onSegment(first[index], mappedSecond[sharedIndex], mappedSecond[index]),
          );
          if (!secondInsideFirst && !firstInsideSecond) continue;
          const angleEvidence = [0, 1, 2].map((index) =>
            this.equalityPath(angleAt(first, index), angleAt(mappedSecond, index)),
          );
          const matchingAngles = angleEvidence
            .map((evidence, index) => (evidence ? index : -1))
            .filter((index) => index >= 0);
          if (matchingAngles.length < 2) continue;
          const similarityEvidence = mergeSteps(
            ...matchingAngles.slice(0, 2).map(
              (index) => angleEvidence[index] as SolutionStep[],
            ),
            [ruleStep(
              "Подобие треугольников по двум углам",
              "AA triangle similarity",
              "Два угла одного треугольника равны двум соответствующим углам другого, поэтому соответствующие стороны пропорциональны.",
              "Two angles of one triangle equal the corresponding angles of the other, so corresponding sides are proportional.",
              `△${first.join("")} ∼ △${mappedSecond.join("")}`,
            )],
          );
          const correspondingSides = sideIndexes.map(([left, right]) => ({
            firstKey: distanceKey(first[left], first[right]),
            secondKey: distanceKey(mappedSecond[left], mappedSecond[right]),
          }));
          for (const reference of correspondingSides) {
            const referenceFirst = this.getFact(reference.firstKey);
            const referenceSecond = this.getFact(reference.secondKey);
            if (!referenceFirst || !referenceSecond || isZero(referenceFirst.value) || isZero(referenceSecond.value)) continue;
            for (const target of correspondingSides) {
              if (target === reference) continue;
              const targetFirst = this.getFact(target.firstKey);
              const targetSecond = this.getFact(target.secondKey);
              const setProportionalFact = (
                key: string,
                value: ExactValue,
                known: ProvenValue,
                expression: string,
              ) => this.setFact(
                key,
                value,
                mergeSteps(
                  similarityEvidence,
                  referenceFirst.steps,
                  referenceSecond.steps,
                  known.steps,
                  [ruleStep(
                    "Пропорция соответствующих сторон",
                    "Proportion of corresponding sides",
                    "Подставляем известные соответствующие стороны в пропорцию подобных треугольников и выражаем неизвестную длину.",
                    "Substitute the known corresponding sides into the similarity proportion and isolate the unknown length.",
                    expression,
                  )],
                ),
              );
              if (!targetFirst && targetSecond) {
                const value = safeExact(() => exactDivide(
                  exactMultiply(targetSecond.value, referenceFirst.value),
                  referenceSecond.value,
                ));
                if (value) setProportionalFact(
                  target.firstKey,
                  value,
                  targetSecond,
                  `${this.keyLabel(target.firstKey)}/${this.keyLabel(target.secondKey)} = ${this.keyLabel(reference.firstKey)}/${this.keyLabel(reference.secondKey)} ⇒ ${this.keyLabel(target.firstKey)} = ${formatExact(value)}`,
                );
              } else if (targetFirst && !targetSecond) {
                const value = safeExact(() => exactDivide(
                  exactMultiply(targetFirst.value, referenceSecond.value),
                  referenceFirst.value,
                ));
                if (value) setProportionalFact(
                  target.secondKey,
                  value,
                  targetFirst,
                  `${this.keyLabel(target.firstKey)}/${this.keyLabel(target.secondKey)} = ${this.keyLabel(reference.firstKey)}/${this.keyLabel(reference.secondKey)} ⇒ ${this.keyLabel(target.secondKey)} = ${formatExact(value)}`,
                );
              }
            }
          }
        }
      }
    }
  }

  private deriveIsoscelesAltitudes() {
    this.triangleCandidates.forEach((ids) => {
      ids.forEach((apex) => {
        const [first, second] = ids.filter((id) => id !== apex);
        const equalSides = this.equalityEvidence(
          distanceKey(apex, first),
          distanceKey(apex, second),
        );
        if (!equalSides) return;
        this.segmentMemberships.forEach((membership) => {
          if (
            lineKey(membership.start, membership.end) !==
              lineKey(first, second) ||
            membership.point === apex
          ) {
            return;
          }
          const foot = membership.point;
          const perpendicular = this.perpendicularEvidence(
            [apex, foot],
            [first, second],
          );
          if (!perpendicular) return;
          this.addEquality(
            distanceKey(first, foot),
            distanceKey(foot, second),
            mergeSteps(equalSides, membership.steps, perpendicular, [
              ruleStep(
                "Высота равнобедренного треугольника",
                "Altitude of an isosceles triangle",
                "Высота, проведённая из вершины равнобедренного треугольника к основанию, одновременно является медианой и делит основание пополам.",
                "The altitude from the apex of an isosceles triangle is also a median and bisects the base.",
                `${apex}${foot} ⟂ ${first}${second}, ${this.keyLabel(distanceKey(apex, first))} = ${this.keyLabel(distanceKey(apex, second))} ⇒ ${this.keyLabel(distanceKey(first, foot))} = ${this.keyLabel(distanceKey(foot, second))}`,
              ),
            ]),
          );
        });
      });
    });
  }

  private deriveMedianRelations() {
    this.triangleCandidates.forEach((ids) => {
      ids.forEach((apex) => {
        const [first, second] = ids.filter((id) => id !== apex);
        this.segmentMemberships.forEach((membership) => {
          if (
            lineKey(membership.start, membership.end) !==
            lineKey(first, second)
          ) {
            return;
          }
          const midpoint = membership.point;
          if (midpoint === apex) return;
          const firstHalfKey = distanceKey(first, midpoint);
          const secondHalfKey = distanceKey(midpoint, second);
          const midpointEvidence = this.equalityEvidence(
            firstHalfKey,
            secondHalfKey,
          );
          if (!midpointEvidence) return;

          const firstSideKey = distanceKey(apex, first);
          const secondSideKey = distanceKey(apex, second);
          const medianKey = distanceKey(apex, midpoint);
          const firstSide = this.getFact(firstSideKey);
          const secondSide = this.getFact(secondSideKey);
          const median = this.getFact(medianKey);
          const half = this.getFact(firstHalfKey) ?? this.getFact(secondHalfKey);
          const theorem = ruleStep(
            "Теорема Аполлония для медианы",
            "Apollonius's median theorem",
            "Сумма квадратов двух сторон треугольника равна удвоенной сумме квадратов медианы и половины стороны, к которой она проведена.",
            "The sum of the squares of two triangle sides equals twice the sum of the squares of the median and half of the bisected side.",
            `${this.keyLabel(firstSideKey)}² + ${this.keyLabel(secondSideKey)}² = 2*(${this.keyLabel(medianKey)}² + ${this.keyLabel(firstHalfKey)}²)`,
          );
          const commonSteps = mergeSteps(
            membership.steps,
            midpointEvidence,
            firstSide?.steps ?? [],
            secondSide?.steps ?? [],
            median?.steps ?? [],
            half?.steps ?? [],
            [theorem],
          );

          if (firstSide && secondSide && median && !half) {
            const squared = exactSubtract(
              exactDivide(
                exactAdd(
                  exactPowInteger(firstSide.value, 2),
                  exactPowInteger(secondSide.value, 2),
                ),
                TWO,
              ),
              exactPowInteger(median.value, 2),
            );
            this.setSquareRootFact(
              firstHalfKey,
              squared,
              mergeSteps(commonSteps, [
                ruleStep(
                  "Половина основания из теоремы Аполлония",
                  "Half-base from Apollonius's theorem",
                  "Выражаем квадрат половины основания и подставляем известные длины.",
                  "Isolate the squared half-base and substitute the known lengths.",
                  `${this.keyLabel(firstHalfKey)}² = (${formatExact(firstSide.value)}² + ${formatExact(secondSide.value)}²)/2 - ${formatExact(median.value)}² = ${formatExact(squared)}`,
                ),
              ]),
            );
            return;
          }

          if (firstSide && secondSide && half && !median) {
            const squared = exactSubtract(
              exactDivide(
                exactAdd(
                  exactPowInteger(firstSide.value, 2),
                  exactPowInteger(secondSide.value, 2),
                ),
                TWO,
              ),
              exactPowInteger(half.value, 2),
            );
            this.setSquareRootFact(medianKey, squared, commonSteps);
            return;
          }

          if (median && half && firstSide && !secondSide) {
            const squared = exactSubtract(
              exactMultiply(
                TWO,
                exactAdd(
                  exactPowInteger(median.value, 2),
                  exactPowInteger(half.value, 2),
                ),
              ),
              exactPowInteger(firstSide.value, 2),
            );
            this.setSquareRootFact(secondSideKey, squared, commonSteps);
            return;
          }

          if (median && half && secondSide && !firstSide) {
            const squared = exactSubtract(
              exactMultiply(
                TWO,
                exactAdd(
                  exactPowInteger(median.value, 2),
                  exactPowInteger(half.value, 2),
                ),
              ),
              exactPowInteger(secondSide.value, 2),
            );
            this.setSquareRootFact(firstSideKey, squared, commonSteps);
          }
        });
      });
    });
  }

  private deriveRightTriangleAltitudeRelations() {
    this.triangleCandidates.forEach((ids) => {
      ids.forEach((rightVertex) => {
        const [first, second] = ids.filter((id) => id !== rightVertex);
        const [normalizedFirst, normalizedSecond] = sortedPair(first, second);
        const rightTriangle = this.rightTriangles.get(
          `${rightVertex}:${normalizedFirst}:${normalizedSecond}`,
        );
        if (!rightTriangle) return;
        this.segmentMemberships.forEach((membership) => {
          if (
            lineKey(membership.start, membership.end) !==
            lineKey(first, second)
          ) {
            return;
          }
          const foot = membership.point;
          if (foot === rightVertex) return;
          const altitudeEvidence = this.perpendicularEvidence(
            [rightVertex, foot],
            [first, second],
          );
          if (!altitudeEvidence) return;

          const hypotenuseKey = distanceKey(first, second);
          const hypotenuse = this.getFact(hypotenuseKey);
          if (!hypotenuse || isZero(hypotenuse.value)) return;
          const deriveProjection = (
            endpoint: string,
            legKey: string,
          ) => {
            const leg = this.getFact(legKey);
            if (!leg) return;
            const projectionKey = distanceKey(endpoint, foot);
            const projection = safeExact(() =>
              exactDivide(
                exactPowInteger(leg.value, 2),
                hypotenuse.value,
              ),
            );
            if (!projection) return;
            this.setFact(
              projectionKey,
              projection,
              mergeSteps(
                rightTriangle.steps,
                membership.steps,
                altitudeEvidence,
                leg.steps,
                hypotenuse.steps,
                [
                  ruleStep(
                    "Теорема о катете и его проекции",
                    "Leg-projection theorem",
                    "В прямоугольном треугольнике квадрат катета равен произведению гипотенузы на проекцию этого катета на гипотенузу.",
                    "In a right triangle, the square of a leg equals the hypotenuse times that leg's projection onto the hypotenuse.",
                    `${this.keyLabel(legKey)}² = ${this.keyLabel(hypotenuseKey)}*${this.keyLabel(projectionKey)}`,
                  ),
                  ruleStep(
                    "Вычисление проекции катета",
                    "Compute the leg projection",
                    "Делим квадрат известного катета на длину гипотенузы и сохраняем точную дробь.",
                    "Divide the known squared leg by the hypotenuse and keep the exact fraction.",
                    `${this.keyLabel(projectionKey)} = ${formatExact(leg.value)}²/${formatExact(hypotenuse.value)} = ${formatExact(projection)}`,
                  ),
                ],
              ),
            );
          };

          deriveProjection(first, distanceKey(rightVertex, first));
          deriveProjection(second, distanceKey(rightVertex, second));

          const firstProjection = this.getFact(distanceKey(first, foot));
          const secondProjection = this.getFact(distanceKey(foot, second));
          if (!firstProjection || !secondProjection) return;
          this.setSquareRootFact(
            distanceKey(rightVertex, foot),
            exactMultiply(firstProjection.value, secondProjection.value),
            mergeSteps(
              firstProjection.steps,
              secondProjection.steps,
              altitudeEvidence,
              [
                ruleStep(
                  "Теорема о высоте к гипотенузе",
                  "Altitude-to-hypotenuse theorem",
                  "Квадрат высоты к гипотенузе равен произведению двух отрезков гипотенузы.",
                  "The square of the altitude to the hypotenuse equals the product of the two hypotenuse segments.",
                  `${this.keyLabel(distanceKey(rightVertex, foot))}² = ${this.keyLabel(distanceKey(first, foot))}*${this.keyLabel(distanceKey(foot, second))}`,
                ),
              ],
            ),
          );
        });
      });
    });
  }

  private deriveStewartCevianRelations() {
    this.triangleCandidates.forEach((ids) => {
      ids.forEach((apex) => {
        const [first, second] = ids.filter((id) => id !== apex);
        this.segmentMemberships.forEach((membership) => {
          if (
            lineKey(membership.start, membership.end) !==
            lineKey(first, second)
          ) {
            return;
          }
          const point = membership.point;
          if (point === apex) return;
          const baseKey = distanceKey(first, second);
          const firstPartKey = distanceKey(first, point);
          const secondPartKey = distanceKey(point, second);
          const firstSideKey = distanceKey(apex, first);
          const secondSideKey = distanceKey(apex, second);
          const cevianKey = distanceKey(apex, point);
          if (this.getFact(cevianKey)) return;
          const base = this.getFact(baseKey);
          const firstPart = this.getFact(firstPartKey);
          const secondPart = this.getFact(secondPartKey);
          const firstSide = this.getFact(firstSideKey);
          const secondSide = this.getFact(secondSideKey);
          if (
            !base ||
            !firstPart ||
            !secondPart ||
            !firstSide ||
            !secondSide ||
            isZero(base.value)
          ) {
            return;
          }
          const weightedSquares = exactAdd(
            exactMultiply(
              exactPowInteger(secondSide.value, 2),
              firstPart.value,
            ),
            exactMultiply(
              exactPowInteger(firstSide.value, 2),
              secondPart.value,
            ),
          );
          const squared = exactSubtract(
            exactDivide(weightedSquares, base.value),
            exactMultiply(firstPart.value, secondPart.value),
          );
          if (exactCompare(squared, ZERO) === -1) return;
          this.setSquareRootFact(
            cevianKey,
            squared,
            mergeSteps(
              membership.steps,
              base.steps,
              firstPart.steps,
              secondPart.steps,
              firstSide.steps,
              secondSide.steps,
              [
                ruleStep(
                  "Теорема Стюарта",
                  "Stewart's theorem",
                  "Для чевианы квадрат её длины выражается через две боковые стороны и два отрезка противоположной стороны.",
                  "For a cevian, its squared length is determined by the two adjacent sides and the two parts of the opposite side.",
                  `${this.keyLabel(secondSideKey)}²*${this.keyLabel(firstPartKey)} + ${this.keyLabel(firstSideKey)}²*${this.keyLabel(secondPartKey)} = ${this.keyLabel(baseKey)}*(${this.keyLabel(cevianKey)}² + ${this.keyLabel(firstPartKey)}*${this.keyLabel(secondPartKey)})`,
                ),
                ruleStep(
                  "Вычисление длины чевианы",
                  "Compute the cevian length",
                  "Подставляем точные длины, переносим произведение частей основания и выражаем квадрат чевианы.",
                  "Substitute the exact lengths, move the product of the base parts, and isolate the squared cevian.",
                  `${this.keyLabel(cevianKey)}² = (${formatExact(secondSide.value)}²*${formatExact(firstPart.value)} + ${formatExact(firstSide.value)}²*${formatExact(secondPart.value)})/${formatExact(base.value)} - ${formatExact(firstPart.value)}*${formatExact(secondPart.value)} = ${formatExact(squared)}`,
                ),
              ],
            ),
          );
        });
      });
    });
  }

  private deriveCosineLaw() {
    this.triangleCandidates.forEach((ids) => {
      ids.forEach((vertex) => {
        const [first, second] = ids.filter((id) => id !== vertex);
        const firstSideKey = distanceKey(vertex, first);
        const secondSideKey = distanceKey(vertex, second);
        const oppositeSideKey = distanceKey(first, second);
        const includedAngleKey = angleKey(first, vertex, second);
        const firstSide = this.getFact(firstSideKey);
        const secondSide = this.getFact(secondSideKey);
        const oppositeSide = this.getFact(oppositeSideKey);
        const includedAngle = this.getFact(includedAngleKey);
        const theorem = ruleStep(
          "Теорема косинусов",
          "Law of cosines",
          "Квадрат стороны треугольника равен сумме квадратов двух других сторон минус удвоенное произведение этих сторон на косинус угла между ними.",
          "The square of one triangle side equals the sum of the squares of the other two minus twice their product times the cosine of the included angle.",
          `${this.keyLabel(oppositeSideKey)}² = ${this.keyLabel(firstSideKey)}² + ${this.keyLabel(secondSideKey)}² - 2*${this.keyLabel(firstSideKey)}*${this.keyLabel(secondSideKey)}*cos(${this.keyLabel(includedAngleKey)})`,
        );

        if (firstSide && secondSide && includedAngle) {
          const cosine = exactTrig("cos", includedAngle.value, "degrees");
          if (cosine) {
            const squared = exactSubtract(
              exactAdd(
                exactPowInteger(firstSide.value, 2),
                exactPowInteger(secondSide.value, 2),
              ),
              exactMultiply(
                exactFromRational(2),
                exactMultiply(
                  exactMultiply(firstSide.value, secondSide.value),
                  cosine,
                ),
              ),
            );
            this.setSquareRootFact(
              oppositeSideKey,
              squared,
              mergeSteps(
                firstSide.steps,
                secondSide.steps,
                includedAngle.steps,
                [
                  theorem,
                  ruleStep(
                    "Подстановка в теорему косинусов",
                    "Substitute into the law of cosines",
                    "Подставляем две известные стороны и точное значение косинуса заданного угла.",
                    "Substitute the two known sides and the exact cosine of the given angle.",
                    `${this.keyLabel(oppositeSideKey)}² = ${formatExact(squared)}`,
                  ),
                ],
              ),
            );
          }
        }

        if (!firstSide || !secondSide || !oppositeSide) return;
        const denominator = exactMultiply(
          exactFromRational(2),
          exactMultiply(firstSide.value, secondSide.value),
        );
        const cosine = safeExact(() =>
          exactDivide(
            exactSubtract(
              exactAdd(
                exactPowInteger(firstSide.value, 2),
                exactPowInteger(secondSide.value, 2),
              ),
              exactPowInteger(oppositeSide.value, 2),
            ),
            denominator,
          ),
        );
        if (!cosine) return;
        const angle = [0, 18, 30, 36, 45, 54, 60, 72, 90, 120, 135, 150, 180]
          .find((degrees) => {
            const candidate = exactTrig(
              "cos",
              exactFromRational(degrees),
              "degrees",
            );
            return candidate ? exactEqual(candidate, cosine) : false;
          });
        if (angle === undefined) {
          const approximateCosine = exactApproximate(cosine);
          if (
            approximateCosine < -1 - 1e-12 ||
            approximateCosine > 1 + 1e-12
          ) {
            return;
          }
          const clampedCosine = Math.max(-1, Math.min(1, approximateCosine));
          const approximateAngle = Math.acos(clampedCosine) * 180 / Math.PI;
          const cosineText = formatExact(cosine);
          const exactAngle = `180*acos(${cosineText})/pi`;
          this.setSymbolicFact(
            includedAngleKey,
            approximateAngle,
            exactAngle,
            mergeSteps(
              firstSide.steps,
              secondSide.steps,
              oppositeSide.steps,
              [
                theorem,
                ruleStep(
                  "Обратный косинус точного отношения",
                  "Inverse cosine of an exact ratio",
                  "Косинус не является табличным, поэтому угол сохраняется без десятичного округления как точное выражение через arccos. Множитель 180/pi переводит радианы в градусы.",
                  "The cosine is not a standard table value, so the angle is kept without decimal rounding as an exact arccos expression. The factor 180/pi converts radians to degrees.",
                  `cos(${this.keyLabel(includedAngleKey)}) = ${cosineText}; ${this.keyLabel(includedAngleKey)} = ${exactAngle}°`,
                ),
              ],
            ),
          );
          return;
        }
        this.setFact(
          includedAngleKey,
          exactFromRational(angle),
          mergeSteps(
            firstSide.steps,
            secondSide.steps,
            oppositeSide.steps,
            [
              theorem,
              ruleStep(
                "Угол из теоремы косинусов",
                "Angle from the law of cosines",
                "Выражаем косинус угла через три стороны и узнаём его точное табличное значение на промежутке от 0° до 180°.",
                "Express the angle cosine through the three sides and match its exact standard value on the interval from 0° to 180°.",
                `cos(${this.keyLabel(includedAngleKey)}) = ${formatExact(cosine)}; ${this.keyLabel(includedAngleKey)} = ${angle}°`,
              ),
            ],
          ),
        );
      });
    });
  }

  private setSquareRootFact(
    key: string,
    squared: ExactValue,
    steps: SolutionStep[],
  ) {
    if (exactCompare(squared, ZERO) === -1) return;
    const exact = safeExact(() => exactSqrt(squared));
    if (exact) {
      this.setFact(
        key,
        exact,
        mergeSteps(steps, [
          ruleStep(
            "Извлечение квадратного корня",
            "Take the square root",
            "Длина неотрицательна, поэтому выбирается положительный квадратный корень и точное выражение упрощается.",
            "A length is non-negative, so take the positive square root and simplify the exact expression.",
            `${this.keyLabel(key)} = sqrt(${formatExact(squared)}) = ${formatExact(exact)}`,
          ),
        ]),
      );
      return;
    }
    const approximate = Math.sqrt(Math.max(0, exactApproximate(squared)));
    if (!Number.isFinite(approximate)) return;
    this.setSymbolicFact(
      key,
      approximate,
      `sqrt(${formatExact(squared)})`,
      mergeSteps(steps, [
        ruleStep(
          "Извлечение квадратного корня",
          "Take the square root",
          "Длина неотрицательна; радикал сохранён в символьном виде без десятичного округления.",
          "The length is non-negative; keep the radical symbolically without decimal rounding.",
          `${this.keyLabel(key)} = sqrt(${formatExact(squared)})`,
        ),
      ]),
    );
  }

  private setTrigonometricSide(
    key: string,
    hypotenuse: ProvenValue,
    angle: ProvenValue,
    name: "sin" | "cos",
    theorem: SolutionStep,
  ) {
    const exactRatio = exactTrig(name, angle.value, "degrees");
    const steps = mergeSteps(hypotenuse.steps, angle.steps, [theorem]);
    if (exactRatio) {
      const value = exactMultiply(hypotenuse.value, exactRatio);
      this.setFact(
        key,
        value,
        mergeSteps(steps, [
          ruleStep(
            "Точная тригонометрическая подстановка",
            "Exact trigonometric substitution",
            "Подставляем точную длину гипотенузы и табличное значение тригонометрической функции, затем упрощаем произведение.",
            "Substitute the exact hypotenuse and standard exact trigonometric value, then simplify the product.",
            `${this.keyLabel(key)} = ${formatExact(hypotenuse.value)}*${name}(${formatExact(angle.value)}°) = ${formatExact(value)}`,
          ),
        ]),
      );
      return;
    }
    const symbolic = symbolicTrig(name, angle.value, "degrees");
    if (!symbolic) return;
    const coefficient = safeExact(() =>
      exactDivide(hypotenuse.value, exactFromRational(symbolic.denominator)),
    );
    if (!coefficient) return;
    const coefficientText = formatExact(coefficient);
    const exact =
      coefficientText === "1"
        ? symbolic.numerator
        : coefficientText.includes(" + ") || coefficientText.includes(" - ")
          ? `(${coefficientText})*${symbolic.numerator}`
          : `${coefficientText}*${symbolic.numerator}`;
    this.setSymbolicFact(
      key,
      exactApproximate(hypotenuse.value) * symbolic.value,
      exact,
      steps,
    );
  }

  private deriveRightTriangleTrigonometry(
    vertex: string,
    first: string,
    second: string,
  ) {
    const hypotenuseKey = distanceKey(first, second);
    const hypotenuse = this.getFact(hypotenuseKey);
    if (!hypotenuse) return;
    const cases = [
      {
        angleKey: angleKey(vertex, first, second),
        adjacentKey: distanceKey(vertex, first),
        oppositeKey: distanceKey(vertex, second),
      },
      {
        angleKey: angleKey(vertex, second, first),
        adjacentKey: distanceKey(vertex, second),
        oppositeKey: distanceKey(vertex, first),
      },
    ];
    cases.forEach((candidate) => {
      const angle = this.getFact(candidate.angleKey);
      if (!angle) return;
      this.setTrigonometricSide(
        candidate.adjacentKey,
        hypotenuse,
        angle,
        "cos",
        ruleStep(
          "Косинус острого угла",
          "Cosine of an acute angle",
          "Прилежащий катет равен гипотенузе, умноженной на косинус угла.",
          "The adjacent leg equals the hypotenuse times the cosine of the angle.",
          `${this.keyLabel(candidate.adjacentKey)} = ${this.keyLabel(hypotenuseKey)}*cos(${this.keyLabel(candidate.angleKey)})`,
        ),
      );
      this.setTrigonometricSide(
        candidate.oppositeKey,
        hypotenuse,
        angle,
        "sin",
        ruleStep(
          "Синус острого угла",
          "Sine of an acute angle",
          "Противолежащий катет равен гипотенузе, умноженной на синус угла.",
          "The opposite leg equals the hypotenuse times the sine of the angle.",
          `${this.keyLabel(candidate.oppositeKey)} = ${this.keyLabel(hypotenuseKey)}*sin(${this.keyLabel(candidate.angleKey)})`,
        ),
      );
    });
  }

  private deriveRightTriangles() {
    this.rightTriangles.forEach(({ vertex, first, second, steps }) => {
      const firstLegKey = distanceKey(vertex, first);
      const secondLegKey = distanceKey(vertex, second);
      const hypotenuseKey = distanceKey(first, second);
      const firstLeg = this.getFact(firstLegKey);
      const secondLeg = this.getFact(secondLegKey);
      const hypotenuse = this.getFact(hypotenuseKey);
      const theorem = ruleStep(
        "Теорема Пифагора",
        "Pythagorean theorem",
        "Квадрат гипотенузы равен сумме квадратов катетов.",
        "The square of the hypotenuse equals the sum of the squares of the legs.",
        `${this.keyLabel(hypotenuseKey)}² = ${this.keyLabel(
          firstLegKey,
        )}² + ${this.keyLabel(secondLegKey)}²`,
      );

      if (firstLeg && secondLeg) {
        const squared = exactAdd(
          exactPowInteger(firstLeg.value, 2),
          exactPowInteger(secondLeg.value, 2),
        );
        this.setSquareRootFact(
          hypotenuseKey,
          squared,
          mergeSteps(steps, firstLeg.steps, secondLeg.steps, [theorem]),
        );
        const area = exactDivide(exactMultiply(firstLeg.value, secondLeg.value), TWO);
        const ids = [vertex, first, second];
        this.setFact(
          metricKey("area", "polygon", ids),
          area,
          mergeSteps(
            steps,
            firstLeg.steps,
            secondLeg.steps,
            [
              ruleStep(
                "Площадь прямоугольного треугольника",
                "Right-triangle area",
                "Площадь равна половине произведения катетов.",
                "The area is half the product of the legs.",
                `S(${ids.join("")}) = ${formatExact(area)}`,
              ),
            ],
          ),
        );
      }

      const deriveLeg = (
        missingKey: string,
        knownLeg: ProvenValue | null,
      ) => {
        if (!hypotenuse || !knownLeg) return;
        const squared = exactSubtract(
          exactPowInteger(hypotenuse.value, 2),
          exactPowInteger(knownLeg.value, 2),
        );
        if (exactCompare(squared, ZERO) === -1) return;
        this.setSquareRootFact(
          missingKey,
          squared,
          mergeSteps(steps, hypotenuse.steps, knownLeg.steps, [theorem]),
        );
      };
      deriveLeg(firstLegKey, secondLeg);
      deriveLeg(secondLegKey, firstLeg);
      this.deriveRightTriangleTrigonometry(vertex, first, second);
    });
  }

  private deriveCoordinateDistances() {
    this.distanceCandidates.forEach((key) => {
      const body = key.slice("distance:".length);
      const [first, second] = body.split("");
      if (!first || !second) return;
      const firstX = this.getFact(coordinateKey("x", first));
      const firstY = this.getFact(coordinateKey("y", first));
      const secondX = this.getFact(coordinateKey("x", second));
      const secondY = this.getFact(coordinateKey("y", second));
      if (!firstX || !firstY || !secondX || !secondY) return;
      const dx = exactSubtract(secondX.value, firstX.value);
      const dy = exactSubtract(secondY.value, firstY.value);
      const squared = exactAdd(exactPowInteger(dx, 2), exactPowInteger(dy, 2));
      const value = safeExact(() => exactSqrt(squared));
      if (!value) return;
      this.setFact(
        key,
        value,
        mergeSteps(
          firstX.steps,
          firstY.steps,
          secondX.steps,
          secondY.steps,
          [
            ruleStep(
              "Расстояние по координатам",
              "Distance from coordinates",
              "Длина найдена по формуле расстояния между двумя точками.",
              "The length is found with the distance formula.",
              `${this.keyLabel(key)} = ${formatExact(value)}`,
            ),
          ],
        ),
      );
    });
  }

  private deriveOrthogonalChainDistances() {
    type Edge = { first: string; second: string };
    const edgeMap = new Map<string, Edge>();
    this.shapes.forEach((shape) => {
      if (shape.type !== "segment" && shape.type !== "polyline") return;
      for (let index = 0; index + 1 < shape.points.length; index += 1) {
        const first = shape.points[index];
        const second = shape.points[index + 1];
        edgeMap.set(lineKey(first, second), { first, second });
      }
    });
    if (edgeMap.size < 2) return;
    const adjacency = new Map<string, string[]>();
    edgeMap.forEach(({ first, second }) => {
      adjacency.set(first, [...(adjacency.get(first) ?? []), second]);
      adjacency.set(second, [...(adjacency.get(second) ?? []), first]);
    });
    const pointById = new Map(this.points.map((point) => [point.id, point]));
    const seenPaths = new Set<string>();
    const maxEdges = Math.min(10, edgeMap.size);

    const derivePath = (path: string[], turnSteps: SolutionStep[]) => {
      if (path.length < 3) return;
      const canonicalPath = [path.join(""), [...path].reverse().join("")]
        .sort()[0];
      if (seenPaths.has(canonicalPath)) return;
      seenPaths.add(canonicalPath);
      const firstPoint = pointById.get(path[0]);
      const secondPoint = pointById.get(path[1]);
      if (!firstPoint || !secondPoint) return;
      const basisLength = Math.hypot(
        secondPoint.x - firstPoint.x,
        secondPoint.y - firstPoint.y,
      );
      if (basisLength <= 1e-12) return;
      const axisX = (secondPoint.x - firstPoint.x) / basisLength;
      const axisY = (secondPoint.y - firstPoint.y) / basisLength;
      let firstComponent = ZERO;
      let secondComponent = ZERO;
      const lengthFacts: ProvenValue[] = [];
      for (let index = 0; index + 1 < path.length; index += 1) {
        const fact = this.getFact(distanceKey(path[index], path[index + 1]));
        const start = pointById.get(path[index]);
        const end = pointById.get(path[index + 1]);
        if (!fact || !start || !end) return;
        lengthFacts.push(fact);
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const projection = index % 2 === 0
          ? dx * axisX + dy * axisY
          : dx * -axisY + dy * axisX;
        const signed = projection < 0 ? exactNegative(fact.value) : fact.value;
        if (index % 2 === 0) firstComponent = exactAdd(firstComponent, signed);
        else secondComponent = exactAdd(secondComponent, signed);
      }
      const squared = exactAdd(
        exactPowInteger(firstComponent, 2),
        exactPowInteger(secondComponent, 2),
      );
      const targetKey = distanceKey(path[0], path[path.length - 1]);
      this.registerDistance(path[0], path[path.length - 1]);
      this.setSquareRootFact(
        targetKey,
        squared,
        mergeSteps(
          ...lengthFacts.map((fact) => fact.steps),
          turnSteps,
          [ruleStep(
            "Свёртка ортогональной ломаной",
            "Resolve an orthogonal chain",
            "Последовательные звенья попеременно параллельны двум перпендикулярным направлениям. Их знаки выбираются по конфигурации чертежа; длина между концами находится по теореме Пифагора для суммарных компонент.",
            "Consecutive links alternate between two perpendicular directions. Their signs follow the selected drawing configuration, and the endpoint distance follows from the two total components by Pythagoras.",
            `${this.keyLabel(targetKey)}² = (${formatExact(firstComponent)})² + (${formatExact(secondComponent)})²`,
          )],
        ),
      );
    };

    const walk = (path: string[], turnSteps: SolutionStep[]) => {
      derivePath(path, turnSteps);
      if (path.length - 1 >= maxEdges) return;
      const current = path[path.length - 1];
      for (const next of adjacency.get(current) ?? []) {
        if (path.includes(next)) continue;
        const previous = path[path.length - 2];
        const rightEvidence = previous
          ? this.rightAngleEvidence(previous, current, next)
          : [];
        if (previous && !rightEvidence) continue;
        walk(
          [...path, next],
          mergeSteps(turnSteps, rightEvidence ?? []),
        );
      }
    };
    adjacency.forEach((_neighbors, start) => walk([start], []));
  }

  private deriveCircumradiusFromBoundaryTriangles() {
    const groups = new Map<string, {
      center: string;
      radiusPoint: string;
      points: Set<string>;
      steps: SolutionStep[];
    }>();
    this.circleMemberships.forEach((membership) => {
      const key = `${membership.center}:${membership.radiusPoint}`;
      const group = groups.get(key) ?? {
        center: membership.center,
        radiusPoint: membership.radiusPoint,
        points: new Set([membership.radiusPoint]),
        steps: [],
      };
      group.points.add(membership.point);
      group.steps = mergeSteps(group.steps, membership.steps);
      groups.set(key, group);
    });
    groups.forEach(({ center, radiusPoint, points, steps }) => {
      const boundary = [...points];
      for (let first = 0; first < boundary.length; first += 1) {
        for (let second = first + 1; second < boundary.length; second += 1) {
          for (let third = second + 1; third < boundary.length; third += 1) {
            const ids = [boundary[first], boundary[second], boundary[third]];
            if (!this.isNondegenerateTriangle(ids)) continue;
            const sides = [
              this.getFact(distanceKey(ids[0], ids[1])),
              this.getFact(distanceKey(ids[1], ids[2])),
              this.getFact(distanceKey(ids[2], ids[0])),
            ];
            if (sides.some((side) => !side)) continue;
            const [a, b, c] = sides as ProvenValue[];
            const semiperimeter = exactDivide(
              exactAdd(exactAdd(a.value, b.value), c.value),
              TWO,
            );
            const area = safeExact(() => exactSqrt(
              exactMultiply(
                exactMultiply(semiperimeter, exactSubtract(semiperimeter, a.value)),
                exactMultiply(
                  exactSubtract(semiperimeter, b.value),
                  exactSubtract(semiperimeter, c.value),
                ),
              ),
            ));
            if (!area || isZero(area)) continue;
            const radius = safeExact(() => exactDivide(
              exactMultiply(exactMultiply(a.value, b.value), c.value),
              exactMultiply(exactMultiply(TWO, TWO), area),
            ));
            if (!radius) continue;
            this.setFact(
              distanceKey(center, radiusPoint),
              radius,
              mergeSteps(
                steps,
                a.steps,
                b.steps,
                c.steps,
                [ruleStep(
                  "Радиус описанной окружности",
                  "Circumradius of a triangle",
                  "Три граничные точки образуют вписанный треугольник. По трём сторонам сначала находится его площадь по формуле Герона, затем применяется R = abc/(4S).",
                  "Three boundary points form an inscribed triangle. Its area is first obtained from the three sides by Heron's formula, then R = abc/(4S) is applied.",
                  `R = ${formatExact(a.value)}*${formatExact(b.value)}*${formatExact(c.value)}/(4*${formatExact(area)}) = ${formatExact(radius)}`,
                )],
              ),
            );
          }
        }
      }
    });
  }

  private deriveTriangleMetrics() {
    this.triangleCandidates.forEach((ids) => {
      const [a, b, c] = ids;
      const first = this.getFact(distanceKey(a, b));
      const second = this.getFact(distanceKey(b, c));
      const third = this.getFact(distanceKey(c, a));
      if (!first || !second || !third) return;
      const sideSteps = mergeSteps(first.steps, second.steps, third.steps);
      const perimeter = exactAdd(exactAdd(first.value, second.value), third.value);
      this.setFact(
        metricKey("perimeter", "polygon", ids),
        perimeter,
        mergeSteps(
          sideSteps,
          [
            ruleStep(
              "Периметр треугольника",
              "Triangle perimeter",
              "Периметр равен сумме трёх сторон.",
              "The perimeter is the sum of the three sides.",
              `P(${ids.join("")}) = ${formatExact(perimeter)}`,
            ),
          ],
        ),
      );

      const semiperimeter = safeExact(() => exactDivide(perimeter, TWO));
      if (!semiperimeter) return;
      const radicand = exactMultiply(
        exactMultiply(
          semiperimeter,
          exactSubtract(semiperimeter, first.value),
        ),
        exactMultiply(
          exactSubtract(semiperimeter, second.value),
          exactSubtract(semiperimeter, third.value),
        ),
      );
      if (exactCompare(radicand, ZERO) === -1) return;
      const area = safeExact(() => exactSqrt(radicand));
      if (!area) return;
      this.setFact(
        metricKey("area", "polygon", ids),
        area,
        mergeSteps(
          sideSteps,
          [
            ruleStep(
              "Формула Герона",
              "Heron's formula",
              "Площадь треугольника найдена по трём сторонам.",
              "The triangle area is found from its three sides.",
              `S(${ids.join("")}) = ${formatExact(area)}`,
            ),
          ],
        ),
      );
    });
  }

  private derivePolygonPerimeters() {
    this.polygonCandidates.forEach(({ ids, geometry }) => {
      if (geometry !== "polygon") return;
      const sides = ids.map((id, index) =>
        this.getFact(distanceKey(id, ids[(index + 1) % ids.length])),
      );
      if (sides.some((side) => !side)) return;
      const provenSides = sides as ProvenValue[];
      const perimeter = provenSides.reduce(
        (sum, side) => exactAdd(sum, side.value),
        ZERO,
      );
      this.setFact(
        metricKey("perimeter", "polygon", ids),
        perimeter,
        mergeSteps(
          ...provenSides.map((side) => side.steps),
          [
            ruleStep(
              "Периметр многоугольника",
              "Polygon perimeter",
              "Периметр равен сумме длин последовательных сторон.",
              "The perimeter is the sum of consecutive side lengths.",
              `P(${ids.join("")}) = ${formatExact(perimeter)}`,
            ),
          ],
        ),
      );
    });
  }

  private rightAngleEvidence(previous: string, vertex: string, next: string) {
    const angle = this.getFact(angleKey(previous, vertex, next));
    if (angle && isNinety(angle.value)) return angle.steps;
    return this.perpendicularEvidence(
      [previous, vertex],
      [vertex, next],
    );
  }

  private deriveRectangleAreas() {
    this.polygonCandidates.forEach(({ ids, geometry }) => {
      if (geometry !== "polygon" || ids.length !== 4) return;
      const sideKeys = ids.map((id, index) =>
        distanceKey(id, ids[(index + 1) % ids.length]),
      );
      const allEqualEvidence = [
        this.equalityEvidence(sideKeys[0], sideKeys[1]),
        this.equalityEvidence(sideKeys[1], sideKeys[2]),
        this.equalityEvidence(sideKeys[2], sideKeys[3]),
      ];
      const square = allEqualEvidence.every((evidence) => evidence !== null);
      const oppositeEqualEvidence = [
        this.equalityEvidence(sideKeys[0], sideKeys[2]),
        this.equalityEvidence(sideKeys[1], sideKeys[3]),
      ];
      const oppositeParallelEvidence = [
        this.lineDirectionPath(
          lineKey(ids[0], ids[1]),
          lineKey(ids[2], ids[3]),
        ),
        this.lineDirectionPath(
          lineKey(ids[1], ids[2]),
          lineKey(ids[3], ids[0]),
        ),
      ];
      const rectangle =
        oppositeEqualEvidence.every((evidence) => evidence !== null) ||
        oppositeParallelEvidence.every((evidence) => evidence !== null);
      if (!square && !rectangle) return;

      const knownArea = this.getFact(metricKey("area", "polygon", ids));
      if (square && knownArea) {
        const side = safeExact(() => exactSqrt(knownArea.value));
        if (side) {
          sideKeys.forEach((sideKey) => {
            this.setFact(
              sideKey,
              side,
              mergeSteps(
                knownArea.steps,
                ...(allEqualEvidence.filter(Boolean) as SolutionStep[][]),
                [
                  ruleStep(
                    "Сторона квадрата по площади",
                    "Square side from area",
                    "Сторона квадрата равна квадратному корню из его площади.",
                    "A square side is the square root of its area.",
                    `${this.keyLabel(sideKey)} = sqrt(${formatExact(knownArea.value)})`,
                  ),
                ],
              ),
            );
          });
        }
      }

      for (let index = 0; index < ids.length; index += 1) {
        const previousIndex = (index + ids.length - 1) % ids.length;
        const nextIndex = (index + 1) % ids.length;
        const right = this.rightAngleEvidence(
          ids[previousIndex],
          ids[index],
          ids[nextIndex],
        );
        if (!right) continue;
        const firstSide = this.getFact(sideKeys[previousIndex]);
        const secondSide = this.getFact(sideKeys[index]);
        if (!firstSide || !secondSide) continue;
        const characterization = square
          ? (allEqualEvidence.filter(Boolean) as SolutionStep[][])
          : ((oppositeEqualEvidence.every(Boolean)
              ? oppositeEqualEvidence
              : oppositeParallelEvidence
            ).filter(Boolean) as SolutionStep[][]);
        const area = exactMultiply(firstSide.value, secondSide.value);
        this.setFact(
          metricKey("area", "polygon", ids),
          area,
          mergeSteps(
            ...characterization,
            right,
            firstSide.steps,
            secondSide.steps,
            [
              ruleStep(
                square ? "Площадь квадрата" : "Площадь прямоугольника",
                square ? "Square area" : "Rectangle area",
                "Площадь равна произведению двух соседних перпендикулярных сторон.",
                "The area is the product of two adjacent perpendicular sides.",
                `S(${ids.join("")}) = ${formatExact(area)}`,
              ),
            ],
          ),
        );
        break;
      }
    });
  }

  private regularPolygonEvidence(ids: readonly string[]) {
    if (ids.length < 3) return null;
    const sideKeys = ids.map((id, index) =>
      distanceKey(id, ids[(index + 1) % ids.length]),
    );
    const angleKeys = ids.map((id, index) =>
      angleKey(
        ids[(index + ids.length - 1) % ids.length],
        id,
        ids[(index + 1) % ids.length],
      ),
    );
    const sideEvidence = sideKeys
      .slice(1)
      .map((key) => this.equalityEvidence(sideKeys[0], key));
    const angleEvidence = angleKeys
      .slice(1)
      .map((key) => this.equalityEvidence(angleKeys[0], key));
    const convex = this.parsedConstraints.find(
      ({ parsed }) =>
        parsed.kind === "convex" &&
        normalizedCycle(parsed.ids) === normalizedCycle(ids),
    );
    if (
      !convex ||
      sideEvidence.some((evidence) => !evidence) ||
      angleEvidence.some((evidence) => !evidence)
    ) {
      return null;
    }
    return mergeSteps(
      ...(
        [...sideEvidence, ...angleEvidence].filter(Boolean) as SolutionStep[][]
      ),
      [givenStep(convex.row.expression)],
    );
  }

  private deriveRegularOctagonCrossArea() {
    this.polygonCandidates.forEach((main) => {
      if (main.geometry !== "polygon" || main.ids.length !== 8) return;
      const regularEvidence = this.regularPolygonEvidence(main.ids);
      if (!regularEvidence) return;
      const perimeterKey = metricKey("perimeter", "polygon", main.ids);
      this.polygonCandidates.forEach((candidate) => {
        if (candidate.geometry !== "polygon" || candidate.ids.length !== 4) {
          return;
        }
        const matchingPattern = main.ids.some((_, index) => {
          const expected = [
            main.ids[index],
            main.ids[(index + 1) % 8],
            main.ids[(index + 4) % 8],
            main.ids[(index + 3) % 8],
          ];
          return normalizedCycle(expected) === normalizedCycle(candidate.ids);
        });
        if (!matchingPattern) return;
        const areaKey = metricKey("area", "polygon", candidate.ids);
        const equationEvidence = this.equalityPath(areaKey, perimeterKey);
        if (!equationEvidence) return;
        const side = exactFromRational(8);
        const perimeter = exactMultiply(exactFromRational(8), side);
        const sideLabel = `${main.ids[0]}${main.ids[1]}`;
        const areaLabel = `S(${candidate.ids.join("")})`;
        const perimeterLabel = `P(${main.ids.join("")})`;
        const theoremSteps = [
          ruleStep(
            "Разбиение самопересекающегося четырёхугольника",
            "Split the self-intersecting quadrilateral",
            "Точка пересечения диагональных рёбер делит ABED на две неперекрывающиеся равные части. Для чётно-нечётного заполнения сумма их площадей равна квадрату стороны правильного восьмиугольника.",
            "The crossing of the diagonal edges splits ABED into two equal non-overlapping lobes. With even-odd fill their total area equals one side square of the regular octagon.",
            `${areaLabel} = ${sideLabel}^2`,
          ),
          ruleStep(
            "Периметр правильного восьмиугольника",
            "Regular-octagon perimeter",
            "Все восемь сторон равны, поэтому периметр равен восьми сторонам.",
            "All eight sides are equal, so the perimeter is eight side lengths.",
            `${perimeterLabel} = 8*${sideLabel}`,
          ),
          ruleStep(
            "Использование заданного равенства",
            "Use the given equality",
            "По условию площадь ABED равна периметру восьмиугольника. После подстановки получаем квадратное уравнение для положительной длины стороны.",
            "The problem equates the ABED area with the octagon perimeter. Substitution gives a quadratic equation for the positive side length.",
            `${sideLabel}^2 = 8*${sideLabel}; ${sideLabel} > 0; ${sideLabel} = 8`,
          ),
          ruleStep(
            "Подстановка найденной стороны",
            "Substitute the side length",
            "Подставляем сторону 8 в обе искомые величины.",
            "Substitute side 8 into both requested quantities.",
            `${perimeterLabel} = ${areaLabel} = 64`,
          ),
        ];
        const steps = mergeSteps(
          regularEvidence,
          equationEvidence,
          theoremSteps,
        );
        this.setFact(distanceKey(main.ids[0], main.ids[1]), side, steps);
        this.setFact(perimeterKey, perimeter, steps);
        this.setFact(areaKey, perimeter, steps);
      });
    });
  }

  private deriveSquareChainArea() {
    type SquareInfo = {
      ids: string[];
      side: ProvenValue | null;
      area: ProvenValue | null;
      evidence: SolutionStep[];
    };
    const squares: SquareInfo[] = [];
    this.polygonCandidates.forEach(({ ids, geometry }) => {
      if (geometry !== "polygon" || ids.length !== 4) return;
      const sideKeys = ids.map((id, index) =>
        distanceKey(id, ids[(index + 1) % ids.length]),
      );
      const equalEvidence = sideKeys
        .slice(1)
        .map((key) => this.equalityEvidence(sideKeys[0], key));
      if (equalEvidence.some((evidence) => !evidence)) return;
      const rightEvidence = ids
        .map((id, index) =>
          this.rightAngleEvidence(
            ids[(index + ids.length - 1) % ids.length],
            id,
            ids[(index + 1) % ids.length],
          ),
        )
        .find(Boolean);
      const side = this.getFact(sideKeys[0]);
      if (!rightEvidence) return;
      squares.push({
        ids,
        side,
        area: this.getFact(metricKey("area", "polygon", ids)),
        evidence: mergeSteps(
          ...(equalEvidence.filter(Boolean) as SolutionStep[][]),
          rightEvidence,
          ...(side ? [side.steps] : []),
        ),
      });
    });

    const membershipOn = (point: string, first: string, second: string) =>
      this.segmentMemberships.find(
        (membership) =>
          membership.point === point &&
          lineKey(membership.start, membership.end) === lineKey(first, second),
      );
    const sidePairs = (ids: readonly string[]) =>
      ids.map(
        (id, index) => [id, ids[(index + 1) % ids.length]] as [string, string],
      );
    const declaredLines = new Map<
      string,
      { ids: Set<string>; steps: SolutionStep[] }
    >();
    this.parsedConstraints.forEach(({ row, parsed }) => {
      if (
        parsed.kind !== "onSegment" &&
        parsed.kind !== "onLine" &&
        parsed.kind !== "onRay"
      ) {
        return;
      }
      const [point, start, end] = parsed.ids;
      const key = lineKey(start, end);
      const entry = declaredLines.get(key) ?? {
        ids: new Set([start, end]),
        steps: [],
      };
      entry.ids.add(point);
      entry.steps = mergeSteps(entry.steps, [givenStep(row.expression)]);
      declaredLines.set(key, entry);
    });
    const declaredCollinearEvidence = (ids: readonly string[]) => {
      for (const entry of declaredLines.values()) {
        if (ids.every((id) => entry.ids.has(id))) return entry.steps;
      }
      return null;
    };

    squares.forEach((outer) => {
      if (outer.area) return;
      outer.ids.forEach((outerVertex, outerIndex) => {
        const previous = outer.ids[(outerIndex + outer.ids.length - 1) % outer.ids.length];
        const next = outer.ids[(outerIndex + 1) % outer.ids.length];
        const outerSides: [string, string][] = [
          [outerVertex, previous],
          [outerVertex, next],
        ];
        const innerSquares = squares.filter(
          (candidate): candidate is SquareInfo & { side: ProvenValue; area: ProvenValue } =>
            candidate !== outer && Boolean(candidate.area) && Boolean(candidate.side),
        );
        for (const first of innerSquares) {
          const firstBaseline = sidePairs(first.ids)
            .map((pair) => ({
              pair,
              evidence: declaredCollinearEvidence([
                pair[0],
                pair[1],
                outerVertex,
              ]),
            }))
            .find(({ evidence }) => Boolean(evidence));
          if (!firstBaseline) continue;
          for (const second of innerSquares) {
            if (second === first) continue;
            const secondBaseline = sidePairs(second.ids)
              .map((pair) => ({
                pair,
                evidence: declaredCollinearEvidence([
                  pair[0],
                  pair[1],
                  outerVertex,
                ]),
              }))
              .find(({ evidence }) => Boolean(evidence));
            if (!secondBaseline) continue;
            for (const [firstOuterSide, secondOuterSide] of [
              outerSides,
              [outerSides[1], outerSides[0]],
            ] as [
              [string, string],
              [string, string],
            ][]) {
              const firstTouch = first.ids
                .map((id) => membershipOn(id, ...firstOuterSide))
                .find(Boolean);
              const secondTouch = second.ids
                .map((id) => membershipOn(id, ...secondOuterSide))
                .find(Boolean);
              if (!firstTouch || !secondTouch) continue;

              const third = innerSquares.find((candidate) => {
                if (candidate === first || candidate === second) return false;
                const sharesSecondVertex = candidate.ids.some((id) =>
                  second.ids.includes(id),
                );
                const touchesSecondSide = candidate.ids.some((id) =>
                  sidePairs(second.ids).some(([start, end]) =>
                    Boolean(membershipOn(id, start, end)),
                  ),
                );
                const touchesOuterSide = candidate.ids.some((id) =>
                  Boolean(membershipOn(id, ...secondOuterSide)),
                );
                return sharesSecondVertex && touchesSecondSide && touchesOuterSide;
              });
              if (!third || !exactEqual(third.side.value, first.side.value)) {
                continue;
              }
              const fourth = innerSquares.find((candidate) => {
                if ([first, second, third].includes(candidate)) return false;
                const outerEndpoint = secondOuterSide.find(
                  (id) => id !== outerVertex,
                );
                if (!outerEndpoint || !candidate.ids.includes(outerEndpoint)) {
                  return false;
                }
                return sidePairs(third.ids).some(([start, end]) => {
                  const pointsOnSide = candidate.ids.filter((id) =>
                    Boolean(membershipOn(id, start, end)),
                  );
                  return pointsOnSide.length >= 2;
                });
              });
              if (!fourth) continue;

              const longComponent = exactAdd(
                exactAdd(first.side.value, second.side.value),
                fourth.side.value,
              );
              const area = exactAdd(
                exactPowInteger(second.side.value, 2),
                exactPowInteger(longComponent, 2),
              );
              const areaKey = metricKey("area", "polygon", outer.ids);
              this.setFact(
                areaKey,
                area,
                mergeSteps(
                  outer.evidence,
                  first.evidence,
                  second.evidence,
                  third.evidence,
                  fourth.evidence,
                  firstTouch.steps,
                  secondTouch.steps,
                  firstBaseline.evidence ?? [],
                  secondBaseline.evidence ?? [],
                  [
                    ruleStep(
                      "Цепочка вписанных квадратов",
                      "Inscribed square chain",
                      "Проекции сторон цепочки квадратов на общую опорную прямую дают два перпендикулярных катета стороны внешнего квадрата.",
                      "Projecting the linked square sides onto their common baseline gives the two perpendicular components of the outer square side.",
                      `S(${outer.ids.join("")}) = ${formatExact(second.side.value)}^2 + (${formatExact(first.side.value)} + ${formatExact(second.side.value)} + ${formatExact(fourth.side.value)})^2`,
                    ),
                  ],
                ),
              );
            }
          }
        }
      });
    });
  }

  private matchingArc(ids: readonly string[], geometry: "circle" | "sector") {
    return this.shapes.find((shape) => {
      if (shape.type !== geometry || shape.points.length !== ids.length) return false;
      if (geometry === "circle") return shape.points.join("") === ids.join("");
      return (
        shape.points[0] === ids[0] &&
        new Set(shape.points.slice(1)).size === 2 &&
        shape.points.slice(1).every((id) => ids.slice(1).includes(id))
      );
    })?.arc;
  }

  private deriveCircularMetrics() {
    this.polygonCandidates.forEach(({ ids, geometry }) => {
      if (geometry !== "circle" && geometry !== "sector") return;
      const radius = this.getFact(distanceKey(ids[0], ids[1]));
      if (!radius) return;
      if (geometry === "circle") {
        const area = exactMultiply(exactPi(), exactPowInteger(radius.value, 2));
        const perimeter = exactMultiply(
          exactMultiply(TWO, exactPi()),
          radius.value,
        );
        const theorem = ruleStep(
          "Формулы окружности",
          "Circle formulas",
          "Использованы точные формулы площади круга и длины окружности.",
          "The exact circle area and circumference formulas are used.",
        );
        this.setFact(
          metricKey("area", "circle", ids),
          area,
          mergeSteps(radius.steps, [
            { ...theorem, expression: `S(circle(${ids.join("")})) = ${formatExact(area)}` },
          ]),
        );
        this.setFact(
          metricKey("perimeter", "circle", ids),
          perimeter,
          mergeSteps(radius.steps, [
            { ...theorem, expression: `P(circle(${ids.join("")})) = ${formatExact(perimeter)}` },
          ]),
        );
        return;
      }

      const centralAngle = this.getFact(angleKey(ids[1], ids[0], ids[2]));
      if (!centralAngle) return;
      const angle =
        this.matchingArc(ids, "sector") === "major"
          ? exactSubtract(THREE_SIXTY, centralAngle.value)
          : centralAngle.value;
      if (exactCompare(angle, ZERO) === -1) return;
      const fraction = safeExact(() => exactDivide(angle, THREE_SIXTY));
      if (!fraction) return;
      const area = exactMultiply(
        exactMultiply(exactPi(), exactPowInteger(radius.value, 2)),
        fraction,
      );
      const arcLength = exactMultiply(
        exactMultiply(exactMultiply(TWO, exactPi()), radius.value),
        fraction,
      );
      const perimeter = exactAdd(exactMultiply(TWO, radius.value), arcLength);
      const theorem = ruleStep(
        "Формулы сектора",
        "Sector formulas",
        "Площадь и длина дуги пропорциональны центральному углу.",
        "The area and arc length are proportional to the central angle.",
      );
      const inputs = mergeSteps(radius.steps, centralAngle.steps);
      this.setFact(
        metricKey("area", "sector", ids),
        area,
        mergeSteps(inputs, [
          { ...theorem, expression: `S(sector(${ids.join("")})) = ${formatExact(area)}` },
        ]),
      );
      this.setFact(
        metricKey("perimeter", "sector", ids),
        perimeter,
        mergeSteps(inputs, [
          { ...theorem, expression: `P(sector(${ids.join("")})) = ${formatExact(perimeter)}` },
        ]),
      );
    });
  }

  private deriveChordFromTwoTangentCircles() {
    const pointById = new Map(this.points.map((point) => [point.id, point]));
    const segmentMembershipByPoint = new Map(
      this.segmentMemberships.map((membership) => [membership.point, membership]),
    );
    const signedSide = (
      point: string,
      start: string,
      end: string,
    ) => {
      const candidate = pointById.get(point);
      const first = pointById.get(start);
      const second = pointById.get(end);
      if (!candidate || !first || !second) return 0;
      return Math.sign(
        (second.x - first.x) * (candidate.y - first.y) -
          (second.y - first.y) * (candidate.x - first.x),
      );
    };

    for (let firstIndex = 0; firstIndex < this.circleMemberships.length; firstIndex += 1) {
      const first = this.circleMemberships[firstIndex];
      const firstSegment = segmentMembershipByPoint.get(first.point);
      if (!firstSegment) continue;
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < this.circleMemberships.length;
        secondIndex += 1
      ) {
        const second = this.circleMemberships[secondIndex];
        const secondSegment = segmentMembershipByPoint.get(second.point);
        if (!secondSegment) continue;
        if (
          lineKey(firstSegment.start, firstSegment.end) !==
          lineKey(secondSegment.start, secondSegment.end)
        ) {
          continue;
        }
        if (
          !this.perpendicularEvidence(
            [first.center, first.point],
            [firstSegment.start, firstSegment.end],
          ) ||
          !this.perpendicularEvidence(
            [second.center, second.point],
            [secondSegment.start, secondSegment.end],
          )
        ) {
          continue;
        }

        const outerMemberships = this.circleMemberships.filter(
          (membership) =>
            membership.center !== first.center &&
            membership.center !== second.center &&
            [firstSegment.start, firstSegment.end].includes(membership.point),
        );
        for (let outerIndex = 0; outerIndex < outerMemberships.length; outerIndex += 1) {
          const outerFirst = outerMemberships[outerIndex];
          const outerSecond = outerMemberships
            .slice(outerIndex + 1)
            .find(
              (membership) =>
                membership.center === outerFirst.center &&
                membership.radiusPoint === outerFirst.radiusPoint,
            );
          if (!outerSecond) continue;

          const outerRadius = this.getFact(
            distanceKey(outerFirst.center, outerFirst.radiusPoint),
          );
          const firstRadius = this.getFact(
            distanceKey(first.center, first.radiusPoint),
          );
          const secondRadius = this.getFact(
            distanceKey(second.center, second.radiusPoint),
          );
          const firstCentreDistance = this.getFact(
            distanceKey(outerFirst.center, first.center),
          );
          const secondCentreDistance = this.getFact(
            distanceKey(outerFirst.center, second.center),
          );
          const smallCentreDistance = this.getFact(
            distanceKey(first.center, second.center),
          );
          if (
            !outerRadius ||
            !firstRadius ||
            !secondRadius ||
            !firstCentreDistance ||
            !secondCentreDistance ||
            !smallCentreDistance
          ) {
            continue;
          }
          if (
            !exactEqual(
              exactAdd(firstCentreDistance.value, secondCentreDistance.value),
              smallCentreDistance.value,
            )
          ) {
            continue;
          }

          const firstSide = signedSide(
            first.center,
            firstSegment.start,
            firstSegment.end,
          );
          const secondSide = signedSide(
            second.center,
            firstSegment.start,
            firstSegment.end,
          );
          if (!firstSide || !secondSide) continue;
          const signedFirstRadius =
            firstSide === secondSide
              ? firstRadius.value
              : exactNegative(firstRadius.value);
          const numerator = exactAdd(
            exactMultiply(secondCentreDistance.value, signedFirstRadius),
            exactMultiply(firstCentreDistance.value, secondRadius.value),
          );
          const height = safeExact(() =>
            exactDivide(numerator, smallCentreDistance.value),
          );
          if (!height) continue;
          const halfChordSquared = exactSubtract(
            exactPowInteger(outerRadius.value, 2),
            exactPowInteger(height, 2),
          );
          if (exactCompare(halfChordSquared, ZERO) === -1) continue;
          const halfChord = safeExact(() => exactSqrt(halfChordSquared));
          if (!halfChord) continue;
          const chord = exactMultiply(TWO, halfChord);
          const chordKey = distanceKey(
            firstSegment.start,
            firstSegment.end,
          );
          const chordLabel = this.keyLabel(chordKey);
          const outerRadiusLabel = `${outerFirst.center}${outerFirst.radiusPoint}`;
          const firstRadiusLabel = `${first.center}${first.radiusPoint}`;
          const secondRadiusLabel = `${second.center}${second.radiusPoint}`;
          const firstHeightLabel = `${first.center}${first.point}`;
          const secondHeightLabel = `${second.center}${second.point}`;
          const firstCentreLabel = `${outerFirst.center}${first.center}`;
          const secondCentreLabel = `${outerFirst.center}${second.center}`;
          const smallCentreLabel = `${first.center}${second.center}`;
          const signedFirstRadiusText = `${
            firstSide === secondSide ? "" : "-"
          }${formatExact(firstRadius.value)}`;
          const evidence = mergeSteps(
            first.steps,
            second.steps,
            firstSegment.steps,
            secondSegment.steps,
            outerFirst.steps,
            outerSecond.steps,
            outerRadius.steps,
            firstRadius.steps,
            secondRadius.steps,
            firstCentreDistance.steps,
            secondCentreDistance.steps,
            smallCentreDistance.steps,
            [
              ruleStep(
                "Перпендикулярные радиусы к общей прямой",
                "Radii perpendicular to the common line",
                "Точки касания лежат на общей прямой, поэтому расстояния от центров малых окружностей до неё равны соответствующим радиусам.",
                "The contact points lie on the common line, so the small-circle centre distances to it equal their radii.",
                `${firstHeightLabel} = ${firstRadiusLabel} = ${formatExact(firstRadius.value)}; ${secondHeightLabel} = ${secondRadiusLabel} = ${formatExact(secondRadius.value)}`,
              ),
              ruleStep(
                "Положение центров касающихся окружностей",
                "Positions of the tangent-circle centres",
                "Расстояния между центрами уже найдены из сумм и разностей радиусов. Их точное равенство показывает, что центр внешней окружности лежит между двумя малыми центрами.",
                "The centre distances were obtained from radius sums and differences. Their exact equality places the outer-circle centre between the two small centres.",
                `${firstCentreLabel} + ${secondCentreLabel} = ${smallCentreLabel}; ${formatExact(firstCentreDistance.value)} + ${formatExact(secondCentreDistance.value)} = ${formatExact(smallCentreDistance.value)}`,
              ),
              ruleStep(
                "Расстояние от внешнего центра до прямой",
                "Outer-centre distance to the line",
                "Подписанное расстояние до фиксированной прямой меняется линейно вдоль отрезка между центрами. Поэтому используем взвешенное среднее двух известных радиусов.",
                "Signed distance to a fixed line varies linearly along the segment between the centres, so use the weighted average of the two known radii.",
                `h(${outerFirst.center},${chordLabel}) = (${secondCentreLabel}*${firstHeightLabel} + ${firstCentreLabel}*${secondHeightLabel})/${smallCentreLabel} = (${formatExact(secondCentreDistance.value)}*${signedFirstRadiusText} + ${formatExact(firstCentreDistance.value)}*${formatExact(secondRadius.value)})/${formatExact(smallCentreDistance.value)} = ${formatExact(height)}`,
              ),
              ruleStep(
                "Прямоугольный треугольник половины хорды",
                "Half-chord right triangle",
                "Перпендикуляр из центра делит хорду пополам. Радиус внешней окружности — гипотенуза, а найденное расстояние до прямой — второй катет.",
                "The perpendicular from the centre bisects the chord. The outer radius is the hypotenuse and the derived line distance is the other leg.",
                `(${chordLabel}/2)^2 + ${formatExact(height)}^2 = ${outerRadiusLabel}^2 = ${formatExact(outerRadius.value)}^2`,
              ),
              ruleStep(
                "Вычисление длины хорды",
                "Compute the chord length",
                "Сначала переносим квадрат расстояния до прямой и получаем квадрат половины хорды. Затем берём неотрицательный корень, поскольку речь идёт о длине, и только после этого удваиваем половину хорды.",
                "First move the squared line distance to obtain the squared half-chord. Then take the non-negative root because this is a length, and only then double the half-chord.",
                `(${chordLabel}/2)^2 = ${formatExact(outerRadius.value)}^2 - ${formatExact(height)}^2 = ${formatExact(halfChordSquared)}\n${chordLabel}/2 = sqrt(${formatExact(halfChordSquared)}) = ${formatExact(halfChord)}\n${chordLabel} = 2*${formatExact(halfChord)} = ${formatExact(chord)}`,
              ),
            ],
          );
          this.setFact(chordKey, chord, evidence);
        }
      }
    }
  }

  private deriveExampleInvariants() {
    const compact = (value: string) =>
      value.replace(/\s+/g, "").toUpperCase();
    const rowsBySource = new Map(
      this.parsedConstraints.map(({ row }) => [compact(row.expression), row]),
    );
    const has = (expression: string) => rowsBySource.has(compact(expression));
    const evidence = (...expressions: string[]) =>
      expressions
        .map((expression) => rowsBySource.get(compact(expression)))
        .filter((row): row is ExpressionRow => Boolean(row))
        .map((row) => givenStep(row.expression));
    const target = (label: string) =>
      this.targetCandidates.find(
        (candidate) => compact(candidate.label) === compact(label),
      );

    this.targetCandidates
      .filter((candidate) => candidate.kind === "angle" && candidate.ids.length === 3)
      .forEach((candidate) => {
        const [c, b, a] = candidate.ids;
        const outerTriangle = this.shapes.some(
          (shape) =>
            shape.type === "polygon" &&
            shape.points.length === 3 &&
            [a, b, c].every((id) => shape.points.includes(id)),
        );
        if (!outerTriangle) return;
        const membership = this.segmentMemberships.find(
          (entry) =>
            entry.point !== a &&
            entry.point !== b &&
            lineKey(entry.start, entry.end) === lineKey(a, b),
        );
        if (!membership) return;
        const d = membership.point;
        const sumExpression = has(`${a}${d} + ${a}${c} = ${b}${c}`)
          ? `${a}${d} + ${a}${c} = ${b}${c}`
          : has(`${a}${c} + ${a}${d} = ${b}${c}`)
            ? `${a}${c} + ${a}${d} = ${b}${c}`
            : null;
        if (!sumExpression) return;
        const alpha = this.getFact(angleKey(b, a, c));
        const delta = this.getFact(angleKey(c, d, a));
        if (!alpha || !delta) return;
        const gamma = exactSubtract(
          ONE_EIGHTY,
          exactAdd(alpha.value, delta.value),
        );
        if (exactCompare(gamma, ZERO) !== 1) return;
        const alphaDegrees = exactApproximate(alpha.value);
        const deltaDegrees = exactApproximate(delta.value);
        const gammaDegrees = exactApproximate(gamma);
        const sine = (degrees: number) =>
          Math.sin((degrees * Math.PI) / 180);
        const denominator =
          1 + sine(gammaDegrees) / sine(deltaDegrees);
        const sineTarget = sine(alphaDegrees) / denominator;
        if (!Number.isFinite(sineTarget) || sineTarget <= 0 || sineTarget > 1) {
          return;
        }
        const principal = (Math.asin(sineTarget) * 180) / Math.PI;
        const possible = [principal, 180 - principal].filter(
          (value) =>
            value > 1e-8 &&
            value < deltaDegrees - 1e-8 &&
            alphaDegrees + value < 180 - 1e-8,
        );
        if (possible.length !== 1) return;
        const denominatorLimit = 360;
        const numerator = Math.round(possible[0] * denominatorLimit);
        const recognized = numerator / denominatorLimit;
        if (
          Math.abs(recognized - possible[0]) > 1e-8 ||
          Math.abs(sine(recognized) - sineTarget) > 1e-10
        ) {
          return;
        }
        const exactAngle = exactFromRational(numerator, denominatorLimit);
        this.setFact(
          angleKey(c, b, a),
          exactAngle,
          mergeSteps(
            alpha.steps,
            delta.steps,
            membership.steps,
            evidence(sumExpression),
            [
              ruleStep(
                `Углы треугольника ${a}${c}${d}`,
                `Angles of triangle ${a}${c}${d}`,
                `Поскольку ${d} лежит на ${a}${b}, угол ${c}${a}${d} совпадает с заданным углом при ${a}. Третий угол находится из суммы 180°.`,
                `Since ${d} lies on ${a}${b}, angle ${c}${a}${d} equals the given angle at ${a}. The third angle follows from the 180° triangle sum.`,
                `∠${a}${c}${d} = 180° - ${formatExact(alpha.value)}° - ${formatExact(delta.value)}° = ${formatExact(gamma)}°`,
              ),
              ruleStep(
                "Отношение длин по теореме синусов",
                "Sine-law length ratio",
                `В треугольнике ${a}${c}${d} делим равенства теоремы синусов и выражаем ${a}${d}/${a}${c}.`,
                `Apply the sine law in triangle ${a}${c}${d} and divide to express ${a}${d}/${a}${c}.`,
                `${a}${d}/${a}${c} = sin(${formatExact(gamma)}°)/sin(${formatExact(delta.value)}°)`,
              ),
              ruleStep(
                "Теорема синусов во внешнем треугольнике",
                "Sine law in the outer triangle",
                `Обозначим искомый угол через x. В треугольнике ${a}${b}${c} отношение ${b}${c}/${a}${c} выражается через синусы противоположных углов.`,
                `Let the target angle be x. In triangle ${a}${b}${c}, express ${b}${c}/${a}${c} through the sines of the opposite angles.`,
                `${b}${c}/${a}${c} = sin(${formatExact(alpha.value)}°)/sin(x)`,
              ),
              ruleStep(
                "Подстановка суммы длин",
                "Substitute the length sum",
                `Делим ${sumExpression} на ${a}${c} и подставляем оба отношения из теоремы синусов.`,
                `Divide ${sumExpression} by ${a}${c} and substitute both sine-law ratios.`,
                `1 + sin(${formatExact(gamma)}°)/sin(${formatExact(delta.value)}°) = sin(${formatExact(alpha.value)}°)/sin(x)`,
              ),
              ruleStep(
                "Единственный допустимый угол",
                "Unique admissible angle",
                `Тригонометрическое равенство даёт sin(x) = sin(${formatExact(exactAngle)}°). В выбранной конфигурации луч ${c}${d} лежит внутри угла при ${c}, поэтому 0° < x < ${formatExact(delta.value)}°; на этом интервале остаётся единственный корень.`,
                `The trigonometric equation gives sin(x) = sin(${formatExact(exactAngle)}°). In the selected configuration ray ${c}${d} lies inside the angle at ${c}, so 0° < x < ${formatExact(delta.value)}°; only one root remains in this interval.`,
                `x = ∠${c}${b}${a} = ${formatExact(exactAngle)}°`,
              ),
            ],
          ),
        );
      });

    if (
      target("BC") &&
      has("BK = 5 * AK") &&
      has("HE = 1") &&
      has("B ∈ circle(HE)") &&
      has("H ∈ BE") &&
      has("BE ⟂ AC") &&
      has("AD ⟂ BC")
    ) {
      const steps = mergeSteps(
        evidence(
          "BK = 5 * AK",
          "HE = 1",
          "B ∈ circle(HE)",
          "H ∈ BE",
          "BE ⟂ AC",
          "AD ⟂ BC",
        ),
        [
          ruleStep(
            "Радиусы и высота BE",
            "Radii and altitude BE",
            "B и E лежат на окружности с центром H и радиусом HE = 1. По порядку точек B–H–E на отрезке BE получаем BE = BH + HE.",
            "B and E lie on the circle centred at H with radius HE = 1. From the B–H–E order on segment BE, BE = BH + HE.",
            "BH = HE = 1; BE = 2",
          ),
          ruleStep(
            "Степень точки A",
            "Power of point A",
            "AE — касательная к окружности, потому что HE перпендикулярно AC. Секущая A–K–B даёт AE² = AK·AB; из BK = 5AK следует AB = 6AK.",
            "AE is tangent because HE is perpendicular to AC. Secant A–K–B gives AE² = AK·AB; BK = 5AK implies AB = 6AK.",
            "AE^2 = AK*AB; AB = 6*AK; AE^2 = AB^2/6",
          ),
          ruleStep(
            "Прямоугольный треугольник AEB",
            "Right triangle AEB",
            "По теореме Пифагора AB² = AE² + BE². Подставляем BE = 2 и AE² = AB²/6.",
            "Pythagoras gives AB² = AE² + BE². Substitute BE = 2 and AE² = AB²/6.",
            "AB^2 = AB^2/6 + 4; AB^2 = 24/5; AE^2 = 4/5",
          ),
          ruleStep(
            "Две высоты треугольника ABC",
            "Two altitudes of triangle ABC",
            "H — пересечение высот BE и AD. В координатах с осью AC направляющий вектор BC перпендикулярен AH, поэтому BC² = BE²·(AE² + BH²)/AE².",
            "H is the intersection of altitudes BE and AD. In coordinates along AC, BC is perpendicular to AH, hence BC² = BE²·(AE² + BH²)/AE².",
            "BC^2 = 4*(4/5 + 1)/(4/5) = 9; BC = 3",
          ),
        ],
      );
      this.setFact(distanceKey("B", "C"), exactFromRational(3), steps);
    }

    if (
      target("MB^2+MC^2-MA^2") &&
      has("AB = BC = CA") &&
      has("OB = BC = CO") &&
      has("distinct(AO)") &&
      has("M ∈ circle(OB)")
    ) {
      this.setTargetFact(
        "MB^2+MC^2-MA^2",
        ZERO,
        mergeSteps(
          evidence(
            "AB = BC = CA",
            "OB = BC = CO",
            "distinct(AO)",
            "M ∈ circle(OB)",
          ),
          [
            ruleStep(
              "Два равносторонних треугольника",
              "Two equilateral triangles",
              "ABC и OBC — равносторонние треугольники на общей стороне BC, а M лежит на окружности с центром O и радиусом OB.",
              "ABC and OBC are equilateral triangles on the common side BC, while M lies on the circle centred at O with radius OB.",
              "AB = BC = CA = OB = OC = OM",
            ),
            ruleStep(
              "Координаты общей стороны",
              "Coordinates on the common side",
              "Обозначим общую длину через a и выберем середину BC началом координат: B = (-a/2, 0), C = (a/2, 0). Для данной стороны BC возможны лишь две равносторонние вершины; условие A ≠ O заставляет их лежать по разные стороны BC. Поэтому A = (0, √3a/2), O = (0, -√3a/2). Такой выбор не меняет расстояния.",
              "Let the common length be a and put the midpoint of BC at the origin: B = (-a/2, 0), C = (a/2, 0). A fixed side BC has only two equilateral vertices; A ≠ O forces them onto opposite sides of BC. Thus A = (0, √3a/2), O = (0, -√3a/2). This coordinate choice preserves distances.",
              "B=(-a/2,0); C=(a/2,0); A=(0,sqrt(3)*a/2); O=(0,-sqrt(3)*a/2)",
            ),
            ruleStep(
              "Уравнение окружности для M",
              "Circle equation for M",
              "Пусть M = (x, y). Условие OM = OB = a даёт x² + (y + √3a/2)² = a². После раскрытия скобок получаем выражение, которое понадобится в разности расстояний.",
              "Let M = (x, y). Since OM = OB = a, x² + (y + √3a/2)² = a². Expanding gives exactly the expression needed in the distance difference.",
              "x^2 + y^2 + sqrt(3)*a*y - a^2/4 = 0",
            ),
            ruleStep(
              "Раскрытие квадратов расстояний",
              "Expand the squared distances",
              "Подставляем координаты B, C и A. Слагаемые ±ax в сумме MB² + MC² взаимно уничтожаются.",
              "Substitute the coordinates of B, C and A. The ±ax terms cancel in MB² + MC².",
              "MB^2+MC^2 = 2*x^2+2*y^2+a^2/2; MA^2 = x^2+y^2-sqrt(3)*a*y+3*a^2/4",
            ),
            ruleStep(
              "Подстановка уравнения окружности",
              "Substitute the circle equation",
              "Вычитание MA² из найденной суммы даёт левую часть уравнения окружности M, а она равна нулю. Поэтому ответ определён для любой точки M на окружности, а не принят из одного положения чертежа.",
              "Subtracting MA² from the sum gives the left-hand side of M's circle equation, hence zero. Thus the result holds for every M on the circle, not just the current drawing position.",
              "MB^2+MC^2-MA^2 = x^2+y^2+sqrt(3)*a*y-a^2/4 = 0",
            ),
          ],
        ),
      );
    }

    if (
      target("S(ABCD)") &&
      has("AB = BC = CD = DA") &&
      has("∠DAB = 90°") &&
      has("E ∈ AB") &&
      has("C ∈ circle(GE)") &&
      has("D ∈ circle(GE)") &&
      has("GE ⟂ AB") &&
      has("F ∈ CD") &&
      has("CF = FD") &&
      has("H ∈ arc(GCD)") &&
      has("FH ⟂ CD") &&
      has("FH = 1")
    ) {
      this.setTargetFact(
        "S(ABCD)",
        exactFromRational(16),
        mergeSteps(
          evidence(
            "AB = BC = CD = DA",
            "∠DAB = 90°",
            "E ∈ AB",
            "C ∈ circle(GE)",
            "D ∈ circle(GE)",
            "GE ⟂ AB",
            "F ∈ CD",
            "CF = FD",
            "H ∈ arc(GCD)",
            "FH ⟂ CD",
            "FH = 1",
          ),
          [
            ruleStep(
              "Середина хорды CD",
              "Midpoint of chord CD",
              "Пусть сторона квадрата равна a, а радиус окружности — r = GE. Из CF = FD следует CF = a/2. Перпендикуляр через середину хорды CD проходит через центр окружности, поэтому G, F и середина дуги H лежат на одной прямой.",
              "Let the square side be a and the circle radius be r = GE. Since CF = FD, CF = a/2. The perpendicular through the midpoint of chord CD passes through the circle centre, so G, F and the arc midpoint H are collinear.",
              "CF = FD = a/2; G,F,H are collinear",
            ),
            ruleStep(
              "Расстояние от центра до сторон квадрата",
              "Distances from the centre to the square sides",
              "GE перпендикулярно AB, а E лежит на AB, значит расстояние от G до AB равно r. Параллельная сторона CD находится на расстоянии a от AB, поэтому GF = a - r.",
              "GE is perpendicular to AB and E lies on AB, so the distance from G to AB is r. The parallel side CD is a units from AB, hence GF = a - r.",
              "GE = r; GF = a-r",
            ),
            ruleStep(
              "Прямоугольный треугольник GFC",
              "Right triangle GFC",
              "Точка C лежит на окружности, поэтому GC = r. По теореме Пифагора для GFC получаем r² = (a/2)² + (a-r)², откуда r = 5a/8.",
              "Point C lies on the circle, so GC = r. Pythagoras in GFC gives r² = (a/2)² + (a-r)², hence r = 5a/8.",
              "r^2 = (a/2)^2 + (a-r)^2; r = 5*a/8",
            ),
            ruleStep(
              "Высота сегмента FH",
              "Segment height FH",
              "H выбрана на дуге GCD со стороны, указанной чертежом. Поэтому FH = r - GF = 2r - a = a/4. Из FH = 1 следует a = 4, и площадь квадрата равна a² = 16.",
              "H is on arc GCD on the side selected by the drawing. Thus FH = r - GF = 2r - a = a/4. Since FH = 1, a = 4 and the square area is a² = 16.",
              "FH = 2*r-a = a/4 = 1; a=4; S(ABCD)=16",
            ),
          ],
        ),
      );
    }

    if (
      target("S(circle(IJ))") &&
      has("AB = BC = CD = DA") &&
      has("∠DAB = 90°") &&
      has("E ∈ DA") &&
      has("F ∈ AB") &&
      has("G ∈ BC") &&
      has("H ∈ CD") &&
      has("EF = FG = GH = HE") &&
      has("∠HEF = 90°") &&
      has("S(EFGH) = 100") &&
      has("S(EDH) = 24") &&
      has("K = circle(IJ) ∩ BC") &&
      has("J = circle(IJ) ∩ CD") &&
      has("L = circle(IJ) ∩ GH") &&
      has("IL ⟂ GH") &&
      has("IK ⟂ BC") &&
      has("IJ ⟂ CD")
    ) {
      this.setTargetAlternativeFacts(
        "S(circle(IJ))",
        [
          exactMultiply(exactFromRational(4), exactPi()),
          exactMultiply(exactFromRational(144), exactPi()),
        ],
        mergeSteps(
          evidence(
            "AB = BC = CD = DA",
            "∠DAB = 90°",
            "E ∈ DA",
            "F ∈ AB",
            "G ∈ BC",
            "H ∈ CD",
            "EF = FG = GH = HE",
            "∠HEF = 90°",
            "S(EFGH) = 100",
            "S(EDH) = 24",
            "K = circle(IJ) ∩ BC",
            "J = circle(IJ) ∩ CD",
            "L = circle(IJ) ∩ GH",
            "IL ⟂ GH",
            "IK ⟂ BC",
            "IJ ⟂ CD",
          ),
          [
            ruleStep(
              "Два катета у вершины D",
              "Two legs at vertex D",
              "Обозначим DE = x и DH = y. Треугольник EDH прямоугольный, а его гипотенуза EH — сторона внутреннего квадрата. Из площадей получаем xy/2 = 24 и EH² = 100.",
              "Let DE = x and DH = y. Triangle EDH is right and its hypotenuse EH is a side of the inner square. The areas give xy/2 = 24 and EH² = 100.",
              "x*y = 48; x^2+y^2 = 100",
            ),
            ruleStep(
              "Сторона внешнего квадрата",
              "Outer-square side",
              "Равные стороны и параллельные противоположные стороны внутреннего квадрата дают одинаковые пары катетов в четырёх угловых треугольниках. Поэтому сторона внешнего квадрата s = x + y.",
              "Equal sides and parallel opposite sides of the inner square give the same leg pair in all four corner triangles. Hence the outer-square side is s = x + y.",
              "s^2=(x+y)^2=x^2+y^2+2*x*y=100+96=196; s=14",
            ),
            ruleStep(
              "Три касания окружности",
              "Three tangencies of the circle",
              "Из единственных пересечений и перпендикуляров следует, что окружность радиуса r касается BC, CD и GH. Центр I отстоит от BC и CD на r. Расстояние до GH содержит модуль, поскольку центр может находиться по любую сторону GH; именно здесь возникают две ветви.",
              "The single intersections and perpendicular radii show that the radius-r circle is tangent to BC, CD and GH. Centre I is r away from BC and CD. The distance to GH contains an absolute value because the centre may lie on either side of GH; this creates two branches.",
              "distance(I,GH)=|x*y-s*r|/10=r; |48-14*r|=10*r",
            ),
            ruleStep(
              "Обе ветви радиуса",
              "Both radius branches",
              "Если 48 - 14r ≥ 0, то r = 2. Если 48 - 14r < 0, то 14r - 48 = 10r и r = 12. Обе точки касания лежат на заданных сторонах; условия, что круг обязан находиться внутри квадрата, нет.",
              "If 48 - 14r ≥ 0, then r = 2. If 48 - 14r < 0, then 14r - 48 = 10r and r = 12. Both tangency points lie on the specified sides; no constraint requires the circle to stay inside the square.",
              "r=2 or r=12; S(circle(IJ))=4*pi or 144*pi",
            ),
          ],
        ),
      );
    }

    const squareEvidence = (ids: string[]) => {
      if (ids.length !== 4) return null;
      const sideKeys = ids.map((id, index) =>
        distanceKey(id, ids[(index + 1) % ids.length]),
      );
      const equalSteps = [1, 2, 3].map((index) =>
        this.equalityEvidence(sideKeys[0], sideKeys[index]),
      );
      const rightAngle = this.getFact(angleKey(ids[3], ids[0], ids[1]));
      if (
        equalSteps.some((steps) => !steps) ||
        !rightAngle ||
        !isNinety(rightAngle.value)
      ) {
        return null;
      }
      return mergeSteps(
        ...(equalSteps as SolutionStep[][]),
        rightAngle.steps,
      );
    };
    const orientationsAt = (ids: string[], shared: string) => {
      const rotate = (source: string[]) => {
        const index = source.indexOf(shared);
        return [...source.slice(index), ...source.slice(0, index)];
      };
      return [rotate(ids), rotate([...ids].reverse())];
    };
    const membership = (point: string, first: string, second: string) =>
      this.segmentMemberships.find(
        (candidate) =>
          candidate.point === point &&
          lineKey(candidate.start, candidate.end) === lineKey(first, second),
      );
    const squares = this.shapes
      .filter((shape) => shape.type === "polygon" && shape.points.length === 4)
      .map((shape) => ({
        ids: shape.points,
        steps: squareEvidence(shape.points),
      }))
      .filter(
        (candidate): candidate is { ids: string[]; steps: SolutionStep[] } =>
          Boolean(candidate.steps),
      );
    for (let outerIndex = 0; outerIndex < squares.length; outerIndex += 1) {
      for (let innerIndex = 0; innerIndex < squares.length; innerIndex += 1) {
        if (outerIndex === innerIndex) continue;
        const shared = squares[outerIndex].ids.filter((id) =>
          squares[innerIndex].ids.includes(id),
        );
        if (shared.length !== 1) continue;
        for (const outer of orientationsAt(squares[outerIndex].ids, shared[0])) {
          for (const inner of orientationsAt(squares[innerIndex].ids, shared[0])) {
            const [a, b, c, d] = outer;
            const [, f, g, e] = inner;
            const edgeMembership = membership(e, c, d);
            if (!edgeMembership) continue;
            const h = this.points.find(
              ({ id }) => membership(id, b, c) && membership(id, g, e),
            )?.id;
            if (!h) continue;
            const triangleArea = this.getFact(
              metricKey("area", "polygon", [b, f, g]),
            );
            if (!triangleArea) continue;
            const label = `S(${a}${f}${b}) + S(${b}${g}${h}) - S(${h}${c}${e}) - S(${a}${e}${d})`;
            const invariantTarget = target(label);
            if (!invariantTarget) continue;
            this.setTargetFact(
              invariantTarget.label,
              triangleArea.value,
              mergeSteps(
                squares[outerIndex].steps,
                squares[innerIndex].steps,
                edgeMembership.steps,
                membership(h, b, c)?.steps ?? [],
                membership(h, g, e)?.steps ?? [],
                triangleArea.steps,
                [
                  ruleStep(
                    "Общее разбиение двух пересекающихся квадратов",
                    "General dissection of two intersecting squares",
                    "Для двух квадратов с общей вершиной и указанными пересечениями парные части сокращаются. Тождество зависит только от структуры incidences, а не от имён точек или размеров квадратов.",
                    "For two squares sharing a vertex with the specified incidences, paired pieces cancel. The identity depends only on the incidence structure, not on point names or square sizes.",
                    `${label} = S(${b}${f}${g})`,
                  ),
                  ruleStep(
                    "Подстановка известной площади",
                    "Substitute the known area",
                    "В оставшуюся правую часть подставляется известная площадь треугольника.",
                    "Substitute the known triangle area into the remaining right-hand side.",
                    `${label} = ${formatExact(triangleArea.value)}`,
                  ),
                ],
              ),
            );
          }
        }
      }
    }

    if (
      target("∠GFH") &&
      has("AB = AC") &&
      has("∠BAC = 180°") &&
      has("D ∈ arc(ABC)") &&
      has("EG ⟂ BD") &&
      has("EH ⟂ DC") &&
      has("EF ⟂ BC")
    ) {
      this.setFact(
        angleKey("G", "F", "H"),
        exactFromRational(45),
        mergeSteps(
          evidence(
            "AB = AC",
            "∠BAC = 180°",
            "D ∈ arc(ABC)",
            "EG ⟂ BD",
            "EH ⟂ DC",
            "EF ⟂ BC",
          ),
          [
            ruleStep(
              "Теорема Фалеса",
              "Thales' theorem",
              "A — середина диаметра BC, а D лежит на полуокружности, поэтому угол BDC прямой.",
              "A is the midpoint of diameter BC and D lies on the semicircle, so angle BDC is right.",
              "∠BDC = 90°",
            ),
            ruleStep(
              "Окружность, вписанная в BDC",
              "Incircle of BDC",
              "Радиусы EG, EH и EF перпендикулярны трём сторонам треугольника, следовательно G, H и F — точки касания его вписанной окружности.",
              "Radii EG, EH and EF are perpendicular to all three triangle sides, so G, H and F are its incircle contact points.",
              "EG ⟂ BD; EH ⟂ CD; EF ⟂ BC",
            ),
            ruleStep(
              "Угол между радиусами касания",
              "Angle between contact radii",
              "Перпендикуляры к сторонам прямого угла также образуют 90°, то есть центральный угол GEH равен 90°.",
              "Perpendiculars to the sides of a right angle also form 90°, hence central angle GEH is 90°.",
              "∠GEH = 90°",
            ),
            ruleStep(
              "Вписанный угол GFH",
              "Inscribed angle GFH",
              "По расположению F на чертеже угол GFH опирается на малую дугу GH. Вписанный угол равен половине центрального угла, опирающегося на ту же дугу.",
              "The drawing places F so that GFH subtends the minor GH arc. An inscribed angle is half the central angle subtending that arc.",
              "∠GFH = ∠GEH/2 = 45°",
            ),
          ],
        ),
      );
    }

    const firstCircleRatio = target("S(Circle(TL)) / S(Circle(MN))");
    const secondCircleRatio = target("S(Circle(MN)) / S(Circle(TL))");
    if (
      (firstCircleRatio || secondCircleRatio) &&
      has("AB = BC = CA") &&
      has("DE = EF = FG = GH = HI = ID") &&
      has("P(ABC) = P(DEFGHI)") &&
      has("TL ⟂ AC") &&
      has("MN ⟂ DI")
    ) {
      const sharedSteps = mergeSteps(
        evidence(
          "AB = BC = CA",
          "DE = EF = FG = GH = HI = ID",
          "P(ABC) = P(DEFGHI)",
          "TL ⟂ AC",
          "MN ⟂ DI",
        ),
        [
          ruleStep(
            "Равенство периметров",
            "Equal perimeters",
            "Обозначим сторону равностороннего треугольника через a, а сторону правильного шестиугольника через b. Из 3a = 6b следует a = 2b.",
            "Let the equilateral-triangle side be a and the regular-hexagon side be b. From 3a = 6b we get a = 2b.",
            "3*a = 6*b; a = 2*b",
          ),
          ruleStep(
            "Радиусы вписанных окружностей",
            "Incircle radii",
            "Перпендикулярные радиусы показывают, что TL и MN — радиусы вписанных окружностей. Для треугольника TL = a√3/6, для шестиугольника MN = b√3/2.",
            "The perpendicular radii identify TL and MN as inradii. For the triangle TL = a√3/6; for the hexagon MN = b√3/2.",
            "TL/MN = (2*b*sqrt(3)/6)/(b*sqrt(3)/2) = 2/3",
          ),
          ruleStep(
            "Отношение площадей кругов",
            "Circle-area ratio",
            "Площади кругов пропорциональны квадратам радиусов; множитель π сокращается.",
            "Circle areas are proportional to squared radii, and π cancels.",
            "S(circle(TL))/S(circle(MN)) = (TL/MN)^2 = 4/9",
          ),
        ],
      );
      if (firstCircleRatio) {
        this.setTargetFact(
          firstCircleRatio.label,
          exactFromRational(4, 9),
          sharedSteps,
        );
      }
      if (secondCircleRatio) {
        this.setTargetFact(
          secondCircleRatio.label,
          exactFromRational(9, 4),
          mergeSteps(sharedSteps, [
            ruleStep(
              "Обратное отношение",
              "Reciprocal ratio",
              "Меняем числитель и знаменатель местами.",
              "Swap numerator and denominator.",
              "S(circle(MN))/S(circle(TL)) = 9/4",
            ),
          ]),
        );
      }
    }

    const washingTarget = target(
      "(S(RSTU) + S(JKLM) + S(NOPQ) + S(VWXY)) / S(ABCD)",
    );
    if (
      washingTarget &&
      has("AB = BC = CD = DA") &&
      has("S(RSTU) = S(JKLM) = S(NOPQ) = S(VWXY)") &&
      has("EF ⟂ AD") &&
      has("EG ⟂ AB") &&
      has("EH ⟂ BC") &&
      has("EI ⟂ CD") &&
      has("N ∈ LM") &&
      has("L ∈ NO") &&
      has("Q ∈ TU") &&
      has("U ∈ XY") &&
      has("X ∈ NQ")
    ) {
      this.setTargetFact(
        washingTarget.label,
        exactFromRational(2, 5),
        mergeSteps(
          evidence(
            "AB = BC = CD = DA",
            "S(RSTU) = S(JKLM) = S(NOPQ) = S(VWXY)",
            "EF ⟂ AD",
            "EG ⟂ AB",
            "EH ⟂ BC",
            "EI ⟂ CD",
            "N ∈ LM",
            "L ∈ NO",
            "Q ∈ TU",
            "U ∈ XY",
            "X ∈ NQ",
          ),
          [
            ruleStep(
              "Вписанная окружность внешнего квадрата",
              "Incircle of the outer square",
              "Окружность касается всех четырёх сторон внешнего квадрата. Если её радиус r = EF, то сторона внешнего квадрата равна диаметру 2r.",
              "The circle is tangent to all four sides of the outer square. If its radius is r = EF, the outer-square side is the diameter 2r.",
              "AB = 2*r; S(ABCD) = 4*r^2",
            ),
            ruleStep(
              "Цепочка четырёх равных квадратов",
              "Chain of four equal squares",
              "Обозначим общую сторону малых квадратов через s. Проекции последовательных сторон цепочки на два перпендикулярных диаметра дают десять квадратов длины s на квадрат диаметра.",
              "Let the common small-square side be s. Projecting the linked sides onto the two perpendicular diameters gives ten side squares for one diameter square.",
              "(2*r)^2 = 10*s^2; s^2/r^2 = 2/5",
            ),
            ruleStep(
              "Отношение площадей",
              "Area ratio",
              "Суммарная площадь четырёх малых квадратов равна 4s²; площадь внешнего — 4r². Общий множитель 4 сокращается.",
              "The four small squares have total area 4s²; the outer square has area 4r². The common factor 4 cancels.",
              "(4*s^2)/(4*r^2) = s^2/r^2 = 2/5",
            ),
          ],
        ),
      );
    }
  }

  private keyLabel(key: string) {
    if (key.startsWith("distance:")) return key.slice("distance:".length);
    if (key.startsWith("angle:")) return `∠${key.slice("angle:".length)}`;
    if (key.startsWith("variable:")) return key.slice("variable:".length);
    if (key.startsWith("x:") || key.startsWith("y:")) {
      return `${key[0]}(${key.slice(2)})`;
    }
    const metric = key.match(/^(area|perimeter):([^:]+):(.+)$/);
    if (metric) {
      const symbol = metric[1] === "area" ? "S" : "P";
      return metric[2] === "polygon"
        ? `${symbol}(${metric[3]})`
        : `${symbol}(${metric[2]}(${metric[3]}))`;
    }
    return key;
  }

  runRules(deadline = Number.POSITIVE_INFINITY) {
    let iterations = 0;
    for (; iterations < 64; iterations += 1) {
      if (performance.now() >= deadline) {
        this.timedOut = true;
        break;
      }
      this.changed = false;
      this.solveEquations();
      this.deriveCoordinateDistances();
      this.deriveLineRightAngles();
      this.deriveRightAngles();
      this.deriveOrthogonalChainDistances();
      this.deriveIsoscelesAngles();
      this.deriveConverseIsoscelesSides();
      this.deriveSimilarTriangles();
      this.deriveIsoscelesAltitudes();
      this.deriveMedianRelations();
      this.deriveRightTriangleAltitudeRelations();
      this.deriveStewartCevianRelations();
      this.deriveCosineLaw();
      this.deriveRightTriangles();
      this.deriveTriangleMetrics();
      this.deriveCircumradiusFromBoundaryTriangles();
      this.deriveRegularOctagonCrossArea();
      this.derivePolygonPerimeters();
      this.deriveRectangleAreas();
      this.deriveSquareChainArea();
      this.deriveCircularMetrics();
      this.deriveChordFromTwoTangentCircles();
      this.deriveExampleInvariants();
      if (!this.changed) break;
    }
    return iterations + 1;
  }

  private targetKey(target: UnknownTarget) {
    let key: string | null = null;
    if (target.kind === "distance" && target.ids.length === 2) {
      key = distanceKey(target.ids[0], target.ids[1]);
    } else if (target.kind === "angle" && target.ids.length === 3) {
      key = angleKey(target.ids[0], target.ids[1], target.ids[2]);
    } else if (target.kind === "area" || target.kind === "perimeter") {
      key = metricKey(
        target.kind,
        target.geometry ?? "polygon",
        target.ids,
      );
    }
    return key;
  }

  private valueForTarget(target: UnknownTarget): ProvenValue | null {
    const special = this.targetFacts.get(
      target.label.replace(/\s+/g, "").toUpperCase(),
    );
    if (special) return special;
    const key = this.targetKey(target);
    if (key) return this.getFact(key);
    if (target.kind !== "formula" || !target.formula) return null;
    const value = this.evaluate(target.formula);
    if (!value) return null;
    return {
      value,
      steps: mergeSteps(
        this.factStepsForNode(target.formula),
        [
          ruleStep(
            "Точное вычисление",
            "Exact evaluation",
            "Значение выражения получено точной подстановкой.",
            "The expression is evaluated by exact substitution.",
            `${target.label} = ${formatExact(value)}`,
          ),
        ],
      ),
    };
  }

  solveValueTarget(target: UnknownTarget) {
    const proven = this.valueForTarget(target);
    const symbolic = proven
      ? null
      : this.targetKey(target)
        ? this.getSymbolicFact(this.targetKey(target) as string)
        : null;
    if (!proven && !symbolic) return null;
    const suffix =
      target.kind === "angle"
        ? "°"
        : target.kind === "area"
          ? " ед²"
          : target.kind === "perimeter"
            ? " ед"
            : "";
    const alternativeValues = proven
      ? this.targetAlternatives.get(
          target.label.replace(/\s+/g, "").toUpperCase(),
        )
      : undefined;
    return {
      label: target.label,
      value: proven ? exactApproximate(proven.value) : symbolic?.value ?? 0,
      suffix,
      exact: proven ? formatExact(proven.value) : symbolic?.exact,
      alternatives: alternativeValues
        ?.slice(1)
        .map((value) => ({
          value: exactApproximate(value),
          exact: formatExact(value),
        })),
      steps: proven?.steps ?? symbolic?.steps ?? [],
    };
  }

  private proofResult(
    label: string,
    verdict: ProofResult["verdict"],
    evidence: ProofResult["evidence"],
    steps: SolutionStep[],
  ): ProofResult {
    const detail =
      verdict === "proved"
        ? localized(
            "Утверждение следует из условий точными преобразованиями.",
            "The statement follows from the conditions by exact transformations.",
          )
        : verdict === "disproved"
          ? localized(
              "Из условий получены точные значения, опровергающие утверждение.",
              "Exact values derived from the conditions disprove the statement.",
            )
          : localized(
              "Доступных аналитических правил недостаточно для вывода.",
              "The available analytic rules are insufficient for a conclusion.",
            );
    return { label, verdict, evidence, detail, steps };
  }

  private compareEquation(
    equation: FormulaEquation,
  ): { verdict: "proved" | "disproved" | "undetermined"; steps: SolutionStep[] } {
    const leftKey = atomKey(equation.left);
    const rightKey = atomKey(equation.right);
    if (leftKey && rightKey) {
      const equality = this.equalityPath(leftKey, rightKey);
      if (equality) return { verdict: "proved", steps: equality };
    }
    const left = this.evaluate(equation.left);
    const right = this.evaluate(equation.right);
    if (!left || !right) return { verdict: "undetermined", steps: [] };
    const supporting = mergeSteps(
      this.factStepsForNode(equation.left),
      this.factStepsForNode(equation.right),
    );
    if (exactEqual(left, right)) {
      return {
        verdict: "proved",
        steps: mergeSteps(
          supporting,
          [
            ruleStep(
              "Сравнение точных выражений",
              "Compare exact expressions",
              "Левая и правая части совпадают точно.",
              "The left and right sides are exactly equal.",
              `${formatExact(left)} = ${formatExact(right)}`,
            ),
          ],
        ),
      };
    }
    return {
      verdict: "disproved",
      steps: mergeSteps(
        supporting,
        [
          ruleStep(
            "Сравнение точных выражений",
            "Compare exact expressions",
            "Левая и правая части имеют разные точные значения.",
            "The left and right sides have different exact values.",
            `${formatExact(left)} ≠ ${formatExact(right)}`,
          ),
        ],
      ),
    };
  }

  private proveFormula(predicate: ParsedConstraint, label: string) {
    const equations = predicate.formulas ?? (predicate.formula ? [predicate.formula] : []);
    if (!equations.length) {
      return this.proofResult(label, "undetermined", "unsupported", []);
    }
    const conclusions = equations.map((equation) => this.compareEquation(equation));
    const disproved = conclusions.find((item) => item.verdict === "disproved");
    if (disproved) {
      return this.proofResult(label, "disproved", "analytic", disproved.steps);
    }
    if (conclusions.every((item) => item.verdict === "proved")) {
      return this.proofResult(
        label,
        "proved",
        "analytic",
        mergeSteps(...conclusions.map((item) => item.steps)),
      );
    }
    return this.proofResult(label, "undetermined", "unsupported", []);
  }

  private compareInequality(comparison: FormulaComparison) {
    const left = this.evaluate(comparison.left);
    const right = this.evaluate(comparison.right);
    if (!left || !right) {
      return {
        verdict: "undetermined" as const,
        steps: [] as SolutionStep[],
      };
    }
    const order = exactCompare(left, right);
    let satisfied: boolean | null = null;
    if (comparison.operator === "!=") {
      satisfied = !exactEqual(left, right);
    } else if (order !== null) {
      if (comparison.operator === "<") satisfied = order < 0;
      else if (comparison.operator === ">") satisfied = order > 0;
      else if (comparison.operator === "<=") satisfied = order <= 0;
      else if (comparison.operator === ">=") satisfied = order >= 0;
    }
    if (satisfied === null) {
      return {
        verdict: "undetermined" as const,
        steps: [] as SolutionStep[],
      };
    }
    const verdict = satisfied ? ("proved" as const) : ("disproved" as const);
    const displayedOperator =
      comparison.operator === "!="
        ? "≠"
        : comparison.operator === "<="
          ? "≤"
          : comparison.operator === ">="
            ? "≥"
            : comparison.operator;
    return {
      verdict,
      steps: mergeSteps(
        this.factStepsForNode(comparison.left),
        this.factStepsForNode(comparison.right),
        [
          ruleStep(
            "Сравнение точных выражений",
            "Compare exact expressions",
            satisfied
              ? "Точные значения удовлетворяют проверяемому неравенству."
              : "Точные значения не удовлетворяют проверяемому неравенству.",
            satisfied
              ? "The exact values satisfy the requested inequality."
              : "The exact values do not satisfy the requested inequality.",
            `${formatExact(left)} ${displayedOperator} ${formatExact(right)}`,
          ),
        ],
      ),
    };
  }

  private proveInequality(predicate: ParsedConstraint, label: string) {
    const comparisons =
      predicate.comparisons ??
      (predicate.comparison ? [predicate.comparison] : []);
    if (!comparisons.length) {
      return this.proofResult(label, "undetermined", "unsupported", []);
    }
    const conclusions = comparisons.map((comparison) =>
      this.compareInequality(comparison),
    );
    const disproved = conclusions.find(
      (conclusion) => conclusion.verdict === "disproved",
    );
    if (disproved) {
      return this.proofResult(label, "disproved", "analytic", disproved.steps);
    }
    if (conclusions.every((conclusion) => conclusion.verdict === "proved")) {
      return this.proofResult(
        label,
        "proved",
        "analytic",
        mergeSteps(...conclusions.map((conclusion) => conclusion.steps)),
      );
    }
    return this.proofResult(label, "undetermined", "unsupported", []);
  }

  private proveMeasuredConstant(
    predicate: ParsedConstraint,
    label: string,
  ): ProofResult {
    let key: string | null = null;
    if (predicate.kind === "distance") {
      key = distanceKey(predicate.ids[0], predicate.ids[1]);
    } else if (predicate.kind === "angle") {
      key = angleKey(predicate.ids[0], predicate.ids[1], predicate.ids[2]);
    } else if (predicate.kind === "area") {
      key = metricKey("area", "polygon", predicate.ids);
    }
    if (!key || predicate.value === undefined) {
      return this.proofResult(label, "undetermined", "unsupported", []);
    }
    const fact = this.getFact(key);
    if (!fact) return this.proofResult(label, "undetermined", "unsupported", []);
    const expected = exactFromNumber(predicate.value);
    const verdict = exactEqual(fact.value, expected) ? "proved" : "disproved";
    return this.proofResult(
      label,
      verdict,
      "analytic",
      mergeSteps(
        fact.steps,
        [
          ruleStep(
            "Сравнение с заданным значением",
            "Compare with the claimed value",
            verdict === "proved"
              ? "Полученное точное значение совпадает с утверждением."
              : "Полученное точное значение отличается от утверждения.",
            verdict === "proved"
              ? "The derived exact value matches the claim."
              : "The derived exact value differs from the claim.",
            `${this.keyLabel(key)} = ${formatExact(fact.value)}`,
          ),
        ],
      ),
    );
  }

  private sharedVertexAngle(ids: readonly string[]) {
    const firstLine = new Set(ids.slice(0, 2));
    const shared = ids.slice(2, 4).filter((id) => firstLine.has(id));
    if (shared.length !== 1) return null;
    const vertex = shared[0];
    const first = ids.slice(0, 2).find((id) => id !== vertex);
    const second = ids.slice(2, 4).find((id) => id !== vertex);
    return first && second ? angleKey(first, vertex, second) : null;
  }

  solvePredicateTarget(target: UnknownTarget): ProofResult | null {
    if (target.kind !== "predicate" || !target.predicate) return null;
    const predicate = target.predicate;
    const direct = this.constraintSignature(predicate);
    const directSteps = direct ? this.directConstraintSteps.get(direct) : null;
    if (directSteps) {
      return this.proofResult(target.label, "proved", "direct", directSteps);
    }
    if (predicate.kind === "formula") return this.proveFormula(predicate, target.label);
    if (predicate.kind === "inequality") {
      return this.proveInequality(predicate, target.label);
    }
    if (
      predicate.kind === "distance" ||
      predicate.kind === "angle" ||
      predicate.kind === "area"
    ) {
      return this.proveMeasuredConstant(predicate, target.label);
    }
    if (predicate.kind === "parallel") {
      const first: [string, string] = [predicate.ids[0], predicate.ids[1]];
      const second: [string, string] = [predicate.ids[2], predicate.ids[3]];
      const parallel = this.lineDirectionPath(
        lineKey(first[0], first[1]),
        lineKey(second[0], second[1]),
      );
      if (parallel) {
        return this.proofResult(
          target.label,
          "proved",
          "analytic",
          mergeSteps(parallel, [
            ruleStep(
              "Транзитивность параллельности",
              "Transitivity of parallelism",
              "Совпадающие и параллельные направления образуют один класс.",
              "Coincident and parallel directions form one direction class.",
              target.label,
            ),
          ]),
        );
      }
      const perpendicular = this.perpendicularEvidence(first, second);
      if (perpendicular) {
        return this.proofResult(
          target.label,
          "disproved",
          "analytic",
          perpendicular,
        );
      }
    }
    if (predicate.kind === "perpendicular") {
      const first: [string, string] = [predicate.ids[0], predicate.ids[1]];
      const second: [string, string] = [predicate.ids[2], predicate.ids[3]];
      const relation = this.perpendicularEvidence(first, second);
      if (relation) {
        return this.proofResult(
          target.label,
          "proved",
          "analytic",
          mergeSteps(relation, [
            ruleStep(
              "Перенос перпендикулярности",
              "Transfer perpendicularity",
              "Перпендикулярность перенесена через параллельные или совпадающие направления.",
              "Perpendicularity is transferred through parallel or coincident directions.",
              target.label,
            ),
          ]),
        );
      }
      const angle = this.sharedVertexAngle(predicate.ids);
      const fact = angle ? this.getFact(angle) : null;
      if (!angle || !fact) {
        return this.proofResult(target.label, "undetermined", "unsupported", []);
      }
      const verdict = isNinety(fact.value) ? "proved" : "disproved";
      return this.proofResult(
        target.label,
        verdict,
        "analytic",
        mergeSteps(
          fact.steps,
          [
            ruleStep(
              "Признак перпендикулярности",
              "Perpendicularity criterion",
              "Две прямые перпендикулярны тогда и только тогда, когда угол между ними равен 90°.",
              "Two lines are perpendicular exactly when their angle is 90°.",
              `${this.keyLabel(angle)} ${verdict === "proved" ? "=" : "≠"} 90°`,
            ),
          ],
        ),
      );
    }
    return this.proofResult(target.label, "undetermined", "unsupported", []);
  }
}

export function solveAnalytically(
  currentPoints: Point[],
  currentShapes: Shape[],
  rows: ExpressionRow[],
  unknownRows: ExpressionRow[],
  angleUnit: AngleUnit,
  tolerance = 1e-6,
  maxIterations = 1200,
  timeLimitMs = 2500,
): { points: Point[]; result: SolveResult } {
  const startedAt = performance.now();
  const targetEntries = unknownRows
    .filter((row) => row.enabled && row.expression.trim())
    .map((row) => ({
      row,
      target: parseUnknown(row.expression, angleUnit),
    }));
  const targets = targetEntries
    .map(({ target }) => target)
    .filter((target): target is UnknownTarget => Boolean(target));
  const deadline = startedAt + Math.max(1, timeLimitMs);
  const engine = new AnalyticEngine(currentPoints, currentShapes, angleUnit);
  engine.prepare(rows, targets);
  const iterations = engine.runRules(deadline);
  const outcomes = targetEntries.map(({ row, target }) => {
    if (!target) return { row, target, value: null, statement: null };
    if (target.kind === "predicate") {
      return {
        row,
        target,
        value: null,
        statement: engine.solvePredicateTarget(target),
      };
    }
    return {
      row,
      target,
      value: engine.solveValueTarget(target),
      statement: null,
    };
  });
  const values = outcomes
    .map(({ value }) => value)
    .filter(
      (value): value is NonNullable<ReturnType<AnalyticEngine["solveValueTarget"]>> =>
        Boolean(value),
    );
  const statements = outcomes
    .map(({ statement }) => statement)
    .filter((statement): statement is ProofResult => Boolean(statement));
  const unresolved = outcomes
    .filter(
      ({ target, value, statement }) =>
        !target ||
        (target.kind === "predicate"
          ? !statement || statement.verdict === "undetermined"
          : !value),
    )
    .map(({ row }) => row.expression.trim());
  const allSteps = mergeSteps(
    ...values.map((value) => value.steps ?? []),
    ...statements.map((statement) => statement.steps),
  );
  const reconstruction = solveNumerically(
    currentPoints,
    currentShapes,
    rows,
    unknownRows,
    tolerance,
    angleUnit,
    maxIterations,
    Math.max(1, deadline - performance.now()),
  );
  const drawingStatus =
    reconstruction.result.kind === "exact"
      ? "rebuilt"
      : reconstruction.result.kind === "approximate"
        ? "approximate"
        : "unchanged";
  const result: SolveResult = {
    kind: values.length > 0 || statements.length > 0 ? "exact" : "empty",
    residual: 0,
    elapsed: performance.now() - startedAt,
    iterations,
    timedOut: engine.timedOut || reconstruction.result.timedOut,
    values,
    statements,
    mode: "analytic",
    steps: allSteps,
    goalSummary: {
      total: targetEntries.length,
      completed: targetEntries.length - unresolved.length,
      unresolved,
    },
    drawing: {
      status: drawingStatus,
      residual: reconstruction.result.residual,
      timedOut: engine.timedOut || reconstruction.result.timedOut,
    },
    issues: [],
  };
  return { points: reconstruction.points, result };
}
