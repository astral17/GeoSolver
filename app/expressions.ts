import type {
  AngleUnit,
  ComparisonOperator,
  ExpressionRow,
  FormulaComparison,
  FormulaEquation,
  GeometryKind,
  IntersectionObject,
  MathNode,
  ParsedConstraint,
  Point,
  Shape,
  SolveResult,
  UnknownTarget,
  VariableDefinition,
} from "./domain";
import {
  angleDegrees,
  distance,
  geometryMetric,
  isAngleOnArc,
  matchingGeometryShape,
  orientation,
  pointMap,
  polygonArea,
  resolveArcEnd,
  segmentDistance,
  segmentsIntersect,
} from "./geometry";
import type { Locale } from "./i18n";
import { solveCoordinates } from "./solver";

export const trimNumber = (value: number, digits = 2) => {
  const fixed = value.toFixed(digits);
  return digits === 0 ? fixed : fixed.replace(/\.?0+$/, "");
};

function prepareMathSource(source: string) {
  return source
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/−/g, "-")
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/\\deg\b/gi, "°")
    .replace(
      /(-?(?:\d+(?:\.\d+)?|\.\d+))\s*°/g,
      (_, value) => `deg(${value})`,
    )
    .replace(/√\s*\(/g, "sqrt(")
    .replace(/∠\s*([A-Za-z])([A-Za-z])([A-Za-z])/g, (_, a, b, c) =>
      `ANGLE_${a}${b}${c}`.toUpperCase(),
    )
    .replace(
      /\b([xy])\s*\(\s*([A-Za-z])\s*\)/gi,
      (_, axis, id) => `COORD_${axis}_${id}`.toUpperCase(),
    )
    .replace(
      /\b([A-Za-z])\s*\.\s*([xy])\b/gi,
      (_, id, axis) => `COORD_${axis}_${id}`.toUpperCase(),
    )
    .replace(
      /\b(?:angle|угол)\s*\(\s*([A-Za-z])([A-Za-z])([A-Za-z])\s*\)/gi,
      (_, a, b, c) => `ANGLE_${a}${b}${c}`.toUpperCase(),
    )
    .replace(
      /\b(?:area|s)\s*\(\s*(circle|ellipse|sector|segment|circularsegment)\s*\(\s*([A-Za-z]{2,3})\s*\)\s*\)/gi,
      (_, geometry, ids) =>
        `AREA_${String(geometry).toUpperCase()}_${String(ids).toUpperCase()}`,
    )
    .replace(
      /\b(?:perimeter|perim|p)\s*\(\s*(circle|ellipse|sector|segment|circularsegment)\s*\(\s*([A-Za-z]{2,3})\s*\)\s*\)/gi,
      (_, geometry, ids) =>
        `PERIMETER_${String(geometry).toUpperCase()}_${String(ids).toUpperCase()}`,
    )
    .replace(
      /\b(?:area|s)\s*\(\s*((?:[A-Za-z]\s*,?\s*){3,})\)/gi,
      (_, ids) =>
        `AREA_${String(ids).replace(/[^A-Za-z]/g, "")}`.toUpperCase(),
    )
    .replace(
      /\b(?:perimeter|perim|p)\s*\(\s*((?:[A-Za-z]\s*,?\s*){3,})\)/gi,
      (_, ids) =>
        `PERIMETER_${String(ids).replace(/[^A-Za-z]/g, "")}`.toUpperCase(),
    )
    .replace(
      /\b(?:len|length)\s*\(\s*([A-Za-z])([A-Za-z])\s*\)/gi,
      (_, a, b) => `LEN_${a}${b}`.toUpperCase(),
    )
    .replace(/\b([A-Z])([A-Z])\b/g, (_, a, b) => `LEN_${a}${b}`)
    .replace(/π/g, "PI");
}

function tokenizeMath(source: string) {
  const tokens: string[] = [];
  let rest = source;
  while (rest.trim().length) {
    const match = rest.match(
      /^\s*(\d+(?:\.\d+)?|\.\d+|[A-Za-z_][A-Za-z0-9_]*|[()+\-*/^])/
    );
    if (!match) return null;
    tokens.push(match[1]);
    rest = rest.slice(match[0].length);
  }
  return tokens;
}

export function parseMathExpression(source: string): MathNode | null {
  const tokens = tokenizeMath(prepareMathSource(source));
  if (!tokens?.length) return null;
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];

  const parsePrimary = (): MathNode | null => {
    const token = take();
    if (!token) return null;
    if (token === "(") {
      const value = parseAdditive();
      if (!value || take() !== ")") return null;
      return value;
    }
    if (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(token)) {
      return { kind: "number", value: Number(token) };
    }
    if (/^LEN_[A-Z]{2}$/.test(token)) {
      return {
        kind: "measure",
        measure: "distance",
        ids: token.slice(4).split(""),
      };
    }
    if (/^ANGLE_[A-Z]{3}$/.test(token)) {
      return {
        kind: "measure",
        measure: "angle",
        ids: token.slice(6).split(""),
      };
    }
    if (/^AREA_[A-Z]{3,}$/.test(token)) {
      return {
        kind: "measure",
        measure: "area",
        ids: token.slice(5).split(""),
        geometry: "polygon",
      };
    }
    const circularMeasure = token.match(
      /^(AREA|PERIMETER)_(CIRCLE|ELLIPSE|SECTOR|SEGMENT|CIRCULARSEGMENT)_([A-Z]{2,3})$/,
    );
    if (circularMeasure) {
      const geometry =
        circularMeasure[2] === "SEGMENT" ||
        circularMeasure[2] === "CIRCULARSEGMENT"
          ? "circularSegment"
          : circularMeasure[2].toLowerCase();
      return {
        kind: "measure",
        measure:
          circularMeasure[1] === "AREA" ? "area" : "perimeter",
        ids: circularMeasure[3].split(""),
        geometry: geometry as GeometryKind,
      };
    }
    if (/^PERIMETER_[A-Z]{3,}$/.test(token)) {
      return {
        kind: "measure",
        measure: "perimeter",
        ids: token.slice(10).split(""),
        geometry: "polygon",
      };
    }
    if (/^COORD_[XY]_[A-Z]$/.test(token)) {
      return {
        kind: "measure",
        measure: token[6].toLowerCase() as "x" | "y",
        ids: [token[8]],
      };
    }
    if (token.toUpperCase() === "PI") {
      return { kind: "number", value: Math.PI };
    }
    const functionName = token.toLowerCase();
    if (
      ["sqrt", "abs", "sin", "cos", "tan", "deg", "rad"].includes(
        functionName,
      ) &&
      peek() === "("
    ) {
      take();
      const value = parseAdditive();
      if (!value || take() !== ")") return null;
      return {
        kind: "function",
        name: functionName as
          | "sqrt"
          | "abs"
          | "sin"
          | "cos"
          | "tan"
          | "deg"
          | "rad",
        value,
      };
    }
    if (/^[a-z][A-Za-z0-9_]*$/.test(token)) {
      return { kind: "variable", name: token };
    }
    return null;
  };

  const parseUnary = (): MathNode | null => {
    if (peek() === "+" || peek() === "-") {
      const operator = take() as "+" | "-";
      const value = parseUnary();
      return value ? { kind: "unary", operator, value } : null;
    }
    return parsePrimary();
  };

  const parsePower = (): MathNode | null => {
    const left = parseUnary();
    if (!left) return null;
    if (peek() === "^") {
      take();
      const right = parsePower();
      return right
        ? { kind: "binary", operator: "^", left, right }
        : null;
    }
    return left;
  };

  const parseMultiplicative = (): MathNode | null => {
    let left = parsePower();
    while (left && (peek() === "*" || peek() === "/")) {
      const operator = take() as "*" | "/";
      const right = parsePower();
      if (!right) return null;
      left = { kind: "binary", operator, left, right };
    }
    return left;
  };

  const parseAdditive = (): MathNode | null => {
    let left = parseMultiplicative();
    while (left && (peek() === "+" || peek() === "-")) {
      const operator = take() as "+" | "-";
      const right = parseMultiplicative();
      if (!right) return null;
      left = { kind: "binary", operator, left, right };
    }
    return left;
  };

  const result = parseAdditive();
  return result && position === tokens.length ? result : null;
}

function collectMathIds(node: MathNode, ids = new Set<string>()) {
  if (node.kind === "measure") {
    node.ids.forEach((id) => ids.add(id));
  } else if (node.kind === "unary" || node.kind === "function") {
    collectMathIds(node.value, ids);
  } else if (node.kind === "binary") {
    collectMathIds(node.left, ids);
    collectMathIds(node.right, ids);
  }
  return ids;
}

function parseFormulaEquation(source: string) {
  const parts = source.split("=");
  if (
    parts.length < 2 ||
    parts.some((part) => !part.trim()) ||
    source.includes("?")
  ) {
    return null;
  }
  const terms = parts.map((part) => parseMathExpression(part));
  if (terms.some((term) => !term)) return null;
  const nodes = terms as MathNode[];
  const ids: string[] = [];
  nodes.forEach((node) => {
    collectMathIds(node).forEach((id) => {
      if (!ids.includes(id)) ids.push(id);
    });
  });
  const equations = nodes.slice(1).map((right, index) => ({
    left: nodes[index],
    right,
    source: source.trim(),
  })) satisfies FormulaEquation[];
  return {
    equation: equations[0],
    equations,
    ids,
  };
}

function parseFormulaComparison(source: string) {
  if (source.includes("?")) return null;
  const parts = source.split(
    /\s*(<=|>=|!=|≠|≤|≥|<|>)\s*/,
  );
  if (
    parts.length < 3 ||
    parts.length % 2 === 0 ||
    parts.some((part) => !part.trim())
  ) {
    return null;
  }
  const nodes = parts
    .filter((_, index) => index % 2 === 0)
    .map((part) => parseMathExpression(part));
  if (nodes.some((node) => !node)) return null;
  const values = nodes as MathNode[];
  const normalizeOperator = (operator: string): ComparisonOperator => {
    if (operator === "≠") return "!=";
    if (operator === "≤") return "<=";
    if (operator === "≥") return ">=";
    return operator as ComparisonOperator;
  };
  const operators = parts
    .filter((_, index) => index % 2 === 1)
    .map(normalizeOperator);
  const ids = new Set<string>();
  values.forEach((node) => collectMathIds(node, ids));
  const comparisons = operators.map((operator, index) => ({
    left: values[index],
    right: values[index + 1],
    operator,
    source: source.trim(),
  })) satisfies FormulaComparison[];
  return {
    comparison: comparisons[0],
    comparisons,
    ids: [...ids],
  };
}

function parseVariableDefinition(source: string): VariableDefinition | null {
  const match = source.match(
    /^\s*([a-z][A-Za-z0-9_]*)\s*=\s*(?!\?)(.+?)\s*$/,
  );
  if (!match) return null;
  const value = parseMathExpression(match[2]);
  return value
    ? { name: match[1], value, source: source.trim() }
    : null;
}

function splitCoordinatePair(source: string) {
  let depth = 0;
  const commaIndexes: number[] = [];
  const semicolonIndexes: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth !== 0) continue;
    if (character === ",") commaIndexes.push(index);
    if (character === ";") semicolonIndexes.push(index);
  }
  const separator =
    semicolonIndexes.length === 1
      ? semicolonIndexes[0]
      : commaIndexes.length === 1
        ? commaIndexes[0]
        : -1;
  if (separator < 0) return null;
  const x = source.slice(0, separator).trim();
  const y = source.slice(separator + 1).trim();
  return x && y ? [x, y] : null;
}

function parsePointCoordinateConstraint(
  source: string,
): ParsedConstraint | null {
  const match = source.match(
    /^\s*([A-Za-z])\s*=\s*\(\s*(.*?)\s*\)\s*$/,
  );
  if (!match) return null;
  const pair = splitCoordinatePair(match[2]);
  if (!pair) return null;
  const pointId = match[1].toUpperCase();
  const xValue = parseMathExpression(pair[0]);
  const yValue = parseMathExpression(pair[1]);
  if (!xValue || !yValue) return null;
  const equations: FormulaEquation[] = [
    {
      left: { kind: "measure", measure: "x", ids: [pointId] },
      right: xValue,
      source: `x(${pointId}) = ${pair[0]}`,
    },
    {
      left: { kind: "measure", measure: "y", ids: [pointId] },
      right: yValue,
      source: `y(${pointId}) = ${pair[1]}`,
    },
  ];
  const ids = new Set([pointId]);
  collectMathIds(xValue, ids);
  collectMathIds(yValue, ids);
  return {
    kind: "formula",
    ids: [...ids],
    formula: equations[0],
    formulas: equations,
    source: source.trim(),
  };
}

function evaluateMath(
  node: MathNode,
  map: Map<string, Point>,
  variables: Map<string, MathNode> = new Map(),
  angleUnit: AngleUnit = "degrees",
  shapes: Shape[] = [],
  resolving: Set<string> = new Set(),
): number {
  if (node.kind === "number") return node.value;
  if (node.kind === "variable") {
    if (resolving.has(node.name)) return Number.NaN;
    const value = variables.get(node.name);
    if (!value) return Number.NaN;
    const nextResolving = new Set(resolving);
    nextResolving.add(node.name);
    return evaluateMath(
      value,
      map,
      variables,
      angleUnit,
      shapes,
      nextResolving,
    );
  }
  if (node.kind === "measure") {
    const points = node.ids.map((id) => map.get(id));
    if (points.some((point) => !point)) return Number.NaN;
    const p = points as Point[];
    if (node.measure === "x") return p[0].x;
    if (node.measure === "y") return p[0].y;
    if (node.measure === "distance") return distance(p[0], p[1]);
    if (node.measure === "angle") {
      const value = angleDegrees(p[0], p[1], p[2]);
      return angleUnit === "degrees" ? value : (value * Math.PI) / 180;
    }
    const geometry = node.geometry ?? "polygon";
    const shape = matchingGeometryShape(geometry, node.ids, shapes);
    return geometryMetric(
      node.measure === "perimeter" ? "perimeter" : "area",
      geometry,
      p,
      shape?.arc,
    );
  }
  if (node.kind === "unary") {
    const value = evaluateMath(
      node.value,
      map,
      variables,
      angleUnit,
      shapes,
      resolving,
    );
    return node.operator === "-" ? -value : value;
  }
  if (node.kind === "function") {
    const value = evaluateMath(
      node.value,
      map,
      variables,
      angleUnit,
      shapes,
      resolving,
    );
    if (node.name === "sqrt") return Math.sqrt(Math.max(value, 0));
    if (node.name === "abs") return Math.abs(value);
    if (node.name === "deg") {
      return angleUnit === "degrees" ? value : (value * Math.PI) / 180;
    }
    if (node.name === "rad") {
      return angleUnit === "radians" ? value : (value * 180) / Math.PI;
    }
    const radians =
      angleUnit === "degrees" ? (value * Math.PI) / 180 : value;
    if (node.name === "sin") return Math.sin(radians);
    if (node.name === "cos") return Math.cos(radians);
    return Math.tan(radians);
  }
  const left = evaluateMath(
    node.left,
    map,
    variables,
    angleUnit,
    shapes,
    resolving,
  );
  const right = evaluateMath(
    node.right,
    map,
    variables,
    angleUnit,
    shapes,
    resolving,
  );
  if (node.operator === "+") return left + right;
  if (node.operator === "-") return left - right;
  if (node.operator === "*") return left * right;
  if (node.operator === "/") {
    return Math.abs(right) < 1e-9 ? Number.NaN : left / right;
  }
  return Math.pow(left, right);
}

function parseIntersectionObject(source: string): IntersectionObject | null {
  const shorthand = source.match(/^([A-Z])([A-Z])$/);
  if (shorthand) {
    return {
      kind: "auto",
      ids: [shorthand[1], shorthand[2]],
    };
  }
  const explicit = source.match(
    /^(SEGMENT|LINE|RAY|CIRCLE)\(([A-Z])([A-Z])\)$/,
  );
  if (!explicit) return null;
  return {
    kind: explicit[1].toLowerCase() as IntersectionObject["kind"],
    ids: [explicit[2], explicit[3]],
  };
}

function parseIntersectionConstraint(
  source: string,
): ParsedConstraint | null {
  const clean = source.toUpperCase().replace(/\s+/g, "");
  const match = clean.match(/^([A-Z])=(.+)∩(.+)$/);
  if (!match) return null;
  const first = parseIntersectionObject(match[2]);
  const second = parseIntersectionObject(match[3]);
  if (!first || !second) return null;
  const point = match[1];
  return {
    kind: "intersectionPoint",
    ids: [
      point,
      ...first.ids,
      ...second.ids,
    ],
    intersection: { point, first, second },
    source: source.trim(),
  };
}

export function parseConstraint(
  expression: string,
  angleUnit: AngleUnit = "degrees",
): ParsedConstraint | null {
  const pointCoordinates = parsePointCoordinateConstraint(expression);
  if (pointCoordinates) return pointCoordinates;
  const intersection = parseIntersectionConstraint(expression);
  if (intersection) return intersection;
  const clean = expression
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/°|\\DEG/g, "");
  let match = clean.match(
    /^([A-Z])([A-Z])=(-?\d+(?:\.\d+)?)$/,
  );
  if (match) {
    return {
      kind: "distance",
      ids: [match[1], match[2]],
      value: Number(match[3]),
    };
  }
  match = clean.match(
    /^∠([A-Z])([A-Z])([A-Z])=(-?\d+(?:\.\d+)?)$/,
  );
  if (match) {
    const value = Number(match[4]);
    return {
      kind: "angle",
      ids: [match[1], match[2], match[3]],
      value:
        angleUnit === "radians" && !/(?:°|\\deg\b)/i.test(expression)
          ? (value * 180) / Math.PI
          : value,
    };
  }
  match = clean.match(
    /^S\(([A-Z]{3,})\)=(-?\d+(?:\.\d+)?)$/,
  );
  if (match) {
    return {
      kind: "area",
      ids: match[1].split(""),
      value: Number(match[2]),
    };
  }
  match = clean.match(/^([A-Z])([A-Z])[∥|]([A-Z])([A-Z])$/);
  if (match) {
    return {
      kind: "parallel",
      ids: [match[1], match[2], match[3], match[4]],
    };
  }
  match = clean.match(/^([A-Z])([A-Z])[⟂⊥]([A-Z])([A-Z])$/);
  if (match) {
    return {
      kind: "perpendicular",
      ids: [match[1], match[2], match[3], match[4]],
    };
  }
  match = clean.match(/^([A-Z])(?:≠|!=)([A-Z])$/);
  if (match) {
    return {
      kind: "distinctPoints",
      ids: [match[1], match[2]],
      source: expression.trim(),
    };
  }
  match = clean.match(/^(?:DISTINCT|РАЗЛИЧНЫ)\(([A-Z]{2,})\)$/);
  if (match) {
    const ids = [...new Set(match[1].split(""))];
    if (ids.length < 2) return null;
    return {
      kind: "distinctPoints",
      ids,
      source: expression.trim(),
    };
  }
  match = clean.match(
    /^([A-Z])([A-Z])(?:(?:∩([A-Z])([A-Z])=∅)|(?:!∩([A-Z])([A-Z]))|(?:НЕПЕРЕСЕКАЕТ([A-Z])([A-Z])))$/,
  );
  if (match) {
    return {
      kind: "nonIntersecting",
      ids: [
        match[1],
        match[2],
        match[3] ?? match[5] ?? match[7],
        match[4] ?? match[6] ?? match[8],
      ],
      source: expression.trim(),
    };
  }
  match = clean.match(/^([A-Z])(?:∈|ON|НА)([A-Z])([A-Z])$/);
  if (match) {
    return {
      kind: "onSegment",
      ids: [match[1], match[2], match[3]],
      source: expression.trim(),
    };
  }
  match = clean.match(
    /^([A-Z])∈(LINE|RAY|CIRCLE)\(([A-Z])([A-Z])\)$/,
  );
  if (match) {
    const kindByObject = {
      LINE: "onLine",
      RAY: "onRay",
      CIRCLE: "onCircle",
    } as const;
    return {
      kind: kindByObject[match[2] as keyof typeof kindByObject],
      ids: [match[1], match[3], match[4]],
      source: expression.trim(),
    };
  }
  match = clean.match(
    /^([A-Z])∈ELLIPSE\(([A-Z])([A-Z])([A-Z])\)$/,
  );
  if (match) {
    return {
      kind: "onEllipse",
      ids: [match[1], match[2], match[3], match[4]],
      source: expression.trim(),
    };
  }
  match = clean.match(
    /^([A-Z])∈ARC\(([A-Z])([A-Z])([A-Z])\)$/,
  );
  if (match) {
    return {
      kind: "onArc",
      ids: [match[1], match[2], match[3], match[4]],
      source: expression.trim(),
    };
  }
  const comparison = parseFormulaComparison(expression);
  if (comparison) {
    return {
      kind: "inequality",
      ids: comparison.ids,
      comparison: comparison.comparison,
      comparisons: comparison.comparisons,
      source: expression.trim(),
    };
  }
  const definition = parseVariableDefinition(expression);
  if (definition) {
    return {
      kind: "definition",
      ids: [...collectMathIds(definition.value)],
      definition,
      source: expression.trim(),
    };
  }
  const formula = parseFormulaEquation(expression);
  if (formula) {
    return {
      kind: "formula",
      ids: formula.ids,
      formula: formula.equation,
      formulas: formula.equations,
      source: expression.trim(),
    };
  }
  return null;
}

export function parseUnknown(expression: string): UnknownTarget | null {
  const explicitTarget = expression.match(/^(.*?)=\s*\?\s*$/);
  const source = (explicitTarget?.[1] ?? expression).trim();
  if (!source) return null;
  const clean = source.toUpperCase().replace(/\s+/g, "");
  let match = clean.match(/^([A-Z])([A-Z])$/);
  if (match) {
    return {
      kind: "distance",
      ids: [match[1], match[2]],
      label: `${match[1]}${match[2]}`,
    };
  }
  match = clean.match(/^∠([A-Z])([A-Z])([A-Z])$/);
  if (match) {
    return {
      kind: "angle",
      ids: [match[1], match[2], match[3]],
      label: `∠${match[1]}${match[2]}${match[3]}`,
    };
  }
  match = clean.match(/^S\(([A-Z]{3,})\)$/);
  if (match) {
    return {
      kind: "area",
      ids: match[1].split(""),
      label: `S(${match[1]})`,
      geometry: "polygon",
    };
  }
  match = clean.match(/^P\(([A-Z]{3,})\)$/);
  if (match) {
    return {
      kind: "perimeter",
      ids: match[1].split(""),
      label: `P(${match[1]})`,
      geometry: "polygon",
    };
  }
  const formula = parseMathExpression(source);
  if (formula) {
    if (
      formula.kind === "measure" &&
      (formula.measure === "area" || formula.measure === "perimeter")
    ) {
      return {
        kind: formula.measure,
        ids: formula.ids,
        label: source,
        geometry: formula.geometry ?? "polygon",
      };
    }
    return {
      kind: "formula",
      ids: [...collectMathIds(formula)],
      label: source,
      formula,
    };
  }
  return null;
}

export function normalizeUnknownExpression(expression: string) {
  const trimmed = expression.trim();
  if (!trimmed || /=\s*\?\s*$/.test(trimmed)) return trimmed;
  return parseUnknown(trimmed) ? `${trimmed} = ?` : expression;
}

function pointObjectResidual(
  point: Point,
  object: IntersectionObject,
  map: Map<string, Point>,
  shapes: Shape[] = [],
) {
  const kind =
    object.kind === "auto"
      ? resolveIntersectionObjectKind(object.ids, shapes)
      : object.kind;
  const start = map.get(object.ids[0]);
  const end = map.get(object.ids[1]);
  if (!start || !end) return 10;
  if (kind === "circle") {
    const radius = Math.max(distance(start, end), 1e-9);
    return (distance(start, point) - radius) / Math.max(radius, 1);
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = Math.max(dx * dx + dy * dy, 1e-9);
  const length = Math.sqrt(lengthSquared);
  const cross =
    ((point.x - start.x) * dy - (point.y - start.y) * dx) / length;
  const projection =
    ((point.x - start.x) * dx + (point.y - start.y) * dy) /
    lengthSquared;
  const outside =
    kind === "segment"
      ? projection < 0
        ? -projection
        : projection > 1
          ? projection - 1
          : 0
      : kind === "ray" && projection < 0
        ? -projection
        : 0;
  // A line is unchanged when its defining points move farther apart. Capping
  // the normalization prevents the solver from "satisfying" membership by
  // sending those points thousands of units away while the measured point
  // remains visibly outside the line.
  const normalization = Math.max(1, Math.min(length, 10));
  return Math.hypot(cross, outside * length) / normalization;
}

function resolveIntersectionObjectKind(
  ids: [string, string],
  shapes: Shape[],
): Exclude<IntersectionObject["kind"], "auto"> {
  for (const shape of shapes) {
    if (shape.points.length < 2) continue;
    const sameDirection =
      shape.points[0] === ids[0] && shape.points[1] === ids[1];
    const reverseDirection =
      shape.points[0] === ids[1] && shape.points[1] === ids[0];
    if (
      (shape.type === "line" || shape.type === "segment") &&
      (sameDirection || reverseDirection)
    ) {
      return shape.type;
    }
    if (shape.type === "ray" && sameDirection) return "ray";
    if (shape.type === "circle" && sameDirection) return "circle";
    if (shape.type === "polygon") {
      const firstIndex = shape.points.indexOf(ids[0]);
      if (
        firstIndex >= 0 &&
        (shape.points[(firstIndex + 1) % shape.points.length] === ids[1] ||
          shape.points[
            (firstIndex - 1 + shape.points.length) % shape.points.length
          ] === ids[1])
      ) {
        return "segment";
      }
    }
  }
  return "segment";
}

function constraintResidual(
  constraint: ParsedConstraint,
  map: Map<string, Point>,
  variables: Map<string, MathNode> = new Map(),
  angleUnit: AngleUnit = "degrees",
  shapes: Shape[] = [],
) {
  if (constraint.kind === "definition") return 0;
  const points = constraint.ids.map((id) => map.get(id));
  if (points.some((point) => !point)) return 10;
  const p = points as Point[];
  if (constraint.kind === "distance") {
    return (
      (distance(p[0], p[1]) - (constraint.value ?? 0)) /
      Math.max(Math.abs(constraint.value ?? 0), 1)
    );
  }
  if (constraint.kind === "angle") {
    return (angleDegrees(p[0], p[1], p[2]) - (constraint.value ?? 0)) / 180;
  }
  if (constraint.kind === "area") {
    return (
      (polygonArea(p) - (constraint.value ?? 0)) /
      Math.max(Math.abs(constraint.value ?? 0), 1)
    );
  }
  if (constraint.kind === "distinctPoints") {
    let minimum = Number.POSITIVE_INFINITY;
    for (let first = 0; first < p.length; first += 1) {
      for (let second = first + 1; second < p.length; second += 1) {
        minimum = Math.min(minimum, distance(p[first], p[second]));
      }
    }
    const clearance = 0.12;
    return Math.max(0, (clearance - minimum) / clearance);
  }
  if (constraint.kind === "nonIntersecting") {
    const [a, b, c, d] = p;
    const clearance = 0.12;
    if (!segmentsIntersect(a, b, c, d)) {
      return Math.max(
        0,
        (clearance - segmentDistance(a, b, c, d)) / clearance,
      );
    }
    const firstLength = Math.max(distance(a, b), 1e-9);
    const secondLength = Math.max(distance(c, d), 1e-9);
    const penetration = Math.min(
      Math.abs(orientation(a, b, c)) / firstLength,
      Math.abs(orientation(a, b, d)) / firstLength,
      Math.abs(orientation(c, d, a)) / secondLength,
      Math.abs(orientation(c, d, b)) / secondLength,
    );
    return 0.25 + penetration / Math.max((firstLength + secondLength) / 2, 1);
  }
  if (constraint.kind === "inequality" && constraint.comparison) {
    const strictMargin = 1e-4;
    const comparisons =
      constraint.comparisons ?? [constraint.comparison];
    const errors = comparisons.map((comparison) => {
      const left = evaluateMath(
        comparison.left,
        map,
        variables,
        angleUnit,
        shapes,
      );
      const right = evaluateMath(
        comparison.right,
        map,
        variables,
        angleUnit,
        shapes,
      );
      if (!Number.isFinite(left) || !Number.isFinite(right)) return 10;
      const difference =
        (left - right) / Math.max(Math.abs(left), Math.abs(right), 1);
      if (comparison.operator === "<") {
        return Math.max(0, difference + strictMargin);
      }
      if (comparison.operator === ">") {
        return Math.max(0, -difference + strictMargin);
      }
      if (comparison.operator === "<=") {
        return Math.max(0, difference);
      }
      if (comparison.operator === ">=") {
        return Math.max(0, -difference);
      }
      return Math.max(0, strictMargin - Math.abs(difference));
    });
    return Math.sqrt(
      errors.reduce((sum, error) => sum + error * error, 0) /
        Math.max(errors.length, 1),
    );
  }
  if (constraint.kind === "formula" && constraint.formula) {
    const equations = constraint.formulas ?? [constraint.formula];
    const errors = equations.map((equation) => {
      const left = evaluateMath(
        equation.left,
        map,
        variables,
        angleUnit,
        shapes,
      );
      const right = evaluateMath(
        equation.right,
        map,
        variables,
        angleUnit,
        shapes,
      );
      if (!Number.isFinite(left) || !Number.isFinite(right)) return 10;
      return (left - right) / Math.max(Math.abs(left), Math.abs(right), 1);
    });
    return Math.sqrt(
      errors.reduce((sum, error) => sum + error * error, 0) /
      Math.max(errors.length, 1),
    );
  }
  if (
    constraint.kind === "intersectionPoint" &&
    constraint.intersection
  ) {
    const point = map.get(constraint.intersection.point);
    if (!point) return 10;
    const firstError = pointObjectResidual(
      point,
      constraint.intersection.first,
      map,
      shapes,
    );
    const secondError = pointObjectResidual(
      point,
      constraint.intersection.second,
      map,
      shapes,
    );
    return Math.hypot(firstError, secondError) / Math.SQRT2;
  }
  if (constraint.kind === "onCircle") {
    return pointObjectResidual(
      p[0],
      { kind: "circle", ids: [constraint.ids[1], constraint.ids[2]] },
      map,
    );
  }
  if (constraint.kind === "onArc") {
    const [point, center, startPoint, endPoint] = p;
    const radius = Math.max(distance(center, startPoint), 1e-9);
    const radialError =
      (distance(center, point) - radius) / Math.max(radius, 1);
    const start = Math.atan2(
      startPoint.y - center.y,
      startPoint.x - center.x,
    );
    const rawEnd = Math.atan2(
      endPoint.y - center.y,
      endPoint.x - center.x,
    );
    const matchingArc = shapes.find(
      (shape) =>
        (shape.type === "sector" ||
          shape.type === "circularSegment") &&
        shape.points[0] === constraint.ids[1] &&
        shape.points[1] === constraint.ids[2] &&
        shape.points[2] === constraint.ids[3],
    );
    const end = resolveArcEnd(start, rawEnd, matchingArc?.arc);
    const pointAngle = Math.atan2(
      point.y - center.y,
      point.x - center.x,
    );
    const boundaryError = isAngleOnArc(start, end, pointAngle)
      ? 0
      : Math.min(
          distance(point, startPoint),
          distance(point, endPoint),
        ) / Math.max(radius, 1);
    return Math.hypot(radialError, boundaryError);
  }
  if (constraint.kind === "onEllipse") {
    const [point, center, firstAxis, secondAxis] = p;
    const radiusX = Math.max(distance(center, firstAxis), 1e-9);
    const radiusY = Math.max(distance(center, secondAxis), 1e-9);
    const rotation = Math.atan2(
      firstAxis.y - center.y,
      firstAxis.x - center.x,
    );
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const localX = dx * Math.cos(rotation) + dy * Math.sin(rotation);
    const localY = -dx * Math.sin(rotation) + dy * Math.cos(rotation);
    return (
      (localX * localX) / (radiusX * radiusX) +
      (localY * localY) / (radiusY * radiusY) -
      1
    );
  }
  if (
    constraint.kind === "onSegment" ||
    constraint.kind === "onLine" ||
    constraint.kind === "onRay"
  ) {
    return pointObjectResidual(
      p[0],
      {
        kind:
          constraint.kind === "onSegment"
            ? "segment"
            : constraint.kind === "onLine"
              ? "line"
              : "ray",
        ids: [constraint.ids[1], constraint.ids[2]],
      },
      map,
    );
  }
  const ux = p[1].x - p[0].x;
  const uy = p[1].y - p[0].y;
  const vx = p[3].x - p[2].x;
  const vy = p[3].y - p[2].y;
  const denominator = Math.max(Math.hypot(ux, uy) * Math.hypot(vx, vy), 1e-9);
  return constraint.kind === "parallel"
    ? (ux * vy - uy * vx) / denominator
    : (ux * vx + uy * vy) / denominator;
}

function evaluateUnknown(
  target: UnknownTarget,
  map: Map<string, Point>,
  variables: Map<string, MathNode> = new Map(),
  angleUnit: AngleUnit = "degrees",
  shapes: Shape[] = [],
) {
  const points = target.ids.map((id) => map.get(id));
  if (points.some((point) => !point)) return null;
  const p = points as Point[];
  if (target.kind === "distance") {
    return { value: distance(p[0], p[1]), suffix: "" };
  }
  if (target.kind === "angle") {
    return { value: angleDegrees(p[0], p[1], p[2]), suffix: "°" };
  }
  if (target.kind === "formula" && target.formula) {
    const value = evaluateMath(
      target.formula,
      map,
      variables,
      angleUnit,
      shapes,
    );
    return Number.isFinite(value) ? { value, suffix: "" } : null;
  }
  const geometry = target.geometry ?? "polygon";
  const shape = matchingGeometryShape(geometry, target.ids, shapes);
  const value = geometryMetric(
    target.kind === "perimeter" ? "perimeter" : "area",
    geometry,
    p,
    shape?.arc,
  );
  return Number.isFinite(value)
    ? {
        value,
        suffix: target.kind === "area" ? " ед²" : " ед",
      }
    : null;
}

export function equationText(constraint: ParsedConstraint) {
  if (constraint.kind === "distance") {
    return `√((x${constraint.ids[1]}−x${constraint.ids[0]})² + (y${constraint.ids[1]}−y${constraint.ids[0]})²) = ${constraint.value}`;
  }
  if (constraint.kind === "angle") {
    return `cos⁻¹(u·v / |u||v|) = ${constraint.value}°`;
  }
  if (constraint.kind === "area") {
    return `½ |Σ(xᵢyᵢ₊₁−yᵢxᵢ₊₁)| = ${constraint.value}`;
  }
  if (constraint.kind === "inequality") {
    return constraint.source ?? constraint.comparison?.source ?? "неравенство";
  }
  if (constraint.kind === "formula") {
    return constraint.source ?? constraint.formula?.source ?? "формула";
  }
  if (constraint.kind === "definition") {
    return constraint.definition?.source.replace("=", ":=") ?? "переменная";
  }
  if (constraint.kind === "distinctPoints") {
    return constraint.ids.join(" ≠ ");
  }
  if (constraint.kind === "intersectionPoint") {
    return constraint.source ?? "точка пересечения";
  }
  if (constraint.kind === "nonIntersecting") {
    return `${constraint.ids[0]}${constraint.ids[1]} ∩ ${constraint.ids[2]}${constraint.ids[3]} = ∅`;
  }
  if (constraint.kind === "onSegment") {
    return `${constraint.ids[0]} = ${constraint.ids[1]} + t·(${constraint.ids[2]}−${constraint.ids[1]}), 0 ≤ t ≤ 1`;
  }
  if (constraint.kind === "onLine") {
    return `${constraint.ids[0]} = ${constraint.ids[1]} + t·(${constraint.ids[2]}−${constraint.ids[1]})`;
  }
  if (constraint.kind === "onRay") {
    return `${constraint.ids[0]} = ${constraint.ids[1]} + t·(${constraint.ids[2]}−${constraint.ids[1]}), t ≥ 0`;
  }
  if (constraint.kind === "onCircle") {
    return `|${constraint.ids[0]}−${constraint.ids[1]}| = |${constraint.ids[2]}−${constraint.ids[1]}|`;
  }
  if (constraint.kind === "onArc") {
    return `${constraint.ids[0]} ∈ arc(${constraint.ids.slice(1).join("")})`;
  }
  if (constraint.kind === "onEllipse") {
    return constraint.source ?? `${constraint.ids[0]} ∈ ellipse`;
  }
  return constraint.kind === "parallel"
    ? `${constraint.ids[0]}${constraint.ids[1]} × ${constraint.ids[2]}${constraint.ids[3]} = 0`
    : `${constraint.ids[0]}${constraint.ids[1]} · ${constraint.ids[2]}${constraint.ids[3]} = 0`;
}

export function solveNumerically(
  currentPoints: Point[],
  currentShapes: Shape[],
  rows: ExpressionRow[],
  unknownRows: ExpressionRow[],
  tolerance: number,
  angleUnit: AngleUnit,
  maxIterations: number,
  timeLimitMs: number,
) {
  const parsedRows = rows
    .filter((row) => row.enabled)
    .map((row) => ({
      row,
      parsed: parseConstraint(row.expression, angleUnit),
    }))
    .filter(
      (item): item is { row: ExpressionRow; parsed: ParsedConstraint } =>
        Boolean(item.parsed),
    );
  if (!parsedRows.length) {
    return {
      points: currentPoints,
      result: {
        kind: "empty",
        residual: 0,
        elapsed: 0,
        iterations: 0,
        timedOut: false,
        values: [],
        issues: [],
      } satisfies SolveResult,
    };
  }
  const variables = new Map<string, MathNode>();
  parsedRows.forEach(({ parsed }) => {
    if (parsed.kind === "definition" && parsed.definition) {
      variables.set(parsed.definition.name, parsed.definition.value);
    }
  });
  const constraintRows = parsedRows.filter(
    ({ parsed }) => parsed.kind !== "definition",
  );
  const unknownTargets = unknownRows
    .filter((row) => row.enabled)
    .map((row) => parseUnknown(row.expression))
    .filter((target): target is UnknownTarget => Boolean(target));
  const lineAnchorIds = new Set(
    currentShapes
      .filter((shape) => shape.type === "line" && shape.points.length >= 2)
      .flatMap((shape) => shape.points.slice(0, 2)),
  );
  const movableReferences = new Set<string>();
  constraintRows.forEach(({ parsed }) => {
    parsed.ids.forEach((id, index) => {
      const isUnconstrainedLineAnchor =
        parsed.kind === "onLine" && index >= 1 && lineAnchorIds.has(id);
      if (!isUnconstrainedLineAnchor) movableReferences.add(id);
    });
  });
  unknownTargets.forEach((target) =>
    target.ids.forEach((id) => movableReferences.add(id)),
  );
  const fixedLineAnchorIds = new Set(
    [...lineAnchorIds].filter((id) => !movableReferences.has(id)),
  );
  const fixedLineAnchors = new Map(
    currentPoints
      .filter((point) => fixedLineAnchorIds.has(point.id))
      .map((point) => [point.id, point]),
  );
  const searchPoints = currentPoints.filter(
    (point) => !fixedLineAnchorIds.has(point.id),
  );
  const search = solveCoordinates(
    searchPoints,
    tolerance,
    (coordinateMap) => {
      const completeMap = new Map(fixedLineAnchors);
      coordinateMap.forEach((point, id) => completeMap.set(id, point));
      return constraintRows.map(({ parsed }) =>
        constraintResidual(
          parsed,
          completeMap,
          variables,
          angleUnit,
          currentShapes,
        ),
      );
    },
    {
      maxIterations,
      timeLimitMs,
    },
  );
  const searchedPointMap = pointMap(search.points);
  const solvedPoints = currentPoints.map(
    (point) => searchedPointMap.get(point.id) ?? point,
  );
  const solvedMap = pointMap(solvedPoints);
  const individualErrors = constraintRows.map(({ row, parsed }, index) => ({
    expression: row.expression,
    error:
      search.errors[index] ??
      Math.abs(
        constraintResidual(
          parsed,
          solvedMap,
          variables,
          angleUnit,
          currentShapes,
        ),
      ),
  }));
  const values = unknownTargets
    .map((target) => {
      const measured = evaluateUnknown(
        target,
        solvedMap,
        variables,
        angleUnit,
        currentShapes,
      );
      return measured
        ? {
            label: target.label,
            value: measured.value,
            suffix: measured.suffix,
          }
        : null;
    })
    .filter(
      (
        value,
      ): value is { label: string; value: number; suffix: string } =>
        Boolean(value),
    );

  return {
    points: solvedPoints,
    result: {
      kind: search.residual < tolerance ? "exact" : "approximate",
      residual: search.residual,
      elapsed: search.elapsed,
      iterations: search.iterations,
      timedOut: search.timedOut,
      values,
      issues: individualErrors
        .filter((item) => item.error >= tolerance)
        .sort((a, b) => b.error - a.error)
        .slice(0, 3),
    } satisfies SolveResult,
  };
}

export function renamePointInExpression(
  expression: string,
  previousId: string,
  nextId: string,
) {
  const rename = (value: string) =>
    value === previousId ? nextId : value;
  let updated = expression;
  updated = updated.replace(
    /∠\s*([A-Z])([A-Z])([A-Z])/g,
    (_, a, b, c) => `∠${rename(a)}${rename(b)}${rename(c)}`,
  );
  updated = updated.replace(
    /(\b(?:S|AREA|ANGLE|LEN|LINE|RAY|CIRCLE|DISTINCT|РАЗЛИЧНЫ)\s*\()([A-Z]+)(\))/gi,
    (_, prefix, ids, suffix) =>
      `${prefix}${[...ids]
        .map((id) => rename(id))
        .join("")}${suffix}`,
  );
  updated = updated.replace(
    /\b([A-Z])([A-Z])\b/g,
    (_, a, b) => `${rename(a)}${rename(b)}`,
  );
  updated = updated.replace(
    /\b([A-Z])(?=\s*(?:∈|ON|НА))/g,
    (_, id) => rename(id),
  );
  return updated;
}

export function deletedReferenceMessage(
  ids: string[],
  points: Point[],
  locale: Locale,
) {
  const available = new Set(points.map((point) => point.id));
  const missing = [...new Set(ids.filter((id) => !available.has(id)))];
  if (!missing.length) return null;
  if (locale === "en") {
    return missing.length === 1
      ? `deleted object reference: ${missing[0]}`
      : `deleted object references: ${missing.join(", ")}`;
  }
  return missing.length === 1
    ? `ссылка на удалённый объект: ${missing[0]}`
    : `ссылки на удалённые объекты: ${missing.join(", ")}`;
}
