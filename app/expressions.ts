import type {
  AngleUnit,
  ComparisonOperator,
  ContainmentReference,
  DistanceObject,
  ExpressionRow,
  FormulaComparison,
  FormulaEquation,
  GeometryReference,
  GeometryKind,
  IntersectionObject,
  MathNode,
  ParsedConstraint,
  Point,
  ProofResult,
  Shape,
  SolveResult,
  UnknownTarget,
  VariableDefinition,
} from "./domain";
import {
  angleDegrees,
  distance,
  geometryContainmentResidual,
  geometryIntersectionArea,
  geometryMetric,
  isAngleOnArc,
  matchingGeometryShape,
  linearIntersection,
  orientation,
  pointInPolygon,
  pointMap,
  pointToSegmentDistance,
  projectPointToSegment,
  polygonArea,
  resolveArcEnd,
  sampleGeometryBoundary,
  segmentDistance,
  segmentsIntersect,
} from "./geometry";
import type { Locale } from "./i18n";
import { solveCoordinates } from "./solver";

export const trimNumber = (value: number, digits = 2) => {
  const fixed = value.toFixed(digits);
  return digits === 0 ? fixed : fixed.replace(/\.?0+$/, "");
};

const DISTANCE_OBJECT_ARGUMENT =
  String.raw`(?:(?:point|segment|line|ray|circle|ellipse|sector|circularsegment|polygon)\s*\(\s*[A-Za-z]+\s*\)|[A-Za-z]+)`;
const AREA_GEOMETRY_ARGUMENT =
  String.raw`(?:(?:circle|ellipse|sector|segment|circularsegment|polygon)\s*\(\s*[A-Za-z]+\s*\)|[A-Za-z]{3,})`;

function encodeGeometryReference(source: string) {
  const clean = source.replace(/\s+/g, "");
  const explicit = clean.match(
    /^(circle|ellipse|sector|segment|circularsegment|polygon)\(([A-Za-z]+)\)$/i,
  );
  if (explicit) {
    const kind =
      explicit[1].toLowerCase() === "segment"
        ? "CIRCULARSEGMENT"
        : explicit[1].toUpperCase();
    return `${kind}_${explicit[2].toUpperCase()}`;
  }
  return `POLYGON_${clean.toUpperCase()}`;
}

function replaceIntersectionAreas(source: string) {
  const pattern = new RegExp(
    String.raw`\b(?:area|s)\s*\(\s*(${AREA_GEOMETRY_ARGUMENT})\s*∩\s*(${AREA_GEOMETRY_ARGUMENT})\s*\)`,
    "gi",
  );
  return source.replace(
    pattern,
    (_, first, second) =>
      `INTERSECTIONAREA_${encodeGeometryReference(first)}_${encodeGeometryReference(second)}`,
  );
}

function encodeDistanceObject(source: string) {
  const clean = source.replace(/\s+/g, "");
  const explicit = clean.match(
    /^(point|segment|line|ray|circle|ellipse|sector|circularsegment|polygon)\(([A-Za-z]+)\)$/i,
  );
  if (explicit) {
    return `${explicit[1].toUpperCase()}_${explicit[2].toUpperCase()}`;
  }
  const ids = clean.toUpperCase();
  const kind = ids.length === 1 ? "POINT" : ids.length === 2 ? "SEGMENT" : "POLYGON";
  return `${kind}_${ids}`;
}

function replaceObjectDistances(source: string) {
  const pattern = new RegExp(
    String.raw`\b(?:distance|dist)\s*\(\s*(${DISTANCE_OBJECT_ARGUMENT})\s*,\s*(${DISTANCE_OBJECT_ARGUMENT})\s*\)`,
    "gi",
  );
  return source.replace(
    pattern,
    (_, first, second) =>
      `OBJECTDISTANCE_${encodeDistanceObject(first)}_${encodeDistanceObject(second)}`,
  );
}

function prepareMathSource(source: string) {
  return replaceObjectDistances(replaceIntersectionAreas(source))
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
    const objectDistance = token.match(
      /^OBJECTDISTANCE_(POINT|SEGMENT|LINE|RAY|CIRCLE|ELLIPSE|SECTOR|CIRCULARSEGMENT|POLYGON)_([A-Z]+)_(POINT|SEGMENT|LINE|RAY|CIRCLE|ELLIPSE|SECTOR|CIRCULARSEGMENT|POLYGON)_([A-Z]+)$/,
    );
    if (objectDistance) {
      const toObject = (kind: string, ids: string): DistanceObject => ({
        kind:
          kind === "CIRCULARSEGMENT"
            ? "circularSegment"
            : (kind.toLowerCase() as DistanceObject["kind"]),
        ids: ids.split(""),
      });
      const first = toObject(objectDistance[1], objectDistance[2]);
      const second = toObject(objectDistance[3], objectDistance[4]);
      const validObject = (object: DistanceObject) =>
        object.kind === "point"
          ? object.ids.length === 1
          : object.kind === "polygon"
            ? object.ids.length >= 3
            : object.kind === "ellipse" ||
                object.kind === "sector" ||
                object.kind === "circularSegment"
              ? object.ids.length === 3
              : object.ids.length === 2;
      if (!validObject(first) || !validObject(second)) return null;
      return {
        kind: "measure",
        measure: "objectDistance",
        ids: [...new Set([...first.ids, ...second.ids])],
        objects: [first, second],
      };
    }
    const intersectionArea = token.match(
      /^INTERSECTIONAREA_(POLYGON|CIRCLE|ELLIPSE|SECTOR|CIRCULARSEGMENT)_([A-Z]+)_(POLYGON|CIRCLE|ELLIPSE|SECTOR|CIRCULARSEGMENT)_([A-Z]+)$/,
    );
    if (intersectionArea) {
      const toGeometry = (kind: string, ids: string): GeometryReference => ({
        kind:
          kind === "CIRCULARSEGMENT"
            ? "circularSegment"
            : (kind.toLowerCase() as GeometryKind),
        ids: ids.split(""),
      });
      const first = toGeometry(intersectionArea[1], intersectionArea[2]);
      const second = toGeometry(intersectionArea[3], intersectionArea[4]);
      const validGeometry = (geometry: GeometryReference) =>
        geometry.kind === "polygon"
          ? geometry.ids.length >= 3
          : geometry.kind === "circle"
            ? geometry.ids.length === 2
            : geometry.ids.length === 3;
      if (!validGeometry(first) || !validGeometry(second)) return null;
      return {
        kind: "measure",
        measure: "intersectionArea",
        ids: [...new Set([...first.ids, ...second.ids])],
        geometries: [first, second],
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

function distanceObjectPoints(
  object: DistanceObject,
  map: Map<string, Point>,
) {
  const points = object.ids.map((id) => map.get(id));
  return points.some((point) => !point) ? null : (points as Point[]);
}

function distanceObjectBoundary(
  object: DistanceObject,
  map: Map<string, Point>,
  shapes: Shape[],
) {
  const points = distanceObjectPoints(object, map);
  if (!points || object.kind === "point") return points ?? [];
  if (
    object.kind === "segment" ||
    object.kind === "line" ||
    object.kind === "ray"
  ) {
    return points;
  }
  const shape = matchingGeometryShape(object.kind, object.ids, shapes);
  return sampleGeometryBoundary(
    object.kind,
    points,
    shape?.arc,
    48,
  );
}

function boundarySegments(points: Point[]) {
  if (points.length < 2) return [];
  return points.map(
    (point, index) =>
      [point, points[(index + 1) % points.length]] as [Point, Point],
  );
}

function pointToDistanceObject(
  point: Point,
  object: DistanceObject,
  map: Map<string, Point>,
  shapes: Shape[],
) {
  const points = distanceObjectPoints(object, map);
  if (!points?.length) return Number.NaN;
  if (object.kind === "point") return distance(point, points[0]);
  if (
    object.kind === "segment" ||
    object.kind === "line" ||
    object.kind === "ray"
  ) {
    const projected = projectPointToSegment(
      point,
      points[0],
      points[1],
      object.kind,
    );
    return distance(point, projected);
  }
  if (object.kind === "circle") {
    return Math.abs(distance(point, points[0]) - distance(points[0], points[1]));
  }
  const boundary = distanceObjectBoundary(object, map, shapes);
  return Math.min(
    ...boundarySegments(boundary).map(([start, end]) =>
      pointToSegmentDistance(point, start, end),
    ),
  );
}

function linearToBoundaryDistance(
  linear: DistanceObject,
  boundaryObject: DistanceObject,
  map: Map<string, Point>,
  shapes: Shape[],
) {
  const linearPoints = distanceObjectPoints(linear, map);
  const boundary = distanceObjectBoundary(boundaryObject, map, shapes);
  if (!linearPoints || linearPoints.length < 2 || boundary.length < 2) {
    return Number.NaN;
  }
  const kind = linear.kind as "segment" | "line" | "ray";
  const segments = boundarySegments(boundary);
  if (
    segments.some(([start, end]) =>
      linearIntersection(
        linearPoints[0],
        linearPoints[1],
        kind,
        start,
        end,
        "segment",
      ),
    )
  ) {
    return 0;
  }
  const candidates = boundary.flatMap((point) => {
    const projected = projectPointToSegment(
      point,
      linearPoints[0],
      linearPoints[1],
      kind,
    );
    return [distance(point, projected)];
  });
  if (kind !== "line") {
    const endpointCount = kind === "segment" ? 2 : 1;
    linearPoints.slice(0, endpointCount).forEach((point) => {
      segments.forEach(([start, end]) => {
        candidates.push(pointToSegmentDistance(point, start, end));
      });
    });
  }
  return Math.min(...candidates);
}

function distanceBetweenObjects(
  first: DistanceObject,
  second: DistanceObject,
  map: Map<string, Point>,
  shapes: Shape[],
) {
  const firstPoints = distanceObjectPoints(first, map);
  const secondPoints = distanceObjectPoints(second, map);
  if (!firstPoints || !secondPoints) return Number.NaN;
  if (first.kind === "point") {
    return pointToDistanceObject(firstPoints[0], second, map, shapes);
  }
  if (second.kind === "point") {
    return pointToDistanceObject(secondPoints[0], first, map, shapes);
  }
  const linearKinds = new Set(["segment", "line", "ray"]);
  const firstLinear = linearKinds.has(first.kind);
  const secondLinear = linearKinds.has(second.kind);
  if (firstLinear && secondLinear) {
    const intersection = linearIntersection(
      firstPoints[0],
      firstPoints[1],
      first.kind as "segment" | "line" | "ray",
      secondPoints[0],
      secondPoints[1],
      second.kind as "segment" | "line" | "ray",
    );
    if (intersection) return 0;
    const candidates = [
      pointToDistanceObject(firstPoints[0], second, map, shapes),
      pointToDistanceObject(secondPoints[0], first, map, shapes),
    ];
    if (first.kind === "segment") {
      candidates.push(
        pointToDistanceObject(firstPoints[1], second, map, shapes),
      );
    }
    if (second.kind === "segment") {
      candidates.push(
        pointToDistanceObject(secondPoints[1], first, map, shapes),
      );
    }
    return Math.min(...candidates);
  }
  if (first.kind === "circle" && second.kind === "circle") {
    const centerDistance = distance(firstPoints[0], secondPoints[0]);
    const firstRadius = distance(firstPoints[0], firstPoints[1]);
    const secondRadius = distance(secondPoints[0], secondPoints[1]);
    return Math.max(
      0,
      centerDistance - firstRadius - secondRadius,
      Math.abs(firstRadius - secondRadius) - centerDistance,
    );
  }
  if (
    (first.kind === "circle" && secondLinear) ||
    (second.kind === "circle" && firstLinear)
  ) {
    const linear = first.kind === "circle" ? second : first;
    const circlePoints = first.kind === "circle" ? firstPoints : secondPoints;
    const linearPoints = first.kind === "circle" ? secondPoints : firstPoints;
    const linearKind = linear.kind as "segment" | "line" | "ray";
    const radius = distance(circlePoints[0], circlePoints[1]);
    const nearest = projectPointToSegment(
      circlePoints[0],
      linearPoints[0],
      linearPoints[1],
      linearKind,
    );
    const nearestDistance = distance(circlePoints[0], nearest);
    if (linearKind === "segment") {
      const farthest = Math.max(
        distance(circlePoints[0], linearPoints[0]),
        distance(circlePoints[0], linearPoints[1]),
      );
      if (nearestDistance <= radius && farthest >= radius) return 0;
      return nearestDistance > radius
        ? nearestDistance - radius
        : radius - farthest;
    }
    return Math.max(0, nearestDistance - radius);
  }
  if (firstLinear) {
    return linearToBoundaryDistance(first, second, map, shapes);
  }
  if (secondLinear) {
    return linearToBoundaryDistance(second, first, map, shapes);
  }
  const firstBoundary = distanceObjectBoundary(first, map, shapes);
  const secondBoundary = distanceObjectBoundary(second, map, shapes);
  const firstSegments = boundarySegments(firstBoundary);
  const secondSegments = boundarySegments(secondBoundary);
  return Math.min(
    ...firstSegments.flatMap(([firstStart, firstEnd]) =>
      secondSegments.map(([secondStart, secondEnd]) =>
        segmentDistance(firstStart, firstEnd, secondStart, secondEnd),
      ),
    ),
  );
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
    if (node.measure === "objectDistance" && node.objects) {
      return distanceBetweenObjects(
        node.objects[0],
        node.objects[1],
        map,
        shapes,
      );
    }
    if (node.measure === "intersectionArea" && node.geometries) {
      const [first, second] = node.geometries;
      const firstPoints = first.ids.map((id) => map.get(id));
      const secondPoints = second.ids.map((id) => map.get(id));
      if (
        firstPoints.some((point) => !point) ||
        secondPoints.some((point) => !point)
      ) {
        return Number.NaN;
      }
      const firstShape = matchingGeometryShape(
        first.kind,
        first.ids,
        shapes,
      );
      const secondShape = matchingGeometryShape(
        second.kind,
        second.ids,
        shapes,
      );
      return geometryIntersectionArea(
        first.kind,
        firstPoints as Point[],
        second.kind,
        secondPoints as Point[],
        firstShape?.arc,
        secondShape?.arc,
      );
    }
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
  const clean = source.toUpperCase().replace(/\s+/g, "");
  const shorthand = clean.match(/^([A-Z])([A-Z])$/);
  if (shorthand) {
    return {
      kind: "auto",
      ids: [shorthand[1], shorthand[2]],
    };
  }
  const explicit = clean.match(
    /^(SEGMENT|LINE|RAY|CIRCLE|ELLIPSE|SECTOR|CIRCULARSEGMENT|POLYGON)\(([A-Z]+)\)$/,
  );
  if (!explicit) return null;
  const kind =
    explicit[1] === "CIRCULARSEGMENT"
      ? "circularSegment"
      : (explicit[1].toLowerCase() as IntersectionObject["kind"]);
  const ids = explicit[2].split("");
  const validCount =
    kind === "polygon"
      ? ids.length >= 3
      : kind === "ellipse" ||
          kind === "sector" ||
          kind === "circularSegment"
        ? ids.length === 3
        : ids.length === 2;
  if (!validCount) return null;
  return {
    kind,
    ids,
  };
}

function parseIntersectionPointSet(source: string) {
  const clean = source.toUpperCase().replace(/\s+/g, "");
  if (clean === "∅") return [];
  const braces = clean.match(/^\{(.+)\}$/);
  const pointSource = braces?.[1] ?? clean;
  const points = pointSource.split(",");
  if (
    !points.length ||
    points.some((point) => !/^[A-Z]$/.test(point)) ||
    new Set(points).size !== points.length
  ) {
    return null;
  }
  return points;
}

function parseIntersectionObjects(source: string) {
  const parts = source.split("∩");
  if (parts.length !== 2) return null;
  const first = parseIntersectionObject(parts[0]);
  const second = parseIntersectionObject(parts[1]);
  return first && second ? { first, second } : null;
}

function parseIntersectionConstraint(source: string): ParsedConstraint | null {
  const clean = source.toUpperCase().trim();
  let relation: "equals" | "contains";
  let pointSource: string;
  let objectSource: string;
  const membership = clean.split("∈");
  if (membership.length === 2) {
    relation = "contains";
    [pointSource, objectSource] = membership;
  } else {
    const equality = clean.split("=");
    if (equality.length !== 2) return null;
    relation = "equals";
    if (equality[0].includes("∩")) {
      objectSource = equality[0];
      pointSource = equality[1];
    } else {
      pointSource = equality[0];
      objectSource = equality[1];
    }
  }
  const points = parseIntersectionPointSet(pointSource);
  const objects = parseIntersectionObjects(objectSource);
  if (!points || !objects || (relation === "contains" && !points.length)) {
    return null;
  }
  return {
    kind: "intersectionSet",
    ids: [
      ...new Set([
        ...points,
        ...objects.first.ids,
        ...objects.second.ids,
      ]),
    ],
    intersection: { points, relation, ...objects },
    source: source.trim(),
  };
}

function parseGeometryReference(source: string): GeometryReference | null {
  const clean = source.toUpperCase().replace(/\s+/g, "");
  if (/^[A-Z]{3,}$/.test(clean)) {
    return { kind: "polygon", ids: clean.split("") };
  }
  const match = clean.match(
    /^(POLYGON|CIRCLE|ELLIPSE|SECTOR|SEGMENT|CIRCULARSEGMENT)\(([A-Z]+)\)$/,
  );
  if (!match) return null;
  const kind =
    match[1] === "SEGMENT" || match[1] === "CIRCULARSEGMENT"
      ? "circularSegment"
      : (match[1].toLowerCase() as GeometryReference["kind"]);
  const ids = match[2].split("");
  const validCount =
    kind === "polygon"
      ? ids.length >= 3
      : kind === "circle"
        ? ids.length === 2
        : ids.length === 3;
  return validCount ? { kind, ids } : null;
}

function parseContainmentInner(source: string): ContainmentReference | null {
  const clean = source.toUpperCase().replace(/\s+/g, "");
  const point = clean.match(/^(?:([A-Z])|POINT\(([A-Z])\))$/);
  if (point) return { kind: "point", ids: [point[1] ?? point[2]] };
  return parseGeometryReference(source);
}

function parseContainmentConstraint(
  source: string,
): ParsedConstraint | null {
  const match = source.match(
    /^\s*(?:inside|внутри)\s*\(\s*(.+?)\s*,\s*(.+?)\s*\)\s*$/i,
  );
  if (!match) return null;
  const inner = parseContainmentInner(match[1]);
  const outer = parseGeometryReference(match[2]);
  if (!inner || !outer) return null;
  return {
    kind: "insideFigure",
    ids: [...new Set([...inner.ids, ...outer.ids])],
    containment: { inner, outer },
    source: source.trim(),
  };
}

export function parseConstraint(
  expression: string,
  angleUnit: AngleUnit = "degrees",
): ParsedConstraint | null {
  const pointCoordinates = parsePointCoordinateConstraint(expression);
  if (pointCoordinates) return pointCoordinates;
  const containment = parseContainmentConstraint(expression);
  if (containment) return containment;
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
  match = clean.match(/^(?:CONVEX|ВЫПУКЛЫЙ)\(([A-Z]{3,})\)$/);
  if (match) {
    return {
      kind: "convex",
      ids: match[1].split(""),
      source: expression.trim(),
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

export function parseUnknown(
  expression: string,
  angleUnit: AngleUnit = "degrees",
): UnknownTarget | null {
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
  let predicate = parseConstraint(source, angleUnit);
  if (predicate?.kind === "definition" && !explicitTarget) {
    const equality = parseFormulaEquation(source);
    if (equality) {
      predicate = {
        kind: "formula",
        ids: equality.ids,
        formula: equality.equation,
        formulas: equality.equations,
        source: source.trim(),
      };
    }
  }
  if (predicate && predicate.kind !== "definition" && !explicitTarget) {
    return {
      kind: "predicate",
      ids: predicate.ids,
      label: source,
      predicate,
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

export function normalizeUnknownExpression(
  expression: string,
  angleUnit: AngleUnit = "degrees",
) {
  const trimmed = expression.trim();
  if (!trimmed || /=\s*\?\s*$/.test(trimmed)) return trimmed;
  const target = parseUnknown(trimmed, angleUnit);
  if (!target) return expression;
  return target.kind === "predicate" ? trimmed : `${trimmed} = ?`;
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

  if (
    kind === "ellipse" ||
    kind === "sector" ||
    kind === "circularSegment" ||
    kind === "polygon"
  ) {
    const objectPoints = object.ids.map((id) => map.get(id));
    if (objectPoints.some((candidate) => !candidate)) return 10;
    const shape = matchingGeometryShape(kind, object.ids, shapes);
    const boundary = sampleGeometryBoundary(
      kind,
      objectPoints as Point[],
      shape?.arc,
      64,
    );
    if (boundary.length < 2) return 10;
    const xs = boundary.map((candidate) => candidate.x);
    const ys = boundary.map((candidate) => candidate.y);
    const scale = Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
      1,
    );
    return (
      Math.min(
        ...boundary.map((start, index) =>
          pointToSegmentDistance(
            point,
            start,
            boundary[(index + 1) % boundary.length],
          ),
        ),
      ) / scale
    );
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
  ids: string[],
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

export type LocatedIntersections = {
  points: Point[];
  continuous: boolean;
};

function addUniqueIntersection(target: Point[], point: Point) {
  if (target.every((candidate) => distance(candidate, point) > 1e-6)) {
    target.push({ id: "", x: point.x, y: point.y });
  }
}

function circleLinearIntersections(
  center: Point,
  radiusPoint: Point,
  start: Point,
  end: Point,
  kind: "segment" | "line" | "ray",
) {
  const radius = distance(center, radiusPoint);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const a = dx * dx + dy * dy;
  if (a < 1e-12) return [];
  const offsetX = start.x - center.x;
  const offsetY = start.y - center.y;
  const b = 2 * (offsetX * dx + offsetY * dy);
  const c = offsetX * offsetX + offsetY * offsetY - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -1e-9) return [];
  const root = Math.sqrt(Math.max(discriminant, 0));
  const values = [(-b - root) / (2 * a), (-b + root) / (2 * a)];
  const accepts = (value: number) =>
    kind === "line" ||
    (kind === "ray"
      ? value >= -1e-9
      : value >= -1e-9 && value <= 1 + 1e-9);
  const points: Point[] = [];
  values.filter(accepts).forEach((value) =>
    addUniqueIntersection(points, {
      id: "",
      x: start.x + dx * value,
      y: start.y + dy * value,
    }),
  );
  return points;
}

function circleCircleIntersections(
  firstCenter: Point,
  firstRadiusPoint: Point,
  secondCenter: Point,
  secondRadiusPoint: Point,
): LocatedIntersections {
  const firstRadius = distance(firstCenter, firstRadiusPoint);
  const secondRadius = distance(secondCenter, secondRadiusPoint);
  const centers = distance(firstCenter, secondCenter);
  if (
    centers < 1e-9 &&
    Math.abs(firstRadius - secondRadius) <= 1e-9
  ) {
    return { points: [], continuous: true };
  }
  if (
    centers < 1e-9 ||
    centers > firstRadius + secondRadius + 1e-9 ||
    centers < Math.abs(firstRadius - secondRadius) - 1e-9
  ) {
    return { points: [], continuous: false };
  }
  const along =
    (firstRadius * firstRadius - secondRadius * secondRadius + centers * centers) /
    (2 * centers);
  const height = Math.sqrt(
    Math.max(firstRadius * firstRadius - along * along, 0),
  );
  const directionX = (secondCenter.x - firstCenter.x) / centers;
  const directionY = (secondCenter.y - firstCenter.y) / centers;
  const base = {
    id: "",
    x: firstCenter.x + directionX * along,
    y: firstCenter.y + directionY * along,
  };
  const points: Point[] = [];
  addUniqueIntersection(points, {
    id: "",
    x: base.x - directionY * height,
    y: base.y + directionX * height,
  });
  addUniqueIntersection(points, {
    id: "",
    x: base.x + directionY * height,
    y: base.y - directionX * height,
  });
  return { points, continuous: false };
}

function intersectionObjectBoundary(
  object: IntersectionObject,
  kind: Exclude<IntersectionObject["kind"], "auto">,
  map: Map<string, Point>,
  shapes: Shape[],
) {
  const points = object.ids.map((id) => map.get(id));
  if (points.some((point) => !point)) return [];
  if (kind === "circle") {
    return sampleGeometryBoundary("circle", points as Point[], "minor", 72);
  }
  if (
    kind === "ellipse" ||
    kind === "sector" ||
    kind === "circularSegment" ||
    kind === "polygon"
  ) {
    const shape = matchingGeometryShape(kind, object.ids, shapes);
    return sampleGeometryBoundary(kind, points as Point[], shape?.arc, 72);
  }
  return points as Point[];
}

export function locateObjectIntersections(
  firstObject: IntersectionObject,
  secondObject: IntersectionObject,
  map: Map<string, Point>,
  shapes: Shape[],
): LocatedIntersections {
  const firstKind =
    firstObject.kind === "auto"
      ? resolveIntersectionObjectKind(firstObject.ids, shapes)
      : firstObject.kind;
  const secondKind =
    secondObject.kind === "auto"
      ? resolveIntersectionObjectKind(secondObject.ids, shapes)
      : secondObject.kind;
  const firstPoints = firstObject.ids.map((id) => map.get(id));
  const secondPoints = secondObject.ids.map((id) => map.get(id));
  if (
    firstPoints.some((point) => !point) ||
    secondPoints.some((point) => !point)
  ) {
    return { points: [], continuous: false };
  }
  const first = firstPoints as Point[];
  const second = secondPoints as Point[];
  const linearKinds = new Set(["segment", "line", "ray"]);
  const firstLinear = linearKinds.has(firstKind);
  const secondLinear = linearKinds.has(secondKind);
  if (firstKind === "circle" && secondKind === "circle") {
    return circleCircleIntersections(first[0], first[1], second[0], second[1]);
  }
  if (
    (firstKind === "circle" && secondLinear) ||
    (secondKind === "circle" && firstLinear)
  ) {
    const circle = firstKind === "circle" ? first : second;
    const linear = firstKind === "circle" ? second : first;
    const linearKind = (firstKind === "circle" ? secondKind : firstKind) as
      | "segment"
      | "line"
      | "ray";
    return {
      points: circleLinearIntersections(
        circle[0],
        circle[1],
        linear[0],
        linear[1],
        linearKind,
      ),
      continuous: false,
    };
  }
  if (firstLinear && secondLinear) {
    const intersection = linearIntersection(
      first[0],
      first[1],
      firstKind as "segment" | "line" | "ray",
      second[0],
      second[1],
      secondKind as "segment" | "line" | "ray",
    );
    if (intersection) {
      return { points: [{ id: "", ...intersection }], continuous: false };
    }
    const collinear =
      Math.abs(orientation(first[0], first[1], second[0])) <= 1e-9 &&
      Math.abs(orientation(first[0], first[1], second[1])) <= 1e-9;
    return { points: [], continuous: collinear };
  }

  if (firstLinear !== secondLinear) {
    const boundaryObject = firstLinear ? secondObject : firstObject;
    const linearKind = (firstLinear ? firstKind : secondKind) as
      | "segment"
      | "line"
      | "ray";
    const linearPoints = firstLinear ? first : second;
    const boundaryKind = firstLinear ? secondKind : firstKind;
    const boundary = intersectionObjectBoundary(
      boundaryObject,
      boundaryKind,
      map,
      shapes,
    );
    const intersections: Point[] = [];
    boundary.forEach((start, index) => {
      const point = linearIntersection(
        linearPoints[0],
        linearPoints[1],
        linearKind,
        start,
        boundary[(index + 1) % boundary.length],
        "segment",
      );
      if (point) addUniqueIntersection(intersections, { id: "", ...point });
    });
    return { points: intersections, continuous: false };
  }

  const firstBoundary = intersectionObjectBoundary(
    firstObject,
    firstKind,
    map,
    shapes,
  );
  const secondBoundary = intersectionObjectBoundary(
    secondObject,
    secondKind,
    map,
    shapes,
  );
  const intersections: Point[] = [];
  const firstSegments = firstBoundary.map(
    (point, index) =>
      [point, firstBoundary[(index + 1) % firstBoundary.length]] as const,
  );
  const secondSegments = secondBoundary.map(
    (point, index) =>
      [point, secondBoundary[(index + 1) % secondBoundary.length]] as const,
  );
  firstSegments.forEach(([firstStart, firstEnd]) => {
    secondSegments.forEach(([secondStart, secondEnd]) => {
      const point = linearIntersection(
        firstStart,
        firstEnd,
        "segment",
        secondStart,
        secondEnd,
        "segment",
      );
      if (point) addUniqueIntersection(intersections, { id: "", ...point });
    });
  });
  return { points: intersections, continuous: false };
}

function nonIntersectionResidual(
  firstObject: IntersectionObject,
  secondObject: IntersectionObject,
  map: Map<string, Point>,
  shapes: Shape[],
) {
  const firstKind =
    firstObject.kind === "auto"
      ? resolveIntersectionObjectKind(firstObject.ids, shapes)
      : firstObject.kind;
  const secondKind =
    secondObject.kind === "auto"
      ? resolveIntersectionObjectKind(secondObject.ids, shapes)
      : secondObject.kind;
  const firstStart = map.get(firstObject.ids[0]);
  const firstEnd = map.get(firstObject.ids[1]);
  const secondStart = map.get(secondObject.ids[0]);
  const secondEnd = map.get(secondObject.ids[1]);
  if (!firstStart || !firstEnd || !secondStart || !secondEnd) return 10;
  const clearance = 0.12;
  const basicKinds = new Set(["segment", "line", "ray", "circle"]);
  if (!basicKinds.has(firstKind) || !basicKinds.has(secondKind)) {
    const located = locateObjectIntersections(
      firstObject,
      secondObject,
      map,
      shapes,
    );
    if (located.continuous) return 0.5;
    const firstBoundary = intersectionObjectBoundary(
      firstObject,
      firstKind,
      map,
      shapes,
    );
    const secondBoundary = intersectionObjectBoundary(
      secondObject,
      secondKind,
      map,
      shapes,
    );
    if (!firstBoundary.length || !secondBoundary.length) return 10;
    if (located.points.length) return 0.25;
    const minimum = Math.min(
      ...firstBoundary.flatMap((firstPoint, firstIndex) =>
        secondBoundary.map((secondPoint, secondIndex) =>
          segmentDistance(
            firstPoint,
            firstBoundary[(firstIndex + 1) % firstBoundary.length],
            secondPoint,
            secondBoundary[(secondIndex + 1) % secondBoundary.length],
          ),
        ),
      ),
    );
    return Math.max(0, (clearance - minimum) / clearance);
  }

  if (firstKind === "circle" && secondKind === "circle") {
    const firstRadius = distance(firstStart, firstEnd);
    const secondRadius = distance(secondStart, secondEnd);
    const centers = distance(firstStart, secondStart);
    const external = Math.max(
      0,
      firstRadius + secondRadius + clearance - centers,
    );
    const internal = Math.max(
      0,
      centers + Math.min(firstRadius, secondRadius) + clearance -
        Math.max(firstRadius, secondRadius),
    );
    return (
      Math.min(external, internal) /
      Math.max(firstRadius, secondRadius, 1)
    );
  }

  if (firstKind === "circle" || secondKind === "circle") {
    const circleStart = firstKind === "circle" ? firstStart : secondStart;
    const circleEnd = firstKind === "circle" ? firstEnd : secondEnd;
    const linearStart = firstKind === "circle" ? secondStart : firstStart;
    const linearEnd = firstKind === "circle" ? secondEnd : firstEnd;
    const linearKind = (firstKind === "circle" ? secondKind : firstKind) as
      | "segment"
      | "line"
      | "ray";
    const radius = distance(circleStart, circleEnd);
    const nearest = projectPointToSegment(
      circleStart,
      linearStart,
      linearEnd,
      linearKind,
    );
    const nearestDistance = distance(circleStart, nearest);
    const outside = Math.max(
      0,
      radius + clearance - nearestDistance,
    );
    if (linearKind !== "segment") {
      return outside / Math.max(radius, 1);
    }
    const farthestEndpoint = Math.max(
      distance(circleStart, linearStart),
      distance(circleStart, linearEnd),
    );
    const inside = Math.max(
      0,
      farthestEndpoint - Math.max(radius - clearance, 0),
    );
    return Math.min(outside, inside) / Math.max(radius, 1);
  }

  if (firstKind === "segment" && secondKind === "segment") {
    if (!segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) {
      return Math.max(
        0,
        (clearance -
          segmentDistance(firstStart, firstEnd, secondStart, secondEnd)) /
          clearance,
      );
    }
    return 0.25;
  }

  const intersection = linearIntersection(
    firstStart,
    firstEnd,
    firstKind as "segment" | "line" | "ray",
    secondStart,
    secondEnd,
    secondKind as "segment" | "line" | "ray",
  );
  if (!intersection) return 0;
  const firstLength = Math.max(distance(firstStart, firstEnd), 1e-9);
  const secondLength = Math.max(distance(secondStart, secondEnd), 1e-9);
  return Math.abs(
    orientation(firstStart, firstEnd, secondEnd) /
      (firstLength * secondLength),
  ) + 0.1;
}

function intersectionSetResiduals(
  constraint: ParsedConstraint,
  map: Map<string, Point>,
  shapes: Shape[],
) {
  const definition = constraint.intersection;
  if (!definition) return [10];
  if (definition.relation === "equals" && !definition.points.length) {
    return [
      nonIntersectionResidual(
        definition.first,
        definition.second,
        map,
        shapes,
      ),
    ];
  }
  const assigned = definition.points.map((id) => map.get(id));
  if (assigned.some((point) => !point)) return [10];
  const assignedPoints = assigned as Point[];
  const membership = assignedPoints.flatMap((point) => [
    pointObjectResidual(point, definition.first, map, shapes),
    pointObjectResidual(point, definition.second, map, shapes),
  ]);
  if (definition.relation === "contains") return membership;

  // An exact one-point intersection of two circles is a tangency. Computing
  // the intersections first makes this constraint discontinuous: an
  // arbitrarily small step changes the result from zero points to two. That
  // gives a finite-difference solver no useful gradient at the desired
  // solution. Keep the point-on-both-circles residuals above, and express the
  // remaining set cardinality as the smooth geometric tangency condition.
  if (assignedPoints.length === 1) {
    const firstKind =
      definition.first.kind === "auto"
        ? resolveIntersectionObjectKind(definition.first.ids, shapes)
        : definition.first.kind;
    const secondKind =
      definition.second.kind === "auto"
        ? resolveIntersectionObjectKind(definition.second.ids, shapes)
        : definition.second.kind;
    if (firstKind === "circle" && secondKind === "circle") {
      const firstCenter = map.get(definition.first.ids[0]);
      const firstRadiusPoint = map.get(definition.first.ids[1]);
      const secondCenter = map.get(definition.second.ids[0]);
      const secondRadiusPoint = map.get(definition.second.ids[1]);
      if (
        !firstCenter ||
        !firstRadiusPoint ||
        !secondCenter ||
        !secondRadiusPoint
      ) {
        return [10];
      }
      const firstRadius = distance(firstCenter, firstRadiusPoint);
      const secondRadius = distance(secondCenter, secondRadiusPoint);
      const centers = distance(firstCenter, secondCenter);
      const scale = Math.max(
        firstRadius,
        secondRadius,
        centers,
        1,
      );
      const external = centers - firstRadius - secondRadius;
      const internal = centers - Math.abs(firstRadius - secondRadius);
      const useExternal = Math.abs(external) <= Math.abs(internal);
      const tangency = useExternal ? external : internal;
      if (centers <= 1e-9) return [...membership, tangency / scale, 1, 1];

      const assignedPoint = assignedPoints[0];
      let expectedX: number;
      let expectedY: number;
      if (useExternal) {
        const ratio = firstRadius / centers;
        expectedX =
          firstCenter.x + (secondCenter.x - firstCenter.x) * ratio;
        expectedY =
          firstCenter.y + (secondCenter.y - firstCenter.y) * ratio;
      } else {
        const larger =
          firstRadius >= secondRadius ? firstCenter : secondCenter;
        const smaller =
          firstRadius >= secondRadius ? secondCenter : firstCenter;
        const largerRadius = Math.max(firstRadius, secondRadius);
        const ratio = largerRadius / centers;
        expectedX = larger.x + (smaller.x - larger.x) * ratio;
        expectedY = larger.y + (smaller.y - larger.y) * ratio;
      }
      return [
        ...membership,
        tangency / scale,
        (assignedPoint.x - expectedX) / scale,
        (assignedPoint.y - expectedY) / scale,
      ];
    }

    const linearKinds = new Set(["segment", "line", "ray"]);
    if (
      (firstKind === "circle" && linearKinds.has(secondKind)) ||
      (secondKind === "circle" && linearKinds.has(firstKind))
    ) {
      const circleObject =
        firstKind === "circle" ? definition.first : definition.second;
      const linearObject =
        firstKind === "circle" ? definition.second : definition.first;
      const linearKind = (firstKind === "circle" ? secondKind : firstKind) as
        | "segment"
        | "line"
        | "ray";
      const center = map.get(circleObject.ids[0]);
      const radiusPoint = map.get(circleObject.ids[1]);
      const start = map.get(linearObject.ids[0]);
      const end = map.get(linearObject.ids[1]);
      if (!center || !radiusPoint || !start || !end) return [10];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const lengthSquared = dx * dx + dy * dy;
      if (lengthSquared <= 1e-12) return [...membership, 1, 1, 1];
      const rawProjection =
        ((center.x - start.x) * dx + (center.y - start.y) * dy) /
        lengthSquared;
      const projection =
        linearKind === "line"
          ? rawProjection
          : linearKind === "ray"
            ? Math.max(0, rawProjection)
            : Math.max(0, Math.min(1, rawProjection));
      const expectedX = start.x + dx * projection;
      const expectedY = start.y + dy * projection;
      const radius = distance(center, radiusPoint);
      const scale = Math.max(radius, Math.sqrt(lengthSquared), 1);
      const tangentDistance = Math.hypot(
        center.x - expectedX,
        center.y - expectedY,
      );
      const assignedPoint = assignedPoints[0];
      return [
        ...membership,
        (tangentDistance - radius) / scale,
        (assignedPoint.x - expectedX) / scale,
        (assignedPoint.y - expectedY) / scale,
      ];
    }
  }

  const located = locateObjectIntersections(
    definition.first,
    definition.second,
    map,
    shapes,
  );
  if (located.continuous) return [...membership, 1];
  if (!located.points.length) return [...membership, 1];
  const referenced = [
    ...definition.first.ids,
    ...definition.second.ids,
  ]
    .map((id) => map.get(id))
    .filter((point): point is Point => Boolean(point));
  const xs = referenced.map((point) => point.x);
  const ys = referenced.map((point) => point.y);
  const scale = Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
    1,
  );
  const actualToAssigned = located.points.map(
    (actual) =>
      Math.min(...assignedPoints.map((point) => distance(actual, point))) /
      scale,
  );
  const assignedToActual = assignedPoints.map(
    (point) =>
      Math.min(...located.points.map((actual) => distance(actual, point))) /
      scale,
  );
  return [...membership, ...actualToAssigned, ...assignedToActual];
}

type TangentCircleDescriptor = {
  key: string;
  centerId: string;
  radiusPointId: string;
  radius: number;
};

function derivedTangentCircleTriples(
  constraints: ParsedConstraint[],
  initialMap: Map<string, Point>,
  shapes: Shape[],
) {
  const distanceValues = new Map<string, number>();
  constraints.forEach((constraint) => {
    if (constraint.kind !== "distance" || constraint.value === undefined) {
      return;
    }
    distanceValues.set(
      [...constraint.ids.slice(0, 2)].sort().join("\u0000"),
      Math.abs(constraint.value),
    );
  });
  const circles = new Map<string, TangentCircleDescriptor>();
  const edgeKeys = new Set<string>();
  const circleFor = (object: IntersectionObject) => {
    const kind =
      object.kind === "auto"
        ? resolveIntersectionObjectKind(object.ids, shapes)
        : object.kind;
    if (kind !== "circle" || object.ids.length < 2) return null;
    const key = `${object.ids[0]}\u0000${object.ids[1]}`;
    const center = initialMap.get(object.ids[0]);
    const radiusPoint = initialMap.get(object.ids[1]);
    if (!center || !radiusPoint) return null;
    const distanceKey = [...object.ids.slice(0, 2)].sort().join("\u0000");
    const descriptor = {
      key,
      centerId: object.ids[0],
      radiusPointId: object.ids[1],
      radius:
        distanceValues.get(distanceKey) ?? distance(center, radiusPoint),
    };
    circles.set(key, descriptor);
    return descriptor;
  };
  constraints.forEach((constraint) => {
    const definition = constraint.intersection;
    if (
      constraint.kind !== "intersectionSet" ||
      !definition ||
      definition.relation !== "equals" ||
      definition.points.length !== 1
    ) {
      return;
    }
    const first = circleFor(definition.first);
    const second = circleFor(definition.second);
    if (!first || !second || first.key === second.key) return;
    edgeKeys.add([first.key, second.key].sort().join("\u0001"));
  });

  const descriptors = [...circles.values()];
  const triples: string[][] = [];
  for (let first = 0; first < descriptors.length; first += 1) {
    for (let second = first + 1; second < descriptors.length; second += 1) {
      for (let third = second + 1; third < descriptors.length; third += 1) {
        const trio = [descriptors[first], descriptors[second], descriptors[third]];
        const pairs = [
          [trio[0], trio[1]],
          [trio[0], trio[2]],
          [trio[1], trio[2]],
        ] as const;
        if (
          pairs.some(
            ([left, right]) =>
              !edgeKeys.has([left.key, right.key].sort().join("\u0001")),
          )
        ) {
          continue;
        }
        const targetDistances = pairs.map(([left, right]) => {
          const leftCenter = initialMap.get(left.centerId) as Point;
          const rightCenter = initialMap.get(right.centerId) as Point;
          const currentDistance = distance(leftCenter, rightCenter);
          const external = left.radius + right.radius;
          const internal = Math.abs(left.radius - right.radius);
          return Math.abs(currentDistance - external) <=
            Math.abs(currentDistance - internal)
            ? external
            : internal;
        });
        targetDistances.sort((left, right) => left - right);
        const scale = Math.max(...targetDistances, 1);
        if (
          Math.abs(
            targetDistances[2] - targetDistances[1] - targetDistances[0],
          ) <=
          1e-8 * scale
        ) {
          triples.push(trio.map((circle) => circle.centerId));
        }
      }
    }
  }
  return triples;
}

function tangentCircleTripleResidual(
  centerIds: string[],
  map: Map<string, Point>,
) {
  const centers = centerIds.map((id) => map.get(id));
  if (centers.some((point) => !point)) return 10;
  const [first, second, third] = centers as Point[];
  const scale = Math.max(
    distance(first, second),
    distance(first, third),
    distance(second, third),
    1,
  );
  return (
    ((second.x - first.x) * (third.y - first.y) -
      (second.y - first.y) * (third.x - first.x)) /
    (scale * scale)
  );
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
  if (constraint.kind === "convex") {
    const sides = p.flatMap((start, edgeIndex) => {
      const end = p[(edgeIndex + 1) % p.length];
      const edgeLength = Math.max(distance(start, end), 1e-9);
      return p.flatMap((point, pointIndex) => {
        if (
          pointIndex === edgeIndex ||
          pointIndex === (edgeIndex + 1) % p.length
        ) {
          return [];
        }
        return [
          orientation(start, end, point) /
            Math.max(edgeLength * distance(start, point), 1e-9),
        ];
      });
    });
    const margin = 1e-3;
    const score = (sign: 1 | -1) =>
      Math.sqrt(
        sides.reduce((sum, side) => {
          const error = Math.max(0, margin - sign * side);
          return sum + error * error;
        }, 0) / Math.max(sides.length, 1),
      );
    return Math.min(score(1), score(-1));
  }
  if (constraint.kind === "intersectionSet") {
    const errors = intersectionSetResiduals(constraint, map, shapes);
    return Math.sqrt(
      errors.reduce((sum, error) => sum + error * error, 0) /
        Math.max(errors.length, 1),
    );
  }
  if (constraint.kind === "nonIntersecting") {
    if (constraint.disjoint) {
      return nonIntersectionResidual(
        constraint.disjoint.first,
        constraint.disjoint.second,
        map,
        shapes,
      );
    }
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
  if (constraint.kind === "insideFigure" && constraint.containment) {
    const { inner, outer } = constraint.containment;
    const innerPoints = inner.ids.map((id) => map.get(id));
    const outerPoints = outer.ids.map((id) => map.get(id));
    if (
      innerPoints.some((point) => !point) ||
      outerPoints.some((point) => !point)
    ) {
      return 10;
    }
    const outerShape = matchingGeometryShape(outer.kind, outer.ids, shapes);
    if (inner.kind === "point") {
      const point = innerPoints[0] as Point;
      const boundary =
        outer.kind === "polygon"
          ? (outerPoints as Point[])
          : sampleGeometryBoundary(
              outer.kind,
              outerPoints as Point[],
              outerShape?.arc,
              64,
            );
      if (boundary.length < 3) return 10;
      const scale = Math.max(
        ...boundary.map((candidate) => distance(candidate, point)),
        1,
      );
      if (pointInPolygon(point, boundary)) return 0;
      return (
        Math.min(
          ...boundary.map((start, index) =>
            pointToSegmentDistance(
              point,
              start,
              boundary[(index + 1) % boundary.length],
            ),
          ),
        ) / scale
      );
    }
    const innerShape = matchingGeometryShape(inner.kind, inner.ids, shapes);
    return geometryContainmentResidual(
      inner.kind,
      innerPoints as Point[],
      outer.kind,
      outerPoints as Point[],
      innerShape?.arc,
      outerShape?.arc,
    );
  }
  if (constraint.kind === "inequality" && constraint.comparison) {
    const errors = comparisonResiduals(
      constraint,
      map,
      variables,
      angleUnit,
      shapes,
    );
    return Math.sqrt(
      errors.reduce((sum, error) => sum + error * error, 0) /
        Math.max(errors.length, 1),
    );
  }
  if (constraint.kind === "formula" && constraint.formula) {
    const errors = formulaResiduals(
      constraint,
      map,
      variables,
      angleUnit,
      shapes,
    );
    return Math.sqrt(
      errors.reduce((sum, error) => sum + error * error, 0) /
      Math.max(errors.length, 1),
    );
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
    const [point, firstFocus, secondFocus, boundaryPoint] = p;
    const referenceSum = Math.max(
      distance(boundaryPoint, firstFocus) +
        distance(boundaryPoint, secondFocus),
      1e-9,
    );
    return (
      distance(point, firstFocus) + distance(point, secondFocus) -
      referenceSum
    ) / Math.max(referenceSum, 1);
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
  if (constraint.kind === "parallel") {
    return (ux * vy - uy * vx) / denominator;
  }
  const cosine = Math.max(
    -1,
    Math.min(1, (ux * vx + uy * vy) / denominator),
  );
  // Match the normalization used by an explicit 90° angle. This makes
  // `AB ⟂ CD` and `∠(AB, CD) = 90°` carry the same numerical weight.
  return Math.asin(cosine) / Math.PI;
}

function comparisonResiduals(
  constraint: ParsedConstraint,
  map: Map<string, Point>,
  variables: Map<string, MathNode>,
  angleUnit: AngleUnit,
  shapes: Shape[],
) {
  if (!constraint.comparison) return [10];
  const strictMargin = 1e-4;
  return (constraint.comparisons ?? [constraint.comparison]).map(
    (comparison) => {
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
      if (comparison.operator === "<=") return Math.max(0, difference);
      if (comparison.operator === ">=") return Math.max(0, -difference);
      return Math.max(0, strictMargin - Math.abs(difference));
    },
  );
}

function formulaResiduals(
  constraint: ParsedConstraint,
  map: Map<string, Point>,
  variables: Map<string, MathNode>,
  angleUnit: AngleUnit,
  shapes: Shape[],
) {
  if (!constraint.formula) return [10];
  return (constraint.formulas ?? [constraint.formula]).map((equation) => {
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
}

function constraintResiduals(
  constraint: ParsedConstraint,
  map: Map<string, Point>,
  variables: Map<string, MathNode> = new Map(),
  angleUnit: AngleUnit = "degrees",
  shapes: Shape[] = [],
) {
  if (constraint.kind === "intersectionSet") {
    return intersectionSetResiduals(constraint, map, shapes);
  }
  if (constraint.kind === "formula") {
    return formulaResiduals(constraint, map, variables, angleUnit, shapes);
  }
  if (constraint.kind === "inequality") {
    return comparisonResiduals(
      constraint,
      map,
      variables,
      angleUnit,
      shapes,
    );
  }
  if (constraint.kind === "angle") {
    const [first, vertex, second] = constraint.ids.map((id) => map.get(id));
    if (!first || !vertex || !second) return [10, 10];
    const allPoints = [...map.values()];
    const xs = allPoints.map((point) => point.x);
    const ys = allPoints.map((point) => point.y);
    const drawingScale = Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
      1,
    );
    const clearance = Math.max(drawingScale * 1e-5, 1e-9);
    const shortestRay = Math.min(
      distance(first, vertex),
      distance(second, vertex),
    );
    return [
      constraintResidual(constraint, map, variables, angleUnit, shapes),
      Math.max(0, (clearance - shortestRay) / clearance),
    ];
  }
  return [constraintResidual(constraint, map, variables, angleUnit, shapes)];
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

function mathProofKey(node: MathNode): string {
  if (node.kind === "number") return `number:${node.value}`;
  if (node.kind === "variable") return `variable:${node.name}`;
  if (node.kind === "measure") {
    const objects = node.objects
      ?.map((object) => `${object.kind}(${object.ids.join("")})`)
      .join(",");
    const geometries = node.geometries
      ?.map((geometry) => `${geometry.kind}(${geometry.ids.join("")})`)
      .join(",");
    return [
      "measure",
      node.measure,
      node.geometry ?? "",
      node.ids.join(""),
      objects ?? "",
      geometries ?? "",
    ].join(":");
  }
  if (node.kind === "unary") {
    return `unary:${node.operator}(${mathProofKey(node.value)})`;
  }
  if (node.kind === "function") {
    return `function:${node.name}(${mathProofKey(node.value)})`;
  }
  return `binary:${node.operator}(${mathProofKey(node.left)},${mathProofKey(node.right)})`;
}

function equationProofKey(equation: FormulaEquation) {
  const sides = [mathProofKey(equation.left), mathProofKey(equation.right)].sort();
  return `equals(${sides[0]},${sides[1]})`;
}

function comparisonProofKey(comparison: FormulaComparison) {
  return `${comparison.operator}(${mathProofKey(comparison.left)},${mathProofKey(comparison.right)})`;
}

function constraintProofKey(constraint: ParsedConstraint): string | null {
  if (constraint.kind === "formula") {
    const equations = constraint.formulas ??
      (constraint.formula ? [constraint.formula] : []);
    return equations.length
      ? `formula:${equations.map(equationProofKey).sort().join(";")}`
      : null;
  }
  if (constraint.kind === "inequality") {
    const comparisons = constraint.comparisons ??
      (constraint.comparison ? [constraint.comparison] : []);
    return comparisons.length
      ? `inequality:${comparisons.map(comparisonProofKey).join(";")}`
      : null;
  }
  if (constraint.kind === "definition" && constraint.definition) {
    return `formula:${equationProofKey({
      left: { kind: "variable", name: constraint.definition.name },
      right: constraint.definition.value,
      source: constraint.definition.source,
    })}`;
  }
  const geometryReferenceKey = (
    reference?: GeometryReference | ContainmentReference,
  ) =>
    reference ? `${reference.kind}(${reference.ids.join("")})` : "";
  const intersectionObjectKey = (object?: IntersectionObject) =>
    object ? `${object.kind}(${object.ids.join("")})` : "";
  return JSON.stringify({
    kind: constraint.kind,
    ids: constraint.ids,
    value: constraint.value,
    intersection: constraint.intersection
      ? {
          points: constraint.intersection.points,
          relation: constraint.intersection.relation,
          first: intersectionObjectKey(constraint.intersection.first),
          second: intersectionObjectKey(constraint.intersection.second),
        }
      : undefined,
    disjoint: constraint.disjoint
      ? {
          first: intersectionObjectKey(constraint.disjoint.first),
          second: intersectionObjectKey(constraint.disjoint.second),
        }
      : undefined,
    containment: constraint.containment
      ? {
          inner: geometryReferenceKey(constraint.containment.inner),
          outer: geometryReferenceKey(constraint.containment.outer),
        }
      : undefined,
  });
}

function mathHasDegenerateAngle(node: MathNode, map: Map<string, Point>): boolean {
  if (node.kind === "measure" && node.measure === "angle") {
    const [first, center, third] = node.ids.map((id) => map.get(id));
    return (
      !first ||
      !center ||
      !third ||
      distance(first, center) <= 1e-9 ||
      distance(third, center) <= 1e-9
    );
  }
  if (node.kind === "unary" || node.kind === "function") {
    return mathHasDegenerateAngle(node.value, map);
  }
  if (node.kind === "binary") {
    return (
      mathHasDegenerateAngle(node.left, map) ||
      mathHasDegenerateAngle(node.right, map)
    );
  }
  return false;
}

function predicateIsDegenerate(
  predicate: ParsedConstraint,
  map: Map<string, Point>,
) {
  if (predicate.ids.some((id) => !map.has(id))) return true;
  if (predicate.kind === "angle") {
    const [first, center, third] = predicate.ids.map((id) => map.get(id));
    return (
      !first ||
      !center ||
      !third ||
      distance(first, center) <= 1e-9 ||
      distance(third, center) <= 1e-9
    );
  }
  if (predicate.kind === "parallel" || predicate.kind === "perpendicular") {
    const points = predicate.ids.map((id) => map.get(id));
    return (
      points.some((point) => !point) ||
      distance(points[0] as Point, points[1] as Point) <= 1e-9 ||
      distance(points[2] as Point, points[3] as Point) <= 1e-9
    );
  }
  if (predicate.kind === "formula") {
    return (predicate.formulas ?? (predicate.formula ? [predicate.formula] : []))
      .some(
        (formula) =>
          mathHasDegenerateAngle(formula.left, map) ||
          mathHasDegenerateAngle(formula.right, map),
      );
  }
  if (predicate.kind === "inequality") {
    return (
      predicate.comparisons ??
      (predicate.comparison ? [predicate.comparison] : [])
    ).some(
      (comparison) =>
        mathHasDegenerateAngle(comparison.left, map) ||
        mathHasDegenerateAngle(comparison.right, map),
    );
  }
  return false;
}

type NumericalPredicateEvaluation = {
  state: "true" | "false" | "uncertain";
  error?: number;
};

function equalityEvaluation(
  left: number,
  right: number,
  tolerance: number,
): NumericalPredicateEvaluation {
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return { state: "uncertain" };
  }
  const scale = Math.max(Math.abs(left), Math.abs(right), 1);
  const error = Math.abs(left - right) / scale;
  return {
    state: error <= Math.max(tolerance * 10, 1e-9) ? "true" : "false",
    error,
  };
}

function comparisonEvaluation(
  comparison: FormulaComparison,
  map: Map<string, Point>,
  variables: Map<string, MathNode>,
  angleUnit: AngleUnit,
  shapes: Shape[],
  tolerance: number,
): NumericalPredicateEvaluation {
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
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return { state: "uncertain" };
  }
  const scale = Math.max(Math.abs(left), Math.abs(right), 1);
  const signedError = (left - right) / scale;
  const band = Math.max(tolerance * 10, 1e-9);
  if (comparison.operator === "<") {
    return {
      state:
        signedError < -band
          ? "true"
          : signedError > band
            ? "false"
            : "uncertain",
      error: Math.abs(signedError),
    };
  }
  if (comparison.operator === ">") {
    return {
      state:
        signedError > band
          ? "true"
          : signedError < -band
            ? "false"
            : "uncertain",
      error: Math.abs(signedError),
    };
  }
  if (comparison.operator === "<=") {
    return {
      state:
        signedError < -band
          ? "true"
          : signedError > band
            ? "false"
            : "uncertain",
      error: Math.abs(signedError),
    };
  }
  if (comparison.operator === ">=") {
    return {
      state:
        signedError > band
          ? "true"
          : signedError < -band
            ? "false"
            : "uncertain",
      error: Math.abs(signedError),
    };
  }
  return {
    state: Math.abs(signedError) > band ? "true" : "uncertain",
    error: Math.abs(signedError),
  };
}

function combinePredicateEvaluations(
  evaluations: NumericalPredicateEvaluation[],
): NumericalPredicateEvaluation {
  const falseResult = evaluations.find((evaluation) => evaluation.state === "false");
  if (falseResult) return falseResult;
  if (
    evaluations.length &&
    evaluations.every((evaluation) => evaluation.state === "true")
  ) {
    return {
      state: "true",
      error: Math.max(...evaluations.map((evaluation) => evaluation.error ?? 0)),
    };
  }
  return { state: "uncertain" };
}

function evaluateNumericalPredicate(
  predicate: ParsedConstraint,
  map: Map<string, Point>,
  variables: Map<string, MathNode>,
  angleUnit: AngleUnit,
  shapes: Shape[],
  tolerance: number,
): NumericalPredicateEvaluation {
  const points = predicate.ids.map((id) => map.get(id));
  if (points.some((point) => !point)) return { state: "uncertain" };
  const p = points as Point[];
  if (predicate.kind === "distance") {
    return equalityEvaluation(
      distance(p[0], p[1]),
      predicate.value ?? 0,
      tolerance,
    );
  }
  if (predicate.kind === "angle") {
    return equalityEvaluation(
      angleDegrees(p[0], p[1], p[2]),
      predicate.value ?? 0,
      tolerance,
    );
  }
  if (predicate.kind === "area") {
    return equalityEvaluation(polygonArea(p), predicate.value ?? 0, tolerance);
  }
  if (predicate.kind === "parallel" || predicate.kind === "perpendicular") {
    const ux = p[1].x - p[0].x;
    const uy = p[1].y - p[0].y;
    const vx = p[3].x - p[2].x;
    const vy = p[3].y - p[2].y;
    const denominator = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    if (denominator <= 1e-9) return { state: "uncertain" };
    const error = Math.abs(
      predicate.kind === "parallel"
        ? (ux * vy - uy * vx) / denominator
        : (ux * vx + uy * vy) / denominator,
    );
    return {
      state: error <= Math.max(tolerance * 10, 1e-9) ? "true" : "false",
      error,
    };
  }
  if (predicate.kind === "distinctPoints") {
    let minimum = Number.POSITIVE_INFINITY;
    for (let first = 0; first < p.length; first += 1) {
      for (let second = first + 1; second < p.length; second += 1) {
        minimum = Math.min(minimum, distance(p[first], p[second]));
      }
    }
    const scale = Math.max(
      ...p.map((point) => Math.hypot(point.x, point.y)),
      1,
    );
    const normalized = minimum / scale;
    return normalized <= Math.max(tolerance * 10, 1e-9)
      ? { state: "uncertain", error: normalized }
      : { state: "true", error: normalized };
  }
  if (predicate.kind === "formula") {
    const equations = predicate.formulas ??
      (predicate.formula ? [predicate.formula] : []);
    return combinePredicateEvaluations(
      equations.map((equation) => {
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
        return equalityEvaluation(left, right, tolerance);
      }),
    );
  }
  if (predicate.kind === "inequality") {
    const comparisons = predicate.comparisons ??
      (predicate.comparison ? [predicate.comparison] : []);
    return combinePredicateEvaluations(
      comparisons.map((comparison) =>
        comparisonEvaluation(
          comparison,
          map,
          variables,
          angleUnit,
          shapes,
          tolerance,
        ),
      ),
    );
  }
  return { state: "uncertain" };
}

function numericalPredicateResults(
  targets: UnknownTarget[],
  knownRows: ExpressionRow[],
  solvedMap: Map<string, Point>,
  variables: Map<string, MathNode>,
  angleUnit: AngleUnit,
  shapes: Shape[],
  exactSystem: boolean,
  tolerance: number,
): ProofResult[] {
  const directKnown = new Set(
    knownRows
      .filter((row) => row.enabled)
      .map((row) => parseConstraint(row.expression, angleUnit))
      .filter((constraint): constraint is ParsedConstraint => Boolean(constraint))
      .map(constraintProofKey)
      .filter((key): key is string => Boolean(key)),
  );
  return targets
    .filter(
      (target): target is UnknownTarget & { predicate: ParsedConstraint } =>
        target.kind === "predicate" && Boolean(target.predicate),
    )
    .map((target) => {
      if (predicateIsDegenerate(target.predicate, solvedMap)) {
        return {
          label: target.label,
          verdict: "undetermined",
          evidence: "unsupported",
          detail: {
            ru: "Цель ссылается на отсутствующий объект или содержит вырожденный угол.",
            en: "The target references a missing object or contains a degenerate angle.",
          },
          steps: [],
        };
      }
      const targetKey = constraintProofKey(target.predicate);
      if (targetKey && directKnown.has(targetKey)) {
        return {
          label: target.label,
          verdict: "proved",
          evidence: "direct",
          detail: {
            ru: "Выражение непосредственно задано в условиях.",
            en: "The statement is given directly as a condition.",
          },
          steps: [
            {
              title: { ru: "Дано", en: "Given" },
              detail: {
                ru: "Цель совпадает с одним из исходных условий.",
                en: "The target matches one of the original conditions.",
              },
              expression: target.label,
            },
          ],
        };
      }
      if (!exactSystem) {
        return {
          label: target.label,
          verdict: "undetermined",
          evidence: "unsupported",
          detail: {
            ru: "Численный поиск не даёт логического доказательства для этой цели.",
            en: "Numerical search does not provide a logical proof for this target.",
          },
          steps: [],
        };
      }
      const evaluation = evaluateNumericalPredicate(
        target.predicate,
        solvedMap,
        variables,
        angleUnit,
        shapes,
        tolerance,
      );
      if (evaluation.state === "false") {
        const error = evaluation.error ?? Number.NaN;
        return {
          label: target.label,
          verdict: "undetermined",
          evidence: "counterexample",
          detail: {
            ru: "Найден численный кандидат на контрпример, но без точной сертификации он не является формальным опровержением.",
            en: "A numerical counterexample candidate was found, but without exact certification it is not a formal refutation.",
          },
          steps: [
            {
              title: {
                ru: "Кандидат на контрпример",
                en: "Counterexample candidate",
              },
              detail: {
                ru: Number.isFinite(error)
                  ? `Численное отклонение проверяемого выражения: ${error.toExponential(3)}.`
                  : "Численная проверка выражения не прошла.",
                en: Number.isFinite(error)
                  ? `Numerical target deviation: ${error.toExponential(3)}.`
                  : "The numerical target check failed.",
              },
              expression: target.label,
            },
          ],
        };
      }
      if (evaluation.state === "uncertain") {
        return {
          label: target.label,
          verdict: "undetermined",
          evidence: "unsupported",
          detail: {
            ru: "Численная точность недостаточна, чтобы надёжно установить истинность выражения.",
            en: "Numerical precision is insufficient to establish the statement reliably.",
          },
          steps: [],
        };
      }
      return {
        label: target.label,
        verdict: "undetermined",
        evidence: "unsupported",
        detail: {
          ru: "В найденном решении выражение выполняется, но один численный пример не является доказательством.",
          en: "The statement holds in the found solution, but one numerical sample is not a proof.",
        },
        steps: [],
      };
    });
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
  if (constraint.kind === "convex") {
    return constraint.source ?? `convex(${constraint.ids.join("")})`;
  }
  if (constraint.kind === "insideFigure") {
    return constraint.source ?? "figure inside figure";
  }
  if (constraint.kind === "intersectionSet") {
    return constraint.source ?? "множество пересечений";
  }
  if (constraint.kind === "nonIntersecting") {
    if (constraint.source) return constraint.source;
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
  const segmentMemberships = parsedRows
    .map(({ parsed }) => parsed)
    .filter((parsed) => parsed.kind === "onSegment");
  parsedRows.forEach((item) => {
    const parsed = item.parsed;
    if (
      parsed.kind !== "angle" ||
      parsed.value === undefined ||
      Math.abs(parsed.value - 90) > 1e-10
    ) {
      return;
    }
    const [first, vertex, second] = parsed.ids;
    const collinearArm = segmentMemberships.find(
      (membership) =>
        membership.ids[0] === vertex &&
        (membership.ids[1] === second || membership.ids[2] === second),
    );
    if (!collinearArm) return;
    item.parsed = {
      kind: "perpendicular",
      ids: [first, vertex, collinearArm.ids[1], collinearArm.ids[2]],
      source: parsed.source,
    };
  });
  const unknownTargets = unknownRows
    .filter((row) => row.enabled)
    .map((row) => parseUnknown(row.expression, angleUnit))
    .filter((target): target is UnknownTarget => Boolean(target));
  if (!parsedRows.length) {
    const statements = numericalPredicateResults(
      unknownTargets,
      rows,
      pointMap(currentPoints),
      new Map(),
      angleUnit,
      currentShapes,
      false,
      tolerance,
    );
    return {
      points: currentPoints,
      result: {
        kind: "empty",
        residual: 0,
        elapsed: 0,
        iterations: 0,
        timedOut: false,
        values: [],
        statements,
        mode: "numerical",
        issues: [],
      } satisfies SolveResult,
    };
  }
  const variables = new Map<string, MathNode>();
  const definitionSources = new Map<string, MathNode>();
  const constraintRows: {
    row: ExpressionRow;
    parsed: ParsedConstraint;
  }[] = [];
  parsedRows.forEach(({ row, parsed }) => {
    if (parsed.kind !== "definition" || !parsed.definition) {
      constraintRows.push({ row, parsed });
      return;
    }
    const { name, value } = parsed.definition;
    const canonical = definitionSources.get(name);
    if (!canonical) {
      definitionSources.set(name, value);
      variables.set(name, value);
      return;
    }
    const ids = new Set<string>();
    collectMathIds(canonical, ids);
    collectMathIds(value, ids);
    const equation: FormulaEquation = {
      left: { kind: "variable", name },
      right: value,
      source: row.expression,
    };
    constraintRows.push({
      row,
      parsed: {
        kind: "formula",
        ids: [...ids],
        formula: equation,
        formulas: [equation],
        source: row.expression,
      },
    });
  });
  const coordinateAnchors = new Map<
    string,
    { x?: number; y?: number }
  >();
  constraintRows.forEach(({ parsed }) => {
    if (parsed.kind !== "formula") return;
    (parsed.formulas ?? (parsed.formula ? [parsed.formula] : [])).forEach(
      (equation) => {
        if (
          equation.left.kind !== "measure" ||
          (equation.left.measure !== "x" && equation.left.measure !== "y") ||
          equation.left.ids.length !== 1
        ) {
          return;
        }
        const referenced = new Set<string>();
        collectMathIds(equation.right, referenced);
        if (referenced.size) return;
        const value = evaluateMath(
          equation.right,
          pointMap(currentPoints),
          variables,
          angleUnit,
          currentShapes,
        );
        if (!Number.isFinite(value)) return;
        const id = equation.left.ids[0];
        const anchor = coordinateAnchors.get(id) ?? {};
        anchor[equation.left.measure] = value;
        coordinateAnchors.set(id, anchor);
      },
    );
  });
  const completeAnchor = [...coordinateAnchors].find(
    ([id, anchor]) =>
      anchor.x !== undefined &&
      anchor.y !== undefined &&
      currentPoints.some((point) => point.id === id),
  );
  const initialPoints = completeAnchor
    ? (() => {
        const [id, anchor] = completeAnchor;
        const current = currentPoints.find((point) => point.id === id) as Point;
        const offsetX = (anchor.x as number) - current.x;
        const offsetY = (anchor.y as number) - current.y;
        return currentPoints.map((point) => ({
          ...point,
          x: point.x + offsetX,
          y: point.y + offsetY,
        }));
      })()
    : currentPoints;
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
    initialPoints
      .filter((point) => fixedLineAnchorIds.has(point.id))
      .map((point) => [point.id, point]),
  );
  const tangentCircleTriples = derivedTangentCircleTriples(
    constraintRows.map(({ parsed }) => parsed),
    pointMap(initialPoints),
    currentShapes,
  );
  const searchPoints = initialPoints.filter(
    (point) => !fixedLineAnchorIds.has(point.id),
  );
  const search = solveCoordinates(
    searchPoints,
    tolerance,
    (coordinateMap) => {
      const completeMap = new Map(fixedLineAnchors);
      coordinateMap.forEach((point, id) => completeMap.set(id, point));
      const constraintErrors = constraintRows.flatMap(({ parsed }) =>
        constraintResiduals(
          parsed,
          completeMap,
          variables,
          angleUnit,
          currentShapes,
        ),
      );
      return [
        ...constraintErrors,
        ...tangentCircleTriples.map((ids) =>
          tangentCircleTripleResidual(ids, completeMap),
        ),
      ];
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
  let residualOffset = 0;
  const individualErrors = constraintRows.map(({ row, parsed }) => {
    const currentResiduals = constraintResiduals(
      parsed,
      solvedMap,
      variables,
      angleUnit,
      currentShapes,
    );
    const searchedResiduals = search.errors.slice(
      residualOffset,
      residualOffset + currentResiduals.length,
    );
    residualOffset += currentResiduals.length;
    const errors =
      searchedResiduals.length === currentResiduals.length
        ? searchedResiduals
        : currentResiduals.map(Math.abs);
    return {
      expression: row.expression,
      error: Math.sqrt(
        errors.reduce((sum, error) => sum + error * error, 0) /
          Math.max(errors.length, 1),
      ),
    };
  });
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
  const statements = numericalPredicateResults(
    unknownTargets,
    rows,
    solvedMap,
    variables,
    angleUnit,
    currentShapes,
    search.residual < tolerance,
    tolerance,
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
      statements,
      mode: "numerical",
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
  updated = updated.replace(/\{([^{}]*)\}/g, (_, contents) =>
    `{${String(contents).replace(/\b([A-Z])\b/g, (__, id) => rename(id))}}`,
  );
  updated = updated.replace(
    /^(\s*)([A-Z])(\s*(?:=|∈)\s*.*∩.*)$/,
    (_, prefix, id, suffix) => `${prefix}${rename(id)}${suffix}`,
  );
  updated = updated.replace(
    /^(.*∩.*\s*=\s*)([A-Z])(\s*)$/,
    (_, prefix, id, suffix) => `${prefix}${rename(id)}${suffix}`,
  );
  updated = updated.replace(
    /∠\s*([A-Z])([A-Z])([A-Z])/g,
    (_, a, b, c) => `∠${rename(a)}${rename(b)}${rename(c)}`,
  );
  updated = updated.replace(
    /(\b(?:S|AREA|ANGLE|LEN|LINE|RAY|CIRCLE|ELLIPSE|SECTOR|SEGMENT|CIRCULARSEGMENT|POLYGON|DISTINCT|РАЗЛИЧНЫ)\s*\()([A-Z]+)(\))/gi,
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
