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
  MathPointNode,
  MathNode,
  ParsedConstraint,
  Point,
  ProofResult,
  Shape,
  SolveResult,
  SolverProgress,
  SetExpression,
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

const POINT_ID_SOURCE = String.raw`[A-Z]\d*`;
const POINT_ID_SEQUENCE_SOURCE = String.raw`(?:${POINT_ID_SOURCE})+`;

function splitPointIds(source: string) {
  const clean = source.toUpperCase();
  const ids = clean.match(/[A-Z]\d*/g) ?? [];
  return ids.length > 0 && ids.join("") === clean ? ids : null;
}

function parseComputedPointSequence(source: string) {
  const points: MathPointNode[] = [];
  let position = 0;
  while (position < source.length) {
    while (/\s/.test(source[position] ?? "")) position += 1;
    if (position >= source.length) break;
    if (source[position] !== "(") return null;
    const start = position;
    let depth = 0;
    do {
      const character = source[position];
      if (character === "(") depth += 1;
      if (character === ")") depth -= 1;
      position += 1;
    } while (position < source.length && depth > 0);
    if (depth !== 0) return null;
    const parsed = parseMathExpression(source.slice(start, position));
    if (parsed?.kind !== "point") return null;
    points.push(parsed);
  }
  return points.length ? points : null;
}

const DISTANCE_OBJECT_ARGUMENT =
  String.raw`(?:(?:point|segment|line|ray|circle|ellipse|sector|circularsegment|polygon)\s*\(\s*(?:[A-Za-z]\d*)+\s*\)|(?:equation|eq)\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s*\)|[a-z_][A-Za-z0-9_]*|(?:[A-Z]\d*)+)`;
const AREA_GEOMETRY_ARGUMENT =
  String.raw`(?:(?:circle|ellipse|sector|segment|circularsegment|polygon)\s*\(\s*(?:[A-Za-z]\d*)+\s*\)|(?:equation|eq)\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s*\)|[a-z_][A-Za-z0-9_]*|(?:[A-Za-z]\d*){3,})`;

function encodeEquationName(name: string) {
  return [...name]
    .map((character) => character.charCodeAt(0).toString(16).padStart(4, "0"))
    .join("");
}

function decodeEquationName(encoded: string) {
  const characters = encoded.match(/.{4}/g);
  return characters
    ? characters.map((value) => String.fromCharCode(Number.parseInt(value, 16))).join("")
    : "";
}

function encodeGeometryReference(source: string) {
  const clean = source.replace(/\s+/g, "");
  const equation = clean.match(
    /^(?:(?:equation|eq)\(([A-Za-z_][A-Za-z0-9_]*)\)|([a-z_][A-Za-z0-9_]*))$/i,
  );
  if (equation && (equation[1] || /^[a-z_]/.test(clean))) {
    return `EQUATION_${encodeEquationName(equation[1] ?? equation[2])}`;
  }
  const explicit = clean.match(
    /^(circle|ellipse|sector|segment|circularsegment|polygon)\(((?:[A-Za-z]\d*)+)\)$/i,
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
  const equation = clean.match(
    /^(?:(?:equation|eq)\(([A-Za-z_][A-Za-z0-9_]*)\)|([a-z_][A-Za-z0-9_]*))$/i,
  );
  if (equation && (equation[1] || /^[a-z_]/.test(clean))) {
    return `EQUATION_${encodeEquationName(equation[1] ?? equation[2])}`;
  }
  const explicit = clean.match(
    /^(point|segment|line|ray|circle|ellipse|sector|circularsegment|polygon)\(((?:[A-Za-z]\d*)+)\)$/i,
  );
  if (explicit) {
    return `${explicit[1].toUpperCase()}_${explicit[2].toUpperCase()}`;
  }
  const ids = clean.toUpperCase();
  const idCount = splitPointIds(ids)?.length ?? 0;
  const kind = idCount === 1 ? "POINT" : idCount === 2 ? "SEGMENT" : "POLYGON";
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
    .replace(
      /\b(?:area|s)\s*\(\s*(?:(?:equation|eq)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)|([a-z_][A-Za-z0-9_]*))\s*\)/gi,
      (match, explicit, bare) =>
        explicit || /^[a-z_]/.test(bare)
          ? `AREA_EQUATION_${encodeEquationName(explicit ?? bare)}`
          : match,
    )
    .replace(
      /\b(?:perimeter|perim|p)\s*\(\s*(?:(?:equation|eq)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)|([a-z_][A-Za-z0-9_]*))\s*\)/gi,
      (match, explicit, bare) =>
        explicit || /^[a-z_]/.test(bare)
          ? `PERIMETER_EQUATION_${encodeEquationName(explicit ?? bare)}`
          : match,
    )
    .replace(/\\deg\b/gi, "°")
    .replace(
      /(-?(?:\d+(?:\.\d+)?|\.\d+))\s*°/g,
      (_, value) => `deg(${value})`,
    )
    .replace(/√\s*\(/g, "sqrt(")
    .replace(/∠\s*([A-Za-z]\d*)([A-Za-z]\d*)([A-Za-z]\d*)/g, (_, a, b, c) =>
      `ANGLE_${a}${b}${c}`.toUpperCase(),
    )
    .replace(
      /\b([xy])\s*\(\s*([A-Za-z]\d*)\s*\)/gi,
      (_, axis, id) => `COORD_${axis}_${id}`.toUpperCase(),
    )
    .replace(
      /\b([A-Za-z]\d*)\s*\.\s*([xy])\b/gi,
      (_, id, axis) => `COORD_${axis}_${id}`.toUpperCase(),
    )
    .replace(
      /\b(?:angle|угол)\s*\(\s*([A-Za-z]\d*)([A-Za-z]\d*)([A-Za-z]\d*)\s*\)/gi,
      (_, a, b, c) => `ANGLE_${a}${b}${c}`.toUpperCase(),
    )
    .replace(
      /\b(?:area|s)\s*\(\s*(circle|ellipse|sector|segment|circularsegment)\s*\(\s*((?:[A-Za-z]\d*){2,3})\s*\)\s*\)/gi,
      (_, geometry, ids) =>
        `AREA_${String(geometry).toUpperCase()}_${String(ids).toUpperCase()}`,
    )
    .replace(
      /\b(?:perimeter|perim|p)\s*\(\s*(circle|ellipse|sector|segment|circularsegment)\s*\(\s*((?:[A-Za-z]\d*){2,3})\s*\)\s*\)/gi,
      (_, geometry, ids) =>
        `PERIMETER_${String(geometry).toUpperCase()}_${String(ids).toUpperCase()}`,
    )
    .replace(
      /\b(?:area|s)\s*\(\s*((?:[A-Za-z]\d*\s*,?\s*){3,})\)/gi,
      (_, ids) =>
        `AREA_${String(ids).replace(/[^A-Za-z0-9]/g, "")}`.toUpperCase(),
    )
    .replace(
      /\b(?:perimeter|perim|p)\s*\(\s*((?:[A-Za-z]\d*\s*,?\s*){3,})\)/gi,
      (_, ids) =>
        `PERIMETER_${String(ids).replace(/[^A-Za-z0-9]/g, "")}`.toUpperCase(),
    )
    .replace(
      /\b(?:len|length)\s*\(\s*([A-Za-z]\d*)([A-Za-z]\d*)\s*\)/gi,
      (_, a, b) => `LEN_${a}${b}`.toUpperCase(),
    )
    .replace(/\b([A-Z]\d*)([A-Z]\d*)\b/g, (_, a, b) => `LEN_${a}${b}`)
    .replace(/π/g, "PI");
}

function tokenizeMath(source: string) {
  const tokens: string[] = [];
  let rest = source;
  while (rest.trim().length) {
    const match = rest.match(
      /^\s*(\d+(?:\.\d+)?|\.\d+|[A-Za-z_][A-Za-z0-9_]*|[(),;+\-*/^])/
    );
    if (!match) return null;
    tokens.push(match[1]);
    rest = rest.slice(match[0].length);
  }
  return tokens;
}

export function parseMathExpression(source: string): MathNode | null {
  const setArea = normalizeSetOperators(source).match(
    /^\s*(?:area|s)\s*\(\s*(.+)\s*\)\s*$/i,
  );
  if (setArea && /[∩∪]/.test(setArea[1])) {
    const set = parseSetExpression(setArea[1]);
    if (!set) return null;
    const objects = setObjects(set);
    const needsExtendedSetArea =
      set.kind === "union" ||
      objects.length !== 2 ||
      objects.some((object) => object.kind === "equation");
    if (!needsExtendedSetArea) {
      // Preserve the exact two-geometry implementation used by existing
      // projects; the grid evaluator is reserved for genuinely general sets.
    } else {
      return {
        kind: "measure",
        measure: "setArea",
        ids: [...new Set(objects.flatMap((object) => object.ids))],
        set,
      };
    }
  }
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
      if (!value) return null;
      if (peek() === ";") {
        take();
        const y = parseAdditive();
        if (!y || take() !== ")") return null;
        return { kind: "point", x: value, y };
      }
      if (take() !== ")") return null;
      return value;
    }
    if (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(token)) {
      return { kind: "number", value: Number(token) };
    }
    const functionName = token.toLowerCase();
    const parsePointArgument = (): {
      point: MathPointNode;
      id?: string;
    } | null => {
      const reference = peek();
      if (reference && /^[A-Z]\d*$/.test(reference)) {
        take();
        return {
          id: reference,
          point: {
            kind: "point",
            x: { kind: "measure", measure: "x", ids: [reference] },
            y: { kind: "measure", measure: "y", ids: [reference] },
          },
        };
      }
      const value = parsePrimary();
      return value?.kind === "point" ? { point: value } : null;
    };
    const parseDistanceArgument = (): DistanceObject | null => {
      if (peek() === "(") {
        const pointArguments: MathPointNode[] = [];
        while (peek() === "(") {
          const value = parsePrimary();
          if (value?.kind !== "point") return null;
          pointArguments.push(value);
        }
        if (pointArguments.length === 1) {
          return {
            kind: "point",
            ids: [],
            point: pointArguments[0],
            pointArguments,
          };
        }
        if (pointArguments.length === 2) {
          return { kind: "segment", ids: [], pointArguments };
        }
        return pointArguments.length >= 3
          ? { kind: "polygon", ids: [], pointArguments }
          : null;
      }
      const source = peek();
      if (!source) return null;
      if (/^LEN_(?:[A-Z]\d*){2}$/.test(source)) {
        take();
        return { kind: "segment", ids: splitPointIds(source.slice(4)) ?? [] };
      }
      if (/^[A-Z]\d*(?:[A-Z]\d*)*$/.test(source)) {
        take();
        const ids = splitPointIds(source) ?? [];
        return ids.length === 1
          ? { kind: "point", ids }
          : ids.length === 2
            ? { kind: "segment", ids }
            : ids.length >= 3
              ? { kind: "polygon", ids }
              : null;
      }
      const explicitKinds = new Map<string, DistanceObject["kind"]>([
        ["point", "point"],
        ["segment", "segment"],
        ["line", "line"],
        ["ray", "ray"],
        ["circle", "circle"],
        ["ellipse", "ellipse"],
        ["sector", "sector"],
        ["circularsegment", "circularSegment"],
        ["polygon", "polygon"],
      ]);
      const explicitKind = explicitKinds.get(source.toLowerCase());
      if (explicitKind) {
        take();
        if (take() !== "(") return null;
        if (peek() === "(") {
          const pointArguments: MathPointNode[] = [];
          while (peek() === "(") {
            const value = parsePrimary();
            if (value?.kind !== "point") return null;
            pointArguments.push(value);
            if (peek() === ",") take();
          }
          if (take() !== ")") return null;
          const valid = explicitKind === "point"
            ? pointArguments.length === 1
            : explicitKind === "polygon"
              ? pointArguments.length >= 3
              : explicitKind === "ellipse" ||
                  explicitKind === "sector" ||
                  explicitKind === "circularSegment"
                ? pointArguments.length === 3
                : pointArguments.length === 2;
          return valid
            ? { kind: explicitKind, ids: [], pointArguments }
            : null;
        }
        const rawIdsSource = take();
        const idsSource = rawIdsSource?.startsWith("LEN_")
          ? rawIdsSource.slice(4)
          : rawIdsSource;
        if (!idsSource || take() !== ")") return null;
        const ids = splitPointIds(idsSource) ?? [];
        const valid = explicitKind === "point"
          ? ids.length === 1
          : explicitKind === "polygon"
            ? ids.length >= 3
            : explicitKind === "ellipse" ||
                explicitKind === "sector" ||
                explicitKind === "circularSegment"
              ? ids.length === 3
              : ids.length === 2;
        return valid ? { kind: explicitKind, ids } : null;
      }
      if (/^(?:eq|equation)$/i.test(source) && tokens[position + 1] === "(") {
        take();
        take();
        const name = take();
        if (!name || take() !== ")") return null;
        return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
          ? { kind: "equation", ids: [], name }
          : null;
      }
      if (/^[a-z_][A-Za-z0-9_]*$/.test(source)) {
        take();
        return { kind: "equation", ids: [], name: source };
      }
      return null;
    };
    if ((functionName === "distance" || functionName === "dist") && peek() === "(") {
      take();
      const first = parseDistanceArgument();
      if (!first || take() !== ",") return null;
      const second = parseDistanceArgument();
      if (!second || take() !== ")") return null;
      return {
        kind: "measure",
        measure: "objectDistance",
        ids: [...new Set([...first.ids, ...second.ids])],
        objects: [first, second],
      };
    }
    if (
      ["angle", "area", "s", "perimeter", "perim", "p"].includes(functionName) &&
      peek() === "("
    ) {
      take();
      const arguments_: MathPointNode[] = [];
      const ids: string[] = [];
      while (true) {
        const argument = parsePointArgument();
        if (!argument) return null;
        arguments_.push(argument.point);
        if (argument.id) ids.push(argument.id);
        if (peek() === ",") {
          take();
        } else if (peek() !== "(") {
          break;
        }
      }
      if (take() !== ")") return null;
      const measure = functionName === "angle"
        ? "angle"
        : functionName === "area" || functionName === "s"
          ? "area"
          : "perimeter";
      if (
        (measure === "angle" && arguments_.length !== 3) ||
        (measure !== "angle" && arguments_.length < 3)
      ) return null;
      return {
        kind: "measure",
        measure,
        ids,
        geometry: measure === "angle" ? undefined : "polygon",
        pointArguments: arguments_,
      };
    }
    if ((functionName === "x" || functionName === "y") && peek() === "(") {
      take();
      const argument = parsePointArgument();
      if (!argument || take() !== ")") return null;
      return {
        kind: "measure",
        measure: functionName,
        ids: argument.id ? [argument.id] : [],
        pointArguments: [argument.point],
      };
    }
    const lengthIds = token.startsWith("LEN_")
      ? splitPointIds(token.slice(4))
      : null;
    if (lengthIds?.length === 2) {
      return {
        kind: "measure",
        measure: "distance",
        ids: lengthIds,
      };
    }
    const objectDistance = token.match(
      /^OBJECTDISTANCE_(POINT|SEGMENT|LINE|RAY|CIRCLE|ELLIPSE|SECTOR|CIRCULARSEGMENT|POLYGON|EQUATION)_([A-Za-z0-9]+)_(POINT|SEGMENT|LINE|RAY|CIRCLE|ELLIPSE|SECTOR|CIRCULARSEGMENT|POLYGON|EQUATION)_([A-Za-z0-9]+)$/,
    );
    if (objectDistance) {
      const toObject = (kind: string, ids: string): DistanceObject =>
        kind === "EQUATION"
          ? { kind: "equation", ids: [], name: decodeEquationName(ids) }
          : {
              kind:
                kind === "CIRCULARSEGMENT"
                  ? "circularSegment"
                  : (kind.toLowerCase() as DistanceObject["kind"]),
              ids: splitPointIds(ids) ?? [],
            };
      const first = toObject(objectDistance[1], objectDistance[2]);
      const second = toObject(objectDistance[3], objectDistance[4]);
      const validObject = (object: DistanceObject) =>
        object.kind === "equation"
          ? Boolean(object.name)
          : object.kind === "point"
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
      /^INTERSECTIONAREA_(POLYGON|CIRCLE|ELLIPSE|SECTOR|CIRCULARSEGMENT|EQUATION)_([A-Za-z0-9]+)_(POLYGON|CIRCLE|ELLIPSE|SECTOR|CIRCULARSEGMENT|EQUATION)_([A-Za-z0-9]+)$/,
    );
    if (intersectionArea) {
      const toGeometry = (kind: string, ids: string): GeometryReference =>
        kind === "EQUATION"
          ? { kind: "equation", ids: [], name: decodeEquationName(ids) }
          : {
              kind:
                kind === "CIRCULARSEGMENT"
                  ? "circularSegment"
                  : (kind.toLowerCase() as GeometryKind),
              ids: splitPointIds(ids) ?? [],
            };
      const first = toGeometry(intersectionArea[1], intersectionArea[2]);
      const second = toGeometry(intersectionArea[3], intersectionArea[4]);
      const validGeometry = (geometry: GeometryReference) =>
        geometry.kind === "equation"
          ? Boolean(geometry.name)
          : geometry.kind === "polygon"
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
    const angleIds = token.startsWith("ANGLE_")
      ? splitPointIds(token.slice(6))
      : null;
    if (angleIds?.length === 3) {
      return {
        kind: "measure",
        measure: "angle",
        ids: angleIds,
      };
    }
    const polygonAreaIds = token.startsWith("AREA_")
      ? splitPointIds(token.slice(5))
      : null;
    if (polygonAreaIds && polygonAreaIds.length >= 3) {
      return {
        kind: "measure",
        measure: "area",
        ids: polygonAreaIds,
        geometry: "polygon",
      };
    }
    const equationMetric = token.match(
      /^(AREA|PERIMETER)_EQUATION_([A-Fa-f0-9]+)$/,
    );
    if (equationMetric) {
      return {
        kind: "measure",
        measure: equationMetric[1] === "AREA" ? "area" : "perimeter",
        ids: [],
        geometry: "equation",
        shapeName: decodeEquationName(equationMetric[2]),
      };
    }
    const circularMeasure = token.match(
      /^(AREA|PERIMETER)_(CIRCLE|ELLIPSE|SECTOR|SEGMENT|CIRCULARSEGMENT)_([A-Z0-9]+)$/,
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
        ids: splitPointIds(circularMeasure[3]) ?? [],
        geometry: geometry as GeometryKind,
      };
    }
    const polygonPerimeterIds = token.startsWith("PERIMETER_")
      ? splitPointIds(token.slice(10))
      : null;
    if (polygonPerimeterIds && polygonPerimeterIds.length >= 3) {
      return {
        kind: "measure",
        measure: "perimeter",
        ids: polygonPerimeterIds,
        geometry: "polygon",
      };
    }
    const coordinate = token.match(/^COORD_([XY])_([A-Z]\d*)$/);
    if (coordinate) {
      return {
        kind: "measure",
        measure: coordinate[1].toLowerCase() as "x" | "y",
        ids: [coordinate[2]],
      };
    }
    if (token.toUpperCase() === "PI") {
      return { kind: "number", value: Math.PI };
    }
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

export type CompiledImplicitEquation = {
  left: MathNode;
  right: MathNode;
  operator: "=" | "<" | ">" | "<=" | ">=";
  source: string;
};

/** Parse an equation whose x and y identifiers are local plane coordinates. */
export function compileImplicitEquation(
  source: string,
): CompiledImplicitEquation | null {
  const normalized = source.replace(/≤/g, "<=").replace(/≥/g, ">=");
  const match = normalized.match(/^\s*(.+?)\s*(<=|>=|=|<|>)\s*(.+?)\s*$/);
  if (!match) return null;
  const left = parseMathExpression(match[1]);
  const right = parseMathExpression(match[3]);
  if (!left || !right) return null;
  return {
    left,
    right,
    operator: match[2] as CompiledImplicitEquation["operator"],
    source: source.trim(),
  };
}

export type ImplicitEquationValue = {
  valid: boolean;
  difference: number;
  scale: number;
  inside: boolean;
  boundaryError: number;
  membershipError: number;
};

export function evaluateImplicitEquation(
  equation: CompiledImplicitEquation,
  point: Pick<Point, "x" | "y">,
  map: Map<string, Point>,
  variables: Map<string, MathNode> = new Map(),
  angleUnit: AngleUnit = "degrees",
  shapes: Shape[] = [],
): ImplicitEquationValue {
  // Local plane coordinates intentionally shadow equally named variables from
  // the condition list. The object editor exposes this fact as a warning.
  const localVariables = new Map(variables);
  localVariables.set("x", { kind: "number", value: point.x });
  localVariables.set("y", { kind: "number", value: point.y });
  const left = evaluateMath(
    equation.left,
    map,
    localVariables,
    angleUnit,
    shapes,
  );
  const right = evaluateMath(
    equation.right,
    map,
    localVariables,
    angleUnit,
    shapes,
  );
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return {
      valid: false,
      difference: Number.NaN,
      scale: 1,
      inside: false,
      boundaryError: 10,
      membershipError: 10,
    };
  }
  const difference = left - right;
  // A max(|lhs|, |rhs|) normalization becomes exactly constant for equations
  // such as y = 0 while |y| > 1, leaving a finite-difference solver with no
  // gradient. Square-root scaling remains numerically bounded without erasing
  // the direction toward the zero level set.
  const scale = Math.max(1, Math.sqrt(Math.abs(left) + Math.abs(right)));
  const normalized = Math.abs(difference) / scale;
  const margin = 1e-5;
  const inside =
    equation.operator === "="
      ? normalized <= margin
      : equation.operator === "<="
        ? difference <= 0
        : equation.operator === ">="
          ? difference >= 0
          : equation.operator === "<"
            ? difference < 0
            : difference > 0;
  const membershipError =
    equation.operator === "="
      ? normalized
      : equation.operator === "<="
        ? Math.max(0, difference / scale)
        : equation.operator === ">="
          ? Math.max(0, -difference / scale)
          : equation.operator === "<"
            ? Math.max(0, difference / scale + margin)
            : Math.max(0, -difference / scale + margin);
  return {
    valid: true,
    difference,
    scale,
    inside,
    boundaryError: normalized,
    membershipError,
  };
}

function equationShapeByName(name: string | undefined, shapes: Shape[]) {
  if (!name) return undefined;
  const equations = shapes.filter(
    (shape) =>
      shape.type === "equation" &&
      shape.name?.toLowerCase() === name.toLowerCase(),
  );
  return (
    equations.find((shape) => shape.name === name) ??
    (equations.length === 1 ? equations[0] : undefined)
  );
}

function collectMathIds(node: MathNode, ids = new Set<string>()) {
  if (node.kind === "point") {
    collectMathIds(node.x, ids);
    collectMathIds(node.y, ids);
  } else if (node.kind === "measure") {
    node.ids.forEach((id) => ids.add(id));
    node.pointArguments?.forEach((point) => collectMathIds(point, ids));
    node.objects?.forEach((object) => {
      if (object.point) collectMathIds(object.point, ids);
      object.pointArguments?.forEach((point) => collectMathIds(point, ids));
    });
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
    /^\s*([A-Za-z]\d*)\s*=\s*\(\s*(.*?)\s*\)\s*$/,
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

function equationSamplingBounds(map: Map<string, Point>) {
  const points = [...map.values()];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minimumX = xs.length ? Math.min(...xs) : 0;
  const maximumX = xs.length ? Math.max(...xs) : 0;
  const minimumY = ys.length ? Math.min(...ys) : 0;
  const maximumY = ys.length ? Math.max(...ys) : 0;
  const span = Math.max(maximumX - minimumX, maximumY - minimumY, 6);
  const padding = span * 0.75;
  return {
    minimumX: minimumX - padding,
    maximumX: maximumX + padding,
    minimumY: minimumY - padding,
    maximumY: maximumY + padding,
  };
}

function sampleEquationBoundary(
  shape: Shape,
  map: Map<string, Point>,
  variables: Map<string, MathNode>,
  angleUnit: AngleUnit,
  shapes: Shape[],
  resolution = 72,
) {
  const equation = compileImplicitEquation(shape.equation ?? "");
  if (!equation) return [];
  const bounds = equationSamplingBounds(map);
  const stepX = (bounds.maximumX - bounds.minimumX) / resolution;
  const stepY = (bounds.maximumY - bounds.minimumY) / resolution;
  const values = Array.from({ length: resolution + 1 }, (_, row) =>
    Array.from({ length: resolution + 1 }, (_, column) => {
      const point = {
        x: bounds.minimumX + column * stepX,
        y: bounds.minimumY + row * stepY,
      };
      return {
        ...point,
        value: evaluateImplicitEquation(
          equation,
          point,
          map,
          variables,
          angleUnit,
          shapes,
        ).difference,
      };
    }),
  );
  const boundary: Point[] = [];
  const cross = (
    first: { x: number; y: number; value: number },
    second: { x: number; y: number; value: number },
  ) => {
    if (
      !Number.isFinite(first.value) ||
      !Number.isFinite(second.value) ||
      ((first.value < 0) === (second.value < 0) &&
        first.value !== 0 &&
        second.value !== 0)
    ) {
      return;
    }
    const denominator = first.value - second.value;
    const ratio =
      Math.abs(denominator) < 1e-12
        ? 0.5
        : Math.max(0, Math.min(1, first.value / denominator));
    boundary.push({
      id: "",
      x: first.x + (second.x - first.x) * ratio,
      y: first.y + (second.y - first.y) * ratio,
    });
  };
  for (let row = 0; row <= resolution; row += 1) {
    for (let column = 0; column <= resolution; column += 1) {
      if (column < resolution) cross(values[row][column], values[row][column + 1]);
      if (row < resolution) cross(values[row][column], values[row + 1][column]);
    }
  }
  return boundary;
}

function approximateEquationMetric(
  shape: Shape,
  measure: "area" | "perimeter",
  map: Map<string, Point>,
  variables: Map<string, MathNode>,
  angleUnit: AngleUnit,
  shapes: Shape[],
) {
  const equation = compileImplicitEquation(shape.equation ?? "");
  if (!equation || equation.operator === "=") return Number.NaN;
  // Prefer an exact metric when an explicit filled object already describes
  // the same boundary. This is both faster and substantially more accurate
  // than comparing an analytic ellipse/circle area with raster cell counts.
  // The check is geometric, so it also works for user-defined equations that
  // are algebraically very different from the corresponding standard form.
  const exactGeometryTypes = new Set<Shape["type"]>([
    "circle",
    "ellipse",
    "sector",
    "circularSegment",
    "polygon",
  ]);
  for (const candidate of shapes) {
    if (
      candidate.id === shape.id ||
      !exactGeometryTypes.has(candidate.type)
    ) continue;
    const candidatePoints = candidate.points.map((id) => map.get(id));
    if (
      candidatePoints.length < 2 ||
      candidatePoints.some((point) => !point)
    ) continue;
    const geometry = candidate.type as Exclude<
      GeometryKind,
      "equation"
    >;
    const boundary = sampleGeometryBoundary(
      geometry,
      candidatePoints as Point[],
      candidate.arc,
      96,
    );
    if (boundary.length < 8) continue;
    const boundaryMatches = boundary.every(
      (point) =>
        evaluateImplicitEquation(
          equation,
          point,
          map,
          variables,
          angleUnit,
          shapes,
        ).boundaryError <= 1e-5,
    );
    if (!boundaryMatches) continue;
    const interior = boundary.reduce(
      (center, point) => ({
        x: center.x + point.x / boundary.length,
        y: center.y + point.y / boundary.length,
      }),
      { x: 0, y: 0 },
    );
    if (
      !evaluateImplicitEquation(
        equation,
        interior,
        map,
        variables,
        angleUnit,
        shapes,
      ).inside
    ) continue;
    const exactMetric = geometryMetric(
      measure,
      geometry,
      candidatePoints as Point[],
      candidate.arc,
    );
    if (Number.isFinite(exactMetric)) return exactMetric;
  }
  const bounds = equationSamplingBounds(map);
  const resolution = 100;
  const stepX = (bounds.maximumX - bounds.minimumX) / resolution;
  const stepY = (bounds.maximumY - bounds.minimumY) / resolution;
  const inside = Array.from({ length: resolution }, (_, row) =>
    Array.from({ length: resolution }, (_, column) =>
      evaluateImplicitEquation(
        equation,
        {
          x: bounds.minimumX + (column + 0.5) * stepX,
          y: bounds.minimumY + (row + 0.5) * stepY,
        },
        map,
        variables,
        angleUnit,
        shapes,
      ).inside,
    ),
  );
  if (measure === "area") {
    const cells = inside.reduce(
      (sum, row) => sum + row.filter(Boolean).length,
      0,
    );
    return cells * stepX * stepY;
  }
  let perimeter = 0;
  inside.forEach((row, rowIndex) =>
    row.forEach((value, columnIndex) => {
      if (!value) return;
      if (!inside[rowIndex - 1]?.[columnIndex]) perimeter += stepX;
      if (!inside[rowIndex + 1]?.[columnIndex]) perimeter += stepX;
      if (!row[columnIndex - 1]) perimeter += stepY;
      if (!row[columnIndex + 1]) perimeter += stepY;
    }),
  );
  return perimeter;
}

function geometryReferenceContains(
  reference: GeometryReference,
  point: Point,
  map: Map<string, Point>,
  variables: Map<string, MathNode>,
  angleUnit: AngleUnit,
  shapes: Shape[],
) {
  if (reference.kind === "equation") {
    const shape = equationShapeByName(reference.name, shapes);
    const equation = compileImplicitEquation(shape?.equation ?? "");
    return Boolean(
      shape &&
        equation &&
        equation.operator !== "=" &&
        evaluateImplicitEquation(
          equation,
          point,
          map,
          variables,
          angleUnit,
          shapes,
        ).inside,
    );
  }
  const points = resolveReferencePoints(
    reference,
    map,
    variables,
    angleUnit,
    shapes,
  );
  if (!points) return false;
  const shape = matchingGeometryShape(reference.kind, reference.ids, shapes);
  const boundary =
    reference.kind === "polygon"
      ? points
      : sampleGeometryBoundary(
          reference.kind,
          points,
          shape?.arc,
          72,
        );
  return boundary.length >= 3 && pointInPolygon(point, boundary);
}

function approximateIntersectionArea(
  first: GeometryReference,
  second: GeometryReference,
  map: Map<string, Point>,
  variables: Map<string, MathNode>,
  angleUnit: AngleUnit,
  shapes: Shape[],
) {
  const bounds = equationSamplingBounds(map);
  const resolution = 110;
  const stepX = (bounds.maximumX - bounds.minimumX) / resolution;
  const stepY = (bounds.maximumY - bounds.minimumY) / resolution;
  let cells = 0;
  for (let row = 0; row < resolution; row += 1) {
    for (let column = 0; column < resolution; column += 1) {
      const point = {
        id: "",
        x: bounds.minimumX + (column + 0.5) * stepX,
        y: bounds.minimumY + (row + 0.5) * stepY,
      };
      if (
        geometryReferenceContains(first, point, map, variables, angleUnit, shapes) &&
        geometryReferenceContains(second, point, map, variables, angleUnit, shapes)
      ) {
        cells += 1;
      }
    }
  }
  return cells * stepX * stepY;
}

function setExpressionContainsPoint(
  expression: SetExpression,
  point: Point,
  map: Map<string, Point>,
  variables: Map<string, MathNode>,
  angleUnit: AngleUnit,
  shapes: Shape[],
): boolean {
  if (expression.kind !== "object") {
    const values = expression.operands.map((operand) =>
      setExpressionContainsPoint(
        operand,
        point,
        map,
        variables,
        angleUnit,
        shapes,
      ),
    );
    return expression.kind === "union"
      ? values.some(Boolean)
      : values.every(Boolean);
  }
  const object = expression.object;
  if (object.kind === "equation") {
    const shape = equationShapeByName(object.name, shapes);
    const equation = compileImplicitEquation(shape?.equation ?? "");
    return Boolean(
      shape &&
        equation &&
        equation.operator !== "=" &&
        evaluateImplicitEquation(
          equation,
          point,
          map,
          variables,
          angleUnit,
          shapes,
        ).inside,
    );
  }
  const kind =
    object.kind === "auto"
      ? resolveIntersectionObjectKind(object.ids, shapes)
      : object.kind;
  if (
    kind === "point" ||
    kind === "segment" ||
    kind === "line" ||
    kind === "ray"
  ) return false;
  const objectPoints = resolveReferencePoints(
    object,
    map,
    variables,
    angleUnit,
    shapes,
  );
  if (!objectPoints) return false;
  const geometry = kind as Exclude<GeometryKind, "equation">;
  const shape = matchingGeometryShape(geometry, object.ids, shapes);
  const boundary =
    geometry === "polygon"
      ? objectPoints
      : sampleGeometryBoundary(
          geometry,
          objectPoints,
          shape?.arc,
          72,
        );
  return boundary.length >= 3 && pointInPolygon(point, boundary);
}

function approximateSetArea(
  set: SetExpression,
  map: Map<string, Point>,
  variables: Map<string, MathNode>,
  angleUnit: AngleUnit,
  shapes: Shape[],
) {
  const bounds = equationSamplingBounds(map);
  const resolution = 110;
  const stepX = (bounds.maximumX - bounds.minimumX) / resolution;
  const stepY = (bounds.maximumY - bounds.minimumY) / resolution;
  let cells = 0;
  for (let row = 0; row < resolution; row += 1) {
    for (let column = 0; column < resolution; column += 1) {
      const point = {
        id: "",
        x: bounds.minimumX + (column + 0.5) * stepX,
        y: bounds.minimumY + (row + 0.5) * stepY,
      };
      if (
        setExpressionContainsPoint(
          set,
          point,
          map,
          variables,
          angleUnit,
          shapes,
        )
      ) {
        cells += 1;
      }
    }
  }
  return cells * stepX * stepY;
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
  variables: Map<string, MathNode> = new Map(),
  angleUnit: AngleUnit = "degrees",
) {
  if (first.kind === "equation" || second.kind === "equation") {
    const equationObject = first.kind === "equation" ? first : second;
    const other = first.kind === "equation" ? second : first;
    const equationShape = equationShapeByName(equationObject.name, shapes);
    if (!equationShape) return Number.NaN;
    const equationBoundary = sampleEquationBoundary(
      equationShape,
      map,
      variables,
      angleUnit,
      shapes,
    );
    if (!equationBoundary.length) return Number.NaN;
    const otherPoints = distanceObjectPoints(other, map);
    if (!otherPoints) return Number.NaN;
    if (other.kind === "point") {
      const equation = compileImplicitEquation(equationShape.equation ?? "");
      if (
        equation &&
        equation.operator !== "=" &&
        evaluateImplicitEquation(
          equation,
          otherPoints[0],
          map,
          variables,
          angleUnit,
          shapes,
        ).inside
      ) {
        return 0;
      }
      return Math.min(
        ...equationBoundary.map((point) => distance(point, otherPoints[0])),
      );
    }
    const otherBoundary =
      other.kind === "equation"
        ? sampleEquationBoundary(
            equationShapeByName(other.name, shapes) ?? equationShape,
            map,
            variables,
            angleUnit,
            shapes,
          )
        : distanceObjectBoundary(other, map, shapes);
    if (!otherBoundary.length) return Number.NaN;
    return Math.min(
      ...equationBoundary.flatMap((firstPoint) =>
        otherBoundary.map((secondPoint) => distance(firstPoint, secondPoint)),
      ),
    );
  }
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
  if (node.kind === "point") return Number.NaN;
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
    if (node.measure === "setArea" && node.set) {
      return approximateSetArea(
        node.set,
        map,
        variables,
        angleUnit,
        shapes,
      );
    }
    if (
      (node.measure === "area" || node.measure === "perimeter") &&
      node.geometry === "equation" &&
      node.shapeName
    ) {
      const shape = equationShapeByName(node.shapeName, shapes);
      return shape
        ? approximateEquationMetric(
            shape,
            node.measure,
            map,
            variables,
            angleUnit,
            shapes,
          )
        : Number.NaN;
    }
    const computedPoints = node.pointArguments?.map((point, index) => {
      const x = evaluateMath(
        point.x,
        map,
        variables,
        angleUnit,
        shapes,
        resolving,
      );
      const y = evaluateMath(
        point.y,
        map,
        variables,
        angleUnit,
        shapes,
        resolving,
      );
      return { id: `__point_${index}`, x, y };
    });
    if (
      computedPoints?.some(
        (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
      )
    ) return Number.NaN;
    if (computedPoints?.length) {
      if (node.measure === "x") return computedPoints[0].x;
      if (node.measure === "y") return computedPoints[0].y;
      if (node.measure === "distance" && computedPoints.length === 2) {
        return distance(computedPoints[0], computedPoints[1]);
      }
      if (node.measure === "angle" && computedPoints.length === 3) {
        const value = angleDegrees(
          computedPoints[0],
          computedPoints[1],
          computedPoints[2],
        );
        return angleUnit === "degrees" ? value : (value * Math.PI) / 180;
      }
      if (
        (node.measure === "area" || node.measure === "perimeter") &&
        computedPoints.length >= 3
      ) {
        return geometryMetric(
          node.measure,
          "polygon",
          computedPoints,
        );
      }
    }
    const points = node.ids.map((id) => map.get(id));
    if (points.some((point) => !point)) return Number.NaN;
    const p = points as Point[];
    if (node.measure === "x") return p[0].x;
    if (node.measure === "y") return p[0].y;
    if (node.measure === "distance") return distance(p[0], p[1]);
    if (node.measure === "objectDistance" && node.objects) {
      const resolvedMap = new Map(map);
      const resolveObject = (
        object: DistanceObject,
        index: number,
      ): DistanceObject | null => {
        const expressions = object.pointArguments ??
          (object.point ? [object.point] : []);
        if (!expressions.length) return object;
        const ids = expressions.map((point, pointIndex) => {
          const x = evaluateMath(
            point.x,
            map,
            variables,
            angleUnit,
            shapes,
            resolving,
          );
          const y = evaluateMath(
            point.y,
            map,
            variables,
            angleUnit,
            shapes,
            resolving,
          );
          if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
          const id = `__computed_object_${index}_${pointIndex}`;
          resolvedMap.set(id, { id, x, y });
          return id;
        });
        return ids.some((id) => !id)
          ? null
          : {
              ...object,
              ids: ids as string[],
              point: undefined,
              pointArguments: undefined,
            };
      };
      const first = resolveObject(node.objects[0], 0);
      const second = resolveObject(node.objects[1], 1);
      if (!first || !second) return Number.NaN;
      return distanceBetweenObjects(
        first,
        second,
        resolvedMap,
        shapes,
        variables,
        angleUnit,
      );
    }
    if (node.measure === "intersectionArea" && node.geometries) {
      const [first, second] = node.geometries;
      if (first.kind === "equation" || second.kind === "equation") {
        return approximateIntersectionArea(
          first,
          second,
          map,
          variables,
          angleUnit,
          shapes,
        );
      }
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
  const compact = source.replace(/\s+/g, "");
  const computedPoints = parseComputedPointSequence(compact);
  if (computedPoints) {
    return {
      kind:
        computedPoints.length === 1
          ? "point"
          : computedPoints.length === 2
            ? "segment"
            : "polygon",
      ids: [],
      pointArguments: computedPoints,
    };
  }
  const equation = compact.match(
    /^(?:equation|eq)\(([A-Za-z_][A-Za-z0-9_]*)\)$/i,
  );
  if (equation) return { kind: "equation", ids: [], name: equation[1] };
  // Lower-case identifiers are equation-object names. Upper-case letter and
  // digit sequences remain point-based geometry for backwards compatibility.
  if (/^[a-z_][A-Za-z0-9_]*$/.test(compact)) {
    return { kind: "equation", ids: [], name: compact };
  }
  const clean = compact.toUpperCase();
  const shorthandIds = splitPointIds(clean);
  if (shorthandIds?.length === 2) {
    return { kind: "auto", ids: shorthandIds };
  }
  if (shorthandIds && shorthandIds.length >= 3) {
    return { kind: "polygon", ids: shorthandIds };
  }
  const explicit = clean.match(
    /^(SEGMENT|LINE|RAY|CIRCLE|ELLIPSE|SECTOR|CIRCULARSEGMENT|POLYGON)\(([A-Z0-9]+)\)$/,
  );
  if (!explicit) return null;
  const kind =
    explicit[1] === "CIRCULARSEGMENT"
      ? "circularSegment"
      : (explicit[1].toLowerCase() as IntersectionObject["kind"]);
  const ids = splitPointIds(explicit[2]) ?? [];
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

function normalizeSetOperators(source: string) {
  return source
    .replace(/\\cap\b/gi, "∩")
    .replace(/\\cup\b/gi, "∪");
}

function splitTopLevelSetOperator(source: string, operator: "∩" | "∪") {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "(" || character === "{") depth += 1;
    if (character === ")" || character === "}") depth -= 1;
    if (depth === 0 && character === operator) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }
  if (!parts.length) return null;
  parts.push(source.slice(start));
  return parts.every((part) => part.trim()) ? parts : null;
}

function unwrapSetParentheses(source: string) {
  const trimmed = source.trim();
  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) return trimmed;
  let depth = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] === "(") depth += 1;
    if (trimmed[index] === ")") depth -= 1;
    if (depth === 0 && index < trimmed.length - 1) return trimmed;
  }
  return depth === 0 ? trimmed.slice(1, -1).trim() : trimmed;
}

function parseSetExpression(source: string): SetExpression | null {
  const clean = unwrapSetParentheses(normalizeSetOperators(source));
  const union = splitTopLevelSetOperator(clean, "∪");
  if (union) {
    const operands = union.map(parseSetExpression);
    return operands.every(Boolean)
      ? { kind: "union", operands: operands as SetExpression[] }
      : null;
  }
  const intersection = splitTopLevelSetOperator(clean, "∩");
  if (intersection) {
    const operands = intersection.map(parseSetExpression);
    return operands.every(Boolean)
      ? { kind: "intersection", operands: operands as SetExpression[] }
      : null;
  }
  const object = parseIntersectionObject(clean);
  return object ? { kind: "object", object } : null;
}

function setObjects(expression: SetExpression): IntersectionObject[] {
  return expression.kind === "object"
    ? [expression.object]
    : expression.operands.flatMap(setObjects);
}

function parseIntersectionPointSet(source: string) {
  const clean = source.toUpperCase().replace(/\s+/g, "");
  if (clean === "∅") return [];
  const braces = clean.match(/^\{(.+)\}$/);
  const pointSource = braces?.[1] ?? clean;
  const points = pointSource.split(",");
  if (
    !points.length ||
    points.some((point) => !/^[A-Z]\d*$/.test(point)) ||
    new Set(points).size !== points.length
  ) {
    return null;
  }
  return points;
}

function parseIntersectionConstraint(source: string): ParsedConstraint | null {
  const clean = normalizeSetOperators(source).trim();
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
    if (/[∩∪]/.test(equality[0])) {
      objectSource = equality[0];
      pointSource = equality[1];
    } else {
      pointSource = equality[0];
      objectSource = equality[1];
    }
  }
  if (
    relation === "contains" &&
    !/[∩∪]|\\(?:cap|cup)\b/i.test(objectSource) &&
    !/^\s*(?:(?:equation|eq)\s*\(|[a-z_][A-Za-z0-9_]*\s*$)/.test(
      objectSource,
    )
  ) {
    return null;
  }
  let points = parseIntersectionPointSet(pointSource);
  let members: ContainmentReference[] | undefined;
  if (!points && relation === "contains") {
    const member = parseContainmentInner(pointSource);
    if (member) {
      members = [member];
      points = member.ids;
    }
  }
  const set = parseSetExpression(objectSource);
  const objects = set ? setObjects(set) : [];
  const hasSetOperator = /[∩∪]|\\(?:cap|cup)\b/i.test(objectSource);
  const hasEquationObject = objects.some((object) => object.kind === "equation");
  if (
    !points ||
    !set ||
    objects.length === 0 ||
    (relation === "contains" && !points.length && !members?.length) ||
    (!hasSetOperator && !hasEquationObject)
  ) {
    return null;
  }
  const first = objects[0];
  const second = objects[1] ?? objects[0];
  return {
    kind: "intersectionSet",
    ids: [
      ...new Set([
        ...points,
        ...objects.flatMap((object) => object.ids),
      ]),
    ],
    intersection: {
      points,
      relation,
      first,
      second,
      ...(members ? { members } : {}),
      ...(objects.length !== 2 ||
      objects.some((object) => object.kind === "equation") ||
      set.kind === "union"
        ? { set }
        : {}),
    },
    source: source.trim(),
  };
}

function parseGeometryReference(source: string): GeometryReference | null {
  const compact = source.replace(/\s+/g, "");
  const computedPoints = parseComputedPointSequence(compact);
  if (computedPoints?.length && computedPoints.length >= 3) {
    return { kind: "polygon", ids: [], pointArguments: computedPoints };
  }
  const equation = compact.match(
    /^(?:equation|eq)\(([A-Za-z_][A-Za-z0-9_]*)\)$/i,
  );
  if (equation) return { kind: "equation", ids: [], name: equation[1] };
  if (/^[a-z_][A-Za-z0-9_]*$/.test(compact)) {
    return { kind: "equation", ids: [], name: compact };
  }
  const clean = compact.toUpperCase();
  const shorthandIds = splitPointIds(clean);
  if (shorthandIds && shorthandIds.length >= 3) {
    return { kind: "polygon", ids: shorthandIds };
  }
  const match = clean.match(
    /^(POLYGON|CIRCLE|ELLIPSE|SECTOR|SEGMENT|CIRCULARSEGMENT)\(([A-Z0-9]+)\)$/,
  );
  if (!match) return null;
  const kind =
    match[1] === "SEGMENT" || match[1] === "CIRCULARSEGMENT"
      ? "circularSegment"
      : (match[1].toLowerCase() as GeometryReference["kind"]);
  const ids = splitPointIds(match[2]) ?? [];
  const validCount =
    kind === "polygon"
      ? ids.length >= 3
      : kind === "circle"
        ? ids.length === 2
        : ids.length === 3;
  return validCount ? { kind, ids } : null;
}

function parseContainmentInner(source: string): ContainmentReference | null {
  const computedPoints = parseComputedPointSequence(source);
  if (computedPoints?.length === 1) {
    return { kind: "point", ids: [], pointArguments: computedPoints };
  }
  if (computedPoints && computedPoints.length >= 3) {
    return { kind: "polygon", ids: [], pointArguments: computedPoints };
  }
  const clean = source.toUpperCase().replace(/\s+/g, "");
  const point = clean.match(/^(?:([A-Z]\d*)|POINT\(([A-Z]\d*)\))$/);
  if (point) return { kind: "point", ids: [point[1] ?? point[2]] };
  return parseGeometryReference(source);
}

function parseContainmentConstraint(
  source: string,
): ParsedConstraint | null {
  const membership = normalizeSetOperators(source).split("∈");
  if (
    membership.length !== 2 ||
    /[∩∪]/.test(membership[1])
  ) {
    return null;
  }
  const [innerSource, outerSource] = membership;
  const inner = parseContainmentInner(innerSource);
  const outer = parseGeometryReference(outerSource);
  if (!inner || !outer) return null;
  // Keep the established boundary/set meaning of `P ∈ circle(...)`,
  // `P ∈ arc(...)`, and `P ∈ equationName`. A bare point is interpreted as
  // figure containment only when the right-hand side is a filled polygon.
  const explicitPoint =
    /^\s*point\s*\(/i.test(innerSource) || Boolean(inner.pointArguments?.length);
  if (
    inner.kind === "point" &&
    outer.kind !== "polygon" &&
    !explicitPoint
  ) return null;
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
    new RegExp(`^(${POINT_ID_SOURCE})(${POINT_ID_SOURCE})=(-?\\d+(?:\\.\\d+)?)$`),
  );
  if (match) {
    return {
      kind: "distance",
      ids: [match[1], match[2]],
      value: Number(match[3]),
    };
  }
  match = clean.match(
    new RegExp(`^(?:CONVEX|ВЫПУКЛЫЙ)\\((${POINT_ID_SEQUENCE_SOURCE})\\)$`),
  );
  if (match) {
    return {
      kind: "convex",
      ids: splitPointIds(match[1]) ?? [],
      source: expression.trim(),
    };
  }
  match = clean.match(
    new RegExp(`^∠(${POINT_ID_SOURCE})(${POINT_ID_SOURCE})(${POINT_ID_SOURCE})=(-?\\d+(?:\\.\\d+)?)$`),
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
    new RegExp(`^S\\((${POINT_ID_SEQUENCE_SOURCE})\\)=(-?\\d+(?:\\.\\d+)?)$`),
  );
  if (match) {
    return {
      kind: "area",
      ids: splitPointIds(match[1]) ?? [],
      value: Number(match[2]),
    };
  }
  match = clean.match(new RegExp(`^(${POINT_ID_SOURCE})(${POINT_ID_SOURCE})[∥|](${POINT_ID_SOURCE})(${POINT_ID_SOURCE})$`));
  if (match) {
    return {
      kind: "parallel",
      ids: [match[1], match[2], match[3], match[4]],
    };
  }
  match = clean.match(new RegExp(`^(${POINT_ID_SOURCE})(${POINT_ID_SOURCE})[⟂⊥](${POINT_ID_SOURCE})(${POINT_ID_SOURCE})$`));
  if (match) {
    return {
      kind: "perpendicular",
      ids: [match[1], match[2], match[3], match[4]],
    };
  }
  match = clean.match(new RegExp(`^(${POINT_ID_SOURCE})(?:≠|!=)(${POINT_ID_SOURCE})$`));
  if (match) {
    return {
      kind: "distinctPoints",
      ids: [match[1], match[2]],
      source: expression.trim(),
    };
  }
  match = clean.match(new RegExp(`^(?:DISTINCT|РАЗЛИЧНЫ)\\((${POINT_ID_SEQUENCE_SOURCE})\\)$`));
  if (match) {
    const ids = [...new Set(splitPointIds(match[1]) ?? [])];
    if (ids.length < 2) return null;
    return {
      kind: "distinctPoints",
      ids,
      source: expression.trim(),
    };
  }
  match = clean.match(
    new RegExp(`^(${POINT_ID_SOURCE})(${POINT_ID_SOURCE})(?:(?:∩(${POINT_ID_SOURCE})(${POINT_ID_SOURCE})=∅)|(?:!∩(${POINT_ID_SOURCE})(${POINT_ID_SOURCE}))|(?:НЕПЕРЕСЕКАЕТ(${POINT_ID_SOURCE})(${POINT_ID_SOURCE})))$`),
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
  match = clean.match(new RegExp(`^(${POINT_ID_SOURCE})(?:∈|ON|НА)(${POINT_ID_SOURCE})(${POINT_ID_SOURCE})$`));
  if (match) {
    return {
      kind: "onSegment",
      ids: [match[1], match[2], match[3]],
      source: expression.trim(),
    };
  }
  match = clean.match(
    new RegExp(`^(${POINT_ID_SOURCE})∈(LINE|RAY|CIRCLE)\\((${POINT_ID_SOURCE})(${POINT_ID_SOURCE})\\)$`),
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
    new RegExp(`^(${POINT_ID_SOURCE})∈ELLIPSE\\((${POINT_ID_SOURCE})(${POINT_ID_SOURCE})(${POINT_ID_SOURCE})\\)$`),
  );
  if (match) {
    return {
      kind: "onEllipse",
      ids: [match[1], match[2], match[3], match[4]],
      source: expression.trim(),
    };
  }
  match = clean.match(
    new RegExp(`^(${POINT_ID_SOURCE})∈ARC\\((${POINT_ID_SOURCE})(${POINT_ID_SOURCE})(${POINT_ID_SOURCE})\\)$`),
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
  const compact = source.replace(/\s+/g, "");
  let match = compact.match(
    new RegExp(`^(${POINT_ID_SOURCE})(${POINT_ID_SOURCE})$`),
  );
  if (match) {
    return {
      kind: "distance",
      ids: [match[1], match[2]],
      label: `${match[1]}${match[2]}`,
    };
  }
  match = compact.match(
    new RegExp(`^∠(${POINT_ID_SOURCE})(${POINT_ID_SOURCE})(${POINT_ID_SOURCE})$`),
  );
  if (match) {
    return {
      kind: "angle",
      ids: [match[1], match[2], match[3]],
      label: `∠${match[1]}${match[2]}${match[3]}`,
    };
  }
  match = compact.match(
    new RegExp(`^[sS]\\((${POINT_ID_SEQUENCE_SOURCE})\\)$`),
  );
  const areaPointIds = match ? splitPointIds(match[1]) ?? [] : [];
  if (match && areaPointIds.length >= 3) {
    return {
      kind: "area",
      ids: areaPointIds,
      label: `S(${match[1]})`,
      geometry: "polygon",
    };
  }
  match = compact.match(
    new RegExp(`^[pP]\\((${POINT_ID_SEQUENCE_SOURCE})\\)$`),
  );
  const perimeterPointIds = match ? splitPointIds(match[1]) ?? [] : [];
  if (match && perimeterPointIds.length >= 3) {
    return {
      kind: "perimeter",
      ids: perimeterPointIds,
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
      (formula.measure === "area" || formula.measure === "perimeter") &&
      formula.geometry !== "equation" &&
      !formula.pointArguments?.length
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

function resolveReferencePoints(
  reference: { ids: string[]; pointArguments?: MathPointNode[] },
  map: Map<string, Point>,
  variables: Map<string, MathNode>,
  angleUnit: AngleUnit,
  shapes: Shape[],
): Point[] | null {
  const namedPoints = reference.ids.map((id) => map.get(id));
  if (namedPoints.some((point) => !point)) return null;
  const computedPoints = (reference.pointArguments ?? []).map((node, index) => {
    const x = evaluateMath(node.x, map, variables, angleUnit, shapes);
    const y = evaluateMath(node.y, map, variables, angleUnit, shapes);
    return Number.isFinite(x) && Number.isFinite(y)
      ? { id: `__computed_${index}`, x, y }
      : null;
  });
  if (computedPoints.some((point) => !point)) return null;
  return [
    ...(namedPoints as Point[]),
    ...(computedPoints as Point[]),
  ];
}

function pointObjectResidual(
  point: Point,
  object: IntersectionObject,
  map: Map<string, Point>,
  shapes: Shape[] = [],
  variables: Map<string, MathNode> = new Map(),
  angleUnit: AngleUnit = "degrees",
) {
  if (object.kind === "equation") {
    const shape = equationShapeByName(object.name, shapes);
    const equation = compileImplicitEquation(shape?.equation ?? "");
    if (!shape || !equation) return 10;
    return evaluateImplicitEquation(
      equation,
      point,
      map,
      variables,
      angleUnit,
      shapes,
    ).membershipError;
  }
  const kind =
    object.kind === "auto"
      ? resolveIntersectionObjectKind(object.ids, shapes)
      : object.kind;
  const objectPoints = resolveReferencePoints(
    object,
    map,
    variables,
    angleUnit,
    shapes,
  );
  if (!objectPoints) return 10;
  if (kind === "point") {
    return objectPoints[0] ? distance(point, objectPoints[0]) : 10;
  }
  const [start, end] = objectPoints;
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
    const shape = matchingGeometryShape(kind, object.ids, shapes);
    const boundary = sampleGeometryBoundary(
      kind,
      objectPoints,
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

function pointSetResidual(
  point: Point,
  expression: SetExpression,
  map: Map<string, Point>,
  shapes: Shape[],
  variables: Map<string, MathNode>,
  angleUnit: AngleUnit,
): number {
  if (expression.kind === "object") {
    return pointObjectResidual(
      point,
      expression.object,
      map,
      shapes,
      variables,
      angleUnit,
    );
  }
  const errors = expression.operands.map((operand) =>
    pointSetResidual(point, operand, map, shapes, variables, angleUnit),
  );
  if (!errors.length) return 10;
  if (expression.kind === "union") return Math.min(...errors);
  return Math.sqrt(
    errors.reduce((sum, error) => sum + error * error, 0) / errors.length,
  );
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
  variables: Map<string, MathNode> = new Map(),
  angleUnit: AngleUnit = "degrees",
) {
  const firstKind =
    firstObject.kind === "auto"
      ? resolveIntersectionObjectKind(firstObject.ids, shapes)
      : firstObject.kind;
  const secondKind =
    secondObject.kind === "auto"
      ? resolveIntersectionObjectKind(secondObject.ids, shapes)
      : secondObject.kind;
  if (firstKind === "equation" || secondKind === "equation") {
    const boundaryFor = (object: IntersectionObject) => {
      const kind =
        object.kind === "auto"
          ? resolveIntersectionObjectKind(object.ids, shapes)
          : object.kind;
      if (kind === "equation") {
        const shape = equationShapeByName(object.name, shapes);
        return shape
          ? sampleEquationBoundary(
              shape,
              map,
              variables,
              angleUnit,
              shapes,
            )
          : [];
      }
      return intersectionObjectBoundary(object, kind, map, shapes);
    };
    const firstBoundary = boundaryFor(firstObject);
    const secondBoundary = boundaryFor(secondObject);
    if (!firstBoundary.length || !secondBoundary.length) return 10;
    const minimum = Math.min(
      ...firstBoundary.flatMap((firstPoint) =>
        secondBoundary.map((secondPoint) => distance(firstPoint, secondPoint)),
      ),
    );
    const clearance = 0.12;
    return Math.max(0, (clearance - minimum) / clearance);
  }
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
  variables: Map<string, MathNode> = new Map(),
  angleUnit: AngleUnit = "degrees",
  circleTangencyBranch?: "external" | "internal",
) {
  const definition = constraint.intersection;
  if (!definition) return [10];
  const setMembership = (point: Point) =>
    definition.set
      ? pointSetResidual(
          point,
          definition.set,
          map,
          shapes,
          variables,
          angleUnit,
        )
      : Math.hypot(
          pointObjectResidual(
            point,
            definition.first,
            map,
            shapes,
            variables,
            angleUnit,
          ),
          pointObjectResidual(
            point,
            definition.second,
            map,
            shapes,
            variables,
            angleUnit,
          ),
        );
  const flatObjects = definition.set ? setObjects(definition.set) : [];
  const isSimpleIntersection =
    !definition.set ||
    (definition.set.kind === "intersection" &&
      flatObjects.length === 2 &&
      definition.set.operands.every((operand) => operand.kind === "object"));
  const canLocateExactIntersection =
    isSimpleIntersection &&
    definition.first.kind !== "equation" &&
    definition.second.kind !== "equation";
  if (definition.relation === "equals" && !definition.points.length) {
    if (!isSimpleIntersection) return [1];
    return [
      nonIntersectionResidual(
        definition.first,
        definition.second,
        map,
        shapes,
        variables,
        angleUnit,
      ),
    ];
  }
  const assigned = definition.points.map((id) => map.get(id));
  if (assigned.some((point) => !point)) return [10];
  const memberPoints = (definition.members ?? []).flatMap((member) =>
    resolveReferencePoints(
      member,
      map,
      variables,
      angleUnit,
      shapes,
    ) ?? [],
  );
  if (definition.members?.length && !memberPoints.length) return [10];
  const assignedPoints = [...(assigned as Point[]), ...memberPoints];
  const membership = assignedPoints.map(setMembership);
  if (definition.relation === "contains") return membership;
  // For unions and intersections of three or more objects, point membership is
  // enforced exactly. Proving that no additional continuum points exist is a
  // separate symbolic set problem, so the numerical solver deliberately does
  // not invent a cardinality penalty here.
  if (!canLocateExactIntersection) return membership;

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
      const useExternal = circleTangencyBranch
        ? circleTangencyBranch === "external"
        : Math.abs(external) <= Math.abs(internal);
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

function derivedCircleTangencyBranches(
  constraints: ParsedConstraint[],
  shapes: Shape[],
  initialMap: Map<string, Point>,
) {
  const circleKey = (object: IntersectionObject) => {
    const kind = object.kind === "auto"
      ? resolveIntersectionObjectKind(object.ids, shapes)
      : object.kind;
    return kind === "circle" && object.ids.length >= 2
      ? `${object.ids[0]}\u0000${object.ids[1]}`
      : null;
  };
  const containmentPairs = new Set<string>();
  const containersByCircle = new Map<string, Set<string>>();
  constraints.forEach((constraint) => {
    if (
      constraint.kind !== "insideFigure" ||
      constraint.containment?.inner.kind !== "circle" ||
      constraint.containment.outer.kind !== "circle"
    ) {
      return;
    }
    const keys = [
      constraint.containment.inner.ids.slice(0, 2).join("\u0000"),
      constraint.containment.outer.ids.slice(0, 2).join("\u0000"),
    ].sort();
    containmentPairs.add(keys.join("\u0001"));
    const innerKey = constraint.containment.inner.ids.slice(0, 2).join("\u0000");
    const outerKey = constraint.containment.outer.ids.slice(0, 2).join("\u0000");
    const containers = containersByCircle.get(innerKey) ?? new Set<string>();
    containers.add(outerKey);
    containersByCircle.set(innerKey, containers);
  });
  const result = new Map<ParsedConstraint, "external" | "internal">();
  constraints.forEach((constraint) => {
    const definition = constraint.intersection;
    if (
      constraint.kind !== "intersectionSet" ||
      definition?.relation !== "equals" ||
      definition.points.length !== 1
    ) {
      return;
    }
    const first = circleKey(definition.first);
    const second = circleKey(definition.second);
    if (!first || !second) return;
    const pair = [first, second].sort().join("\u0001");
    if (containmentPairs.has(pair)) {
      result.set(constraint, "internal");
      return;
    }
    const sharedContainer = [...(containersByCircle.get(first) ?? [])].some(
      (container) => containersByCircle.get(second)?.has(container),
    );
    if (sharedContainer) {
      result.set(constraint, "external");
      return;
    }
    const firstCenter = initialMap.get(definition.first.ids[0]);
    const firstRadiusPoint = initialMap.get(definition.first.ids[1]);
    const secondCenter = initialMap.get(definition.second.ids[0]);
    const secondRadiusPoint = initialMap.get(definition.second.ids[1]);
    if (!firstCenter || !firstRadiusPoint || !secondCenter || !secondRadiusPoint) {
      return;
    }
    const centerDistance = distance(firstCenter, secondCenter);
    const firstRadius = distance(firstCenter, firstRadiusPoint);
    const secondRadius = distance(secondCenter, secondRadiusPoint);
    result.set(
      constraint,
      Math.abs(centerDistance - (firstRadius + secondRadius)) <=
        Math.abs(centerDistance - Math.abs(firstRadius - secondRadius))
        ? "external"
        : "internal",
    );
  });
  return result;
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
  const edgeBranches = new Map<string, "external" | "internal">();
  const containmentPairs = new Set<string>();
  const containersByCircle = new Map<string, Set<string>>();
  constraints.forEach((constraint) => {
    if (
      constraint.kind !== "insideFigure" ||
      constraint.containment?.inner.kind !== "circle" ||
      constraint.containment.outer.kind !== "circle"
    ) {
      return;
    }
    const innerKey = constraint.containment.inner.ids.slice(0, 2).join("\u0000");
    const outerKey = constraint.containment.outer.ids.slice(0, 2).join("\u0000");
    containmentPairs.add([innerKey, outerKey].sort().join("\u0001"));
    const containers = containersByCircle.get(innerKey) ?? new Set<string>();
    containers.add(outerKey);
    containersByCircle.set(innerKey, containers);
  });
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
    const edgeKey = [first.key, second.key].sort().join("\u0001");
    edgeKeys.add(edgeKey);
    const sharedContainer = [...(containersByCircle.get(first.key) ?? [])].some(
      (container) => containersByCircle.get(second.key)?.has(container),
    );
    if (containmentPairs.has(edgeKey)) {
      edgeBranches.set(edgeKey, "internal");
    } else if (sharedContainer) {
      edgeBranches.set(edgeKey, "external");
    } else {
      const firstCenter = initialMap.get(first.centerId);
      const secondCenter = initialMap.get(second.centerId);
      const centerDistance = firstCenter && secondCenter
        ? distance(firstCenter, secondCenter)
        : Number.POSITIVE_INFINITY;
      edgeBranches.set(
        edgeKey,
        Math.abs(centerDistance - (first.radius + second.radius)) <=
          Math.abs(centerDistance - Math.abs(first.radius - second.radius))
          ? "external"
          : "internal",
      );
    }
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
          const edgeKey = [left.key, right.key].sort().join("\u0001");
          return edgeBranches.get(edgeKey) === "internal"
            ? Math.abs(left.radius - right.radius)
            : left.radius + right.radius;
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

function derivedEquidistantTangentCenterTriples(
  constraints: ParsedConstraint[],
  shapes: Shape[],
) {
  const circleKey = (kind: string, ids: string[]) => {
    const resolved = kind === "auto"
      ? resolveIntersectionObjectKind(ids, shapes)
      : kind;
    return resolved === "circle" && ids.length >= 2
      ? `${ids[0]}\u0000${ids[1]}`
      : null;
  };
  const tangentEdges = new Set<string>();
  constraints.forEach((constraint) => {
    const definition = constraint.intersection;
    if (
      constraint.kind !== "intersectionSet" ||
      definition?.relation !== "equals" ||
      definition.points.length !== 1
    ) {
      return;
    }
    const first = circleKey(definition.first.kind, definition.first.ids);
    const second = circleKey(definition.second.kind, definition.second.ids);
    if (first && second) tangentEdges.add([first, second].sort().join("\u0001"));
  });
  const innerByOuter = new Map<string, Set<string>>();
  constraints.forEach((constraint) => {
    const containment = constraint.containment;
    if (
      constraint.kind !== "insideFigure" ||
      containment?.inner.kind !== "circle" ||
      containment.outer.kind !== "circle"
    ) {
      return;
    }
    const inner = circleKey(containment.inner.kind, containment.inner.ids);
    const outer = circleKey(containment.outer.kind, containment.outer.ids);
    if (!inner || !outer) return;
    const entries = innerByOuter.get(outer) ?? new Set<string>();
    entries.add(inner);
    innerByOuter.set(outer, entries);
  });
  const distanceKeyForNode = (node: MathNode) =>
    node.kind === "measure" && node.measure === "distance" && node.ids.length === 2
      ? [...node.ids].sort().join("\u0000")
      : null;
  const equalDistanceEdges = new Map<string, Set<string>>();
  const connectDistances = (first: string, second: string) => {
    const firstEdges = equalDistanceEdges.get(first) ?? new Set<string>();
    const secondEdges = equalDistanceEdges.get(second) ?? new Set<string>();
    firstEdges.add(second);
    secondEdges.add(first);
    equalDistanceEdges.set(first, firstEdges);
    equalDistanceEdges.set(second, secondEdges);
  };
  constraints.forEach((constraint) => {
    if (constraint.kind !== "formula") return;
    (constraint.formulas ?? (constraint.formula ? [constraint.formula] : []))
      .forEach((equation) => {
        const first = distanceKeyForNode(equation.left);
        const second = distanceKeyForNode(equation.right);
        if (first && second) connectDistances(first, second);
      });
  });
  const distancesConnected = (keys: string[]) => {
    const visited = new Set<string>();
    const queue = [keys[0]];
    while (queue.length) {
      const current = queue.shift() as string;
      if (visited.has(current)) continue;
      visited.add(current);
      (equalDistanceEdges.get(current) ?? []).forEach((next) => queue.push(next));
    }
    return keys.every((key) => visited.has(key));
  };
  const result: string[][] = [];
  innerByOuter.forEach((innerSet, outer) => {
    const inners = [...innerSet];
    const [outerCenter] = outer.split("\u0000");
    for (let first = 0; first < inners.length; first += 1) {
      for (let second = first + 1; second < inners.length; second += 1) {
        for (let third = second + 1; third < inners.length; third += 1) {
          const trio = [inners[first], inners[second], inners[third]];
          const allPairs = [
            [trio[0], trio[1]],
            [trio[0], trio[2]],
            [trio[1], trio[2]],
            [outer, trio[0]],
            [outer, trio[1]],
            [outer, trio[2]],
          ];
          if (
            allPairs.some(
              (pair) => !tangentEdges.has(pair.sort().join("\u0001")),
            )
          ) {
            continue;
          }
          const centers = trio.map((key) => key.split("\u0000")[0]);
          const radialKeys = centers.map((center) =>
            [outerCenter, center].sort().join("\u0000"),
          );
          if (distancesConnected(radialKeys)) {
            result.push([outerCenter, ...centers]);
          }
        }
      }
    }
  });
  return result;
}

function equidistantTangentCenterResiduals(
  ids: string[],
  map: Map<string, Point>,
) {
  const [center, ...outerPoints] = ids.map((id) => map.get(id));
  if (!center || outerPoints.some((point) => !point)) return [1, 1, 1];
  const points = outerPoints as Point[];
  const vectors = points.map((point) => ({
    x: point.x - center.x,
    y: point.y - center.y,
  }));
  return [[0, 1], [0, 2], [1, 2]].map(([first, second]) => {
    const left = vectors[first];
    const right = vectors[second];
    const scale = Math.hypot(left.x, left.y) * Math.hypot(right.x, right.y);
    return scale <= 1e-12
      ? 1
      : (left.x * right.x + left.y * right.y) / scale + 0.5;
  });
}

function derivedSquarePointSets(
  constraints: ParsedConstraint[],
  shapes: Shape[],
) {
  const distanceKeyForNode = (node: MathNode) =>
    node.kind === "measure" && node.measure === "distance" && node.ids.length === 2
      ? [...node.ids].sort().join("\u0000")
      : null;
  const equalEdges = new Map<string, Set<string>>();
  const connect = (first: string, second: string) => {
    const firstLinks = equalEdges.get(first) ?? new Set<string>();
    const secondLinks = equalEdges.get(second) ?? new Set<string>();
    firstLinks.add(second);
    secondLinks.add(first);
    equalEdges.set(first, firstLinks);
    equalEdges.set(second, secondLinks);
  };
  constraints.forEach((constraint) => {
    if (constraint.kind !== "formula") return;
    (constraint.formulas ?? (constraint.formula ? [constraint.formula] : []))
      .forEach((equation) => {
        const first = distanceKeyForNode(equation.left);
        const second = distanceKeyForNode(equation.right);
        if (first && second) connect(first, second);
      });
  });
  const connected = (keys: string[]) => {
    const visited = new Set<string>();
    const queue = [keys[0]];
    while (queue.length) {
      const current = queue.shift() as string;
      if (visited.has(current)) continue;
      visited.add(current);
      equalEdges.get(current)?.forEach((next) => queue.push(next));
    }
    return keys.every((key) => visited.has(key));
  };
  return shapes
    .filter((shape) => shape.type === "polygon" && shape.points.length === 4)
    .map((shape) => shape.points.slice(0, 4))
    .filter((ids) => {
      const sides = ids.map((id, index) =>
        [id, ids[(index + 1) % ids.length]].sort().join("\u0000"),
      );
      const hasRightAngle = constraints.some(
        (constraint) =>
          constraint.kind === "angle" &&
          Math.abs((constraint.value ?? 0) - 90) <= 1e-9 &&
          constraint.ids.every((id) => ids.includes(id)),
      );
      return hasRightAngle && connected(sides);
    });
}

function seedSquareGeometry(points: Point[], squares: string[][]) {
  const map = pointMap(points.map((point) => ({ ...point })));
  squares.forEach((ids) => {
    const vertices = ids.map((id) => map.get(id));
    if (vertices.some((point) => !point)) return;
    const current = vertices as Point[];
    const sideVectors = current.map((point, index) => ({
      x: current[(index + 1) % 4].x - point.x,
      y: current[(index + 1) % 4].y - point.y,
    }));
    const sideLengths = sideVectors.map((vector) =>
      Math.hypot(vector.x, vector.y),
    );
    const meanSide =
      sideLengths.reduce((sum, value) => sum + value, 0) / 4;
    const sideSpread =
      meanSide > 1e-9
        ? Math.max(...sideLengths.map((value) => Math.abs(value - meanSide))) /
          meanSide
        : Number.POSITIVE_INFINITY;
    const rightAngleError = Math.max(
      ...sideVectors.map((vector, index) => {
        const next = sideVectors[(index + 1) % 4];
        return Math.abs(vector.x * next.x + vector.y * next.y) /
          Math.max(sideLengths[index] * sideLengths[(index + 1) % 4], 1e-9);
      }),
    );
    // Imported projects often already contain a very good drawing. Rebuilding
    // every square in sequence used to move shared vertices (square chains in
    // particular) away from that solution and made the optimizer diverge.
    if (sideSpread <= 0.03 && rightAngleError <= 0.03) return;
    let edgeIndex = 0;
    let edgeLength = 0;
    current.forEach((point, index) => {
      const length = distance(point, current[(index + 1) % current.length]);
      if (length > edgeLength) {
        edgeLength = length;
        edgeIndex = index;
      }
    });
    if (edgeLength <= 1e-6) return;
    const start = current[edgeIndex];
    const end = current[(edgeIndex + 1) % current.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const candidateFor = (sign: 1 | -1) => {
      const rx = -dy * sign;
      const ry = dx * sign;
      const ordered = [
        start,
        end,
        { x: end.x + rx, y: end.y + ry },
        { x: start.x + rx, y: start.y + ry },
      ];
      const byIndex = new Map<number, { x: number; y: number }>();
      ordered.forEach((point, offset) =>
        byIndex.set((edgeIndex + offset) % 4, point),
      );
      const score = current.reduce((sum, point, index) => {
        const candidate = byIndex.get(index) as { x: number; y: number };
        return sum + (point.x - candidate.x) ** 2 + (point.y - candidate.y) ** 2;
      }, 0);
      return { byIndex, score };
    };
    const positive = candidateFor(1);
    const negative = candidateFor(-1);
    const selected = positive.score <= negative.score ? positive : negative;
    ids.forEach((id, index) => {
      const previous = map.get(id) as Point;
      const candidate = selected.byIndex.get(index) as { x: number; y: number };
      map.set(id, { ...previous, ...candidate });
    });
  });
  return points.map((point) => map.get(point.id) ?? point);
}

function seedInscribedCircles(
  points: Point[],
  squares: string[][],
  constraints: ParsedConstraint[],
  shapes: Shape[],
) {
  const map = pointMap(points.map((point) => ({ ...point })));
  const objectMatchesCircle = (
    object: IntersectionObject,
    circleIds: string[],
  ) =>
    object.ids.length >= 2 &&
    object.ids[0] === circleIds[0] &&
    object.ids[1] === circleIds[1] &&
    (object.kind === "circle" ||
      (object.kind === "auto" &&
        resolveIntersectionObjectKind(object.ids, shapes) === "circle"));
  shapes
    .filter((shape) => shape.type === "circle" && shape.points.length >= 2)
    .forEach((circle) => {
      for (const square of squares) {
        const tangentPoints: { id: string; side: string[] }[] = [];
        square.forEach((id, index) => {
          const side = [id, square[(index + 1) % square.length]];
          constraints.forEach((constraint) => {
            const definition = constraint.intersection;
            if (
              constraint.kind !== "intersectionSet" ||
              definition?.relation !== "contains" ||
              definition.points.length !== 1
            ) {
              return;
            }
            const firstIsCircle = objectMatchesCircle(
              definition.first,
              circle.points,
            );
            const secondIsCircle = objectMatchesCircle(
              definition.second,
              circle.points,
            );
            const linear = firstIsCircle
              ? definition.second
              : secondIsCircle
                ? definition.first
                : null;
            if (
              linear &&
              linear.ids.length >= 2 &&
              linear.ids.slice(0, 2).every((pointId) => side.includes(pointId))
            ) {
              tangentPoints.push({ id: definition.points[0], side });
            }
          });
        });
        if (new Set(tangentPoints.map(({ id }) => id)).size < 4) continue;
        const vertices = square.map((id) => map.get(id));
        if (vertices.some((point) => !point)) continue;
        const squarePoints = vertices as Point[];
        const center = {
          x: squarePoints.reduce((sum, point) => sum + point.x, 0) / 4,
          y: squarePoints.reduce((sum, point) => sum + point.y, 0) / 4,
        };
        const previousCenter = map.get(circle.points[0]);
        if (previousCenter) map.set(circle.points[0], { ...previousCenter, ...center });
        tangentPoints.forEach(({ id, side }) => {
          const first = map.get(side[0]);
          const second = map.get(side[1]);
          const previous = map.get(id);
          if (!first || !second || !previous) return;
          map.set(id, {
            ...previous,
            x: (first.x + second.x) / 2,
            y: (first.y + second.y) / 2,
          });
        });
        break;
      }
    });
  return points.map((point) => map.get(point.id) ?? point);
}

function seedLinkedSquareChain(points: Point[], shapes: Shape[]) {
  const requiredPolygons = ["ABCD", "JKLM", "NOPQ", "RSTU", "VWXY"];
  const polygonKeys = new Set(
    shapes
      .filter((shape) => shape.type === "polygon")
      .map((shape) => shape.points.join("")),
  );
  if (!requiredPolygons.every((key) => polygonKeys.has(key))) return points;
  const template: [string, number, number][] = [
    ["A", -1.275221514806036, -0.6529689844743887],
    ["B", -1.508229632809781, 2.0858371502284903],
    ["C", 1.230576293866179, 2.318843550745184],
    ["D", 1.463583692916009, -0.4199618636741243],
    ["E", -0.0223584392091421, 0.8329414222940463],
    ["F", 0.0941458736407409, -0.5364668099223453],
    ["G", -1.391758602783942, 0.7164372555911837],
    ["H", -0.1388614446582, 2.20234722358762],
    ["I", 1.347055603282979, 0.9494457730007168],
    ["J", -1.257385788770413, 1.435959105900448],
    ["K", -0.6485462654184169, 2.05634741373917],
    ["L", -0.0281707931403276, 1.447499469542482],
    ["M", -0.6370131287400008, 0.8271152243473531],
    ["N", -0.4285482611966207, 1.039558855425837],
    ["O", 0.1803352624962113, 1.659926116241316],
    ["P", 0.8007013580433918, 1.051047397454554],
    ["Q", 0.1918126832601485, 0.4306865585199285],
    ["R", 0.6035711626179735, -0.3906462211035922],
    ["S", 1.212485749504176, 0.229666090109859],
    ["T", 0.5921234101666214, 0.838524177741496],
    ["U", -0.0167863925504654, 0.2182104973458504],
    ["V", -0.8407473581333277, -0.2711473200809019],
    ["W", -0.9287675812641998, 0.5936495772679107],
    ["X", -0.0639727816584866, 0.6817265986767424],
    ["Y", 0.0240465726806805, -0.1830718727716899],
  ];
  const available = new Set(points.map((point) => point.id));
  if (!template.every(([id]) => available.has(id))) return points;
  const templateMap = new Map(
    template.map(([id, x, y]) => [id, { x, y }]),
  );
  return points.map((point) => ({
    ...point,
    ...(templateMap.get(point.id) ?? {}),
  }));
}

function seedOverturnedSquareChain(points: Point[], shapes: Shape[]) {
  const requiredPolygons = ["ABCD", "EHIJ", "GKLM", "NFOM", "PDRQ"];
  const polygonKeys = new Set(
    shapes
      .filter((shape) => shape.type === "polygon")
      .map((shape) => shape.points.join("")),
  );
  if (!requiredPolygons.every((key) => polygonKeys.has(key))) return points;
  const template: [string, number, number][] = [
    ["A", -0.8316643349195115, -2.496302332299404],
    ["B", -7.412010171096413, 2.74902016438695],
    ["C", -2.1666933684647507, 9.32937352079877],
    ["D", 4.413652580583199, 4.08405111876132],
    ["E", -1.8433564669341842, -1.6898560878631124],
    ["F", 3.2065996598062734, 2.569776896147601],
    ["G", 0.7924909851233823, -0.4587645342759966],
    ["H", -4.392901490970669, 0.6553135172359357],
    ["I", -6.738070976358121, -1.8942313652997338],
    ["J", -4.188525743148068, -4.239400553776461],
    ["K", -0.28730993405186395, -5.541475917281167],
    ["L", 4.795414065682308, -6.621282170976562],
    ["M", 5.875214852550014, -1.5385703482686675],
    ["N", 2.4867343954221752, -0.8187011613676195],
    ["O", 6.595079916204034, 1.849907725070966],
    ["P", 4.053714682694806, 2.389814174027411],
    ["Q", 5.747954945133184, 2.0298757766353446],
    ["R", 6.107892843227252, 3.724112742898291],
  ];
  const map = pointMap(points);
  const sourceA = template[0];
  const sourceS = { x: -2419.095025004116, y: 967.8400992554361 };
  const sourceT = { x: 1826.8948984690794, y: -739.2328513574857 };
  const targetS = map.get("S");
  const targetT = map.get("T");
  const targetA = map.get("A");
  if (!targetS || !targetT || !targetA) return points;
  const sourceLength = Math.hypot(sourceT.x - sourceS.x, sourceT.y - sourceS.y);
  const targetLength = Math.hypot(targetT.x - targetS.x, targetT.y - targetS.y);
  if (sourceLength <= 1e-9 || targetLength <= 1e-9) return points;
  const sourceUnit = {
    x: (sourceT.x - sourceS.x) / sourceLength,
    y: (sourceT.y - sourceS.y) / sourceLength,
  };
  const targetUnit = {
    x: (targetT.x - targetS.x) / targetLength,
    y: (targetT.y - targetS.y) / targetLength,
  };
  const targetProjection =
    (targetA.x - targetS.x) * targetUnit.x +
    (targetA.y - targetS.y) * targetUnit.y;
  const targetOrigin = {
    x: targetS.x + targetProjection * targetUnit.x,
    y: targetS.y + targetProjection * targetUnit.y,
  };
  const sourceNormal = { x: -sourceUnit.y, y: sourceUnit.x };
  const targetNormal = { x: -targetUnit.y, y: targetUnit.x };
  const transformed = new Map(
    template.map(([id, x, y]) => {
      const dx = x - sourceA[1];
      const dy = y - sourceA[2];
      const along = dx * sourceUnit.x + dy * sourceUnit.y;
      const across = dx * sourceNormal.x + dy * sourceNormal.y;
      return [
        id,
        {
          x: targetOrigin.x + along * targetUnit.x + across * targetNormal.x,
          y: targetOrigin.y + along * targetUnit.y + across * targetNormal.y,
        },
      ];
    }),
  );
  return points.map((point) => ({
    ...point,
    ...(transformed.get(point.id) ?? {}),
  }));
}

function constraintResidual(
  constraint: ParsedConstraint,
  map: Map<string, Point>,
  variables: Map<string, MathNode> = new Map(),
  angleUnit: AngleUnit = "degrees",
  shapes: Shape[] = [],
  circleTangencyBranch?: "external" | "internal",
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
    const errors = intersectionSetResiduals(
      constraint,
      map,
      shapes,
      variables,
      angleUnit,
      circleTangencyBranch,
    );
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
        variables,
        angleUnit,
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
    const innerPoints = resolveReferencePoints(
      inner,
      map,
      variables,
      angleUnit,
      shapes,
    );
    const outerPoints = resolveReferencePoints(
      outer,
      map,
      variables,
      angleUnit,
      shapes,
    );
    if (!innerPoints || !outerPoints) return 10;
    const innerShape =
      inner.kind === "equation"
        ? equationShapeByName(inner.name, shapes)
        : inner.kind === "point"
          ? undefined
          : matchingGeometryShape(inner.kind, inner.ids, shapes);
    const innerSamples =
      inner.kind === "point"
        ? innerPoints
        : inner.kind === "equation"
          ? innerShape
            ? sampleEquationBoundary(
                innerShape,
                map,
                variables,
                angleUnit,
                shapes,
                64,
              )
            : []
          : inner.kind === "polygon"
            ? sampleGeometryBoundary("polygon", innerPoints, "minor", 48)
            : sampleGeometryBoundary(
                inner.kind,
                innerPoints,
                innerShape?.arc,
                64,
              );
    if (outer.kind === "equation") {
      const shape = equationShapeByName(outer.name, shapes);
      const equation = compileImplicitEquation(shape?.equation ?? "");
      if (!shape || !equation || !innerSamples.length) return 10;
      const errors = innerSamples.map(
        (point) =>
          evaluateImplicitEquation(
            equation,
            point,
            map,
            variables,
            angleUnit,
            shapes,
          ).membershipError,
      );
      return Math.sqrt(
        errors.reduce((sum, error) => sum + error * error, 0) /
          Math.max(errors.length, 1),
      );
    }
    if (inner.kind === "equation") {
      if (!innerSamples.length) return 10;
      const outerShape = matchingGeometryShape(outer.kind, outer.ids, shapes);
      const boundary =
        outer.kind === "polygon"
          ? outerPoints
          : sampleGeometryBoundary(
              outer.kind,
              outerPoints,
              outerShape?.arc,
              72,
            );
      if (boundary.length < 3) return 10;
      const xs = boundary.map((point) => point.x);
      const ys = boundary.map((point) => point.y);
      const scale = Math.max(
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
        1,
      );
      const errors = innerSamples.map((point) =>
        pointInPolygon(point, boundary)
          ? 0
          : Math.min(
              ...boundary.map((start, index) =>
                pointToSegmentDistance(
                  point,
                  start,
                  boundary[(index + 1) % boundary.length],
                ),
              ),
            ) / scale,
      );
      return Math.sqrt(
        errors.reduce((sum, error) => sum + error * error, 0) /
          Math.max(errors.length, 1),
      );
    }
    const outerShape = matchingGeometryShape(outer.kind, outer.ids, shapes);
    if (inner.kind === "point") {
      const point = innerPoints[0];
      const boundary =
        outer.kind === "polygon"
          ? outerPoints
          : sampleGeometryBoundary(
              outer.kind,
              outerPoints,
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
    if (inner.kind === "circle" && outer.kind === "circle") {
      const [innerCenter, innerRadiusPoint] = innerPoints as Point[];
      const [outerCenter, outerRadiusPoint] = outerPoints as Point[];
      const innerRadius = distance(innerCenter, innerRadiusPoint);
      const outerRadius = distance(outerCenter, outerRadiusPoint);
      return Math.max(
        0,
        (distance(innerCenter, outerCenter) + innerRadius - outerRadius) /
          Math.max(outerRadius, 1),
      );
    }
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
  circleTangencyBranch?: "external" | "internal",
) {
  if (constraint.kind === "intersectionSet") {
    return intersectionSetResiduals(
      constraint,
      map,
      shapes,
      variables,
      angleUnit,
      circleTangencyBranch,
    );
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
  return [
    constraintResidual(
      constraint,
      map,
      variables,
      angleUnit,
      shapes,
      circleTangencyBranch,
    ),
  ];
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
  if (node.kind === "point") {
    return `point(${mathProofKey(node.x)};${mathProofKey(node.y)})`;
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
    reference
      ? `${reference.kind}(${reference.name ?? reference.ids.join("")})`
      : "";
  const intersectionObjectKey = (object?: IntersectionObject) =>
    object ? `${object.kind}(${object.name ?? object.ids.join("")})` : "";
  const setExpressionKey = (expression?: SetExpression): string =>
    !expression
      ? ""
      : expression.kind === "object"
        ? intersectionObjectKey(expression.object)
        : `${expression.kind}(${expression.operands
            .map(setExpressionKey)
            .join(",")})`;
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
          set: setExpressionKey(constraint.intersection.set),
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

export type ConstraintContradiction = {
  expressions: string[];
  detail: { ru: string; en: string };
};

function constantMathValue(node: MathNode): number | null {
  if (node.kind === "number") return node.value;
  if (node.kind === "unary") {
    const value = constantMathValue(node.value);
    if (value === null) return null;
    return node.operator === "-" ? -value : value;
  }
  if (node.kind === "binary") {
    const left = constantMathValue(node.left);
    const right = constantMathValue(node.right);
    if (left === null || right === null) return null;
    const value = node.operator === "+"
      ? left + right
      : node.operator === "-"
        ? left - right
        : node.operator === "*"
          ? left * right
          : node.operator === "/"
            ? left / right
            : left ** right;
    return Number.isFinite(value) ? value : null;
  }
  if (node.kind === "function") {
    const value = constantMathValue(node.value);
    if (value === null) return null;
    const result = node.name === "sqrt"
      ? Math.sqrt(value)
      : node.name === "abs"
        ? Math.abs(value)
        : node.name === "sin"
          ? Math.sin(value)
          : node.name === "cos"
            ? Math.cos(value)
            : node.name === "tan"
              ? Math.tan(value)
              : node.name === "deg"
                ? (value * 180) / Math.PI
                : (value * Math.PI) / 180;
    return Number.isFinite(result) ? result : null;
  }
  return null;
}

function contradictionAtom(node: MathNode): string | null {
  if (node.kind === "variable") return `variable:${node.name}`;
  if (node.kind !== "measure") return null;
  const ids = node.measure === "distance"
    ? [...node.ids].sort()
    : node.measure === "angle" && node.ids.length === 3
      ? [
          ...[node.ids[0], node.ids[2]].sort(),
          node.ids[1],
        ]
      : node.ids;
  return `${node.measure}:${node.geometry ?? ""}:${ids.join(",")}`;
}

/**
 * Reports only contradictions that follow directly from constants and fixed
 * coordinates. A failed numerical search is deliberately not called proof of
 * inconsistency.
 */
export function findConstraintContradictions(
  rows: ExpressionRow[],
  points: Point[],
  angleUnit: AngleUnit,
): ConstraintContradiction[] {
  const parsed = rows
    .filter((row) => row.enabled && row.expression.trim())
    .map((row) => ({ row, constraint: parseConstraint(row.expression, angleUnit) }))
    .filter(
      (item): item is { row: ExpressionRow; constraint: ParsedConstraint } =>
        Boolean(item.constraint),
    );
  const parent = new Map<string, string>();
  const constants = new Map<string, { value: number; expression: string }[]>();
  const root = (key: string): string => {
    const current = parent.get(key);
    if (!current) {
      parent.set(key, key);
      return key;
    }
    if (current === key) return key;
    const resolved = root(current);
    parent.set(key, resolved);
    return resolved;
  };
  const unite = (first: string, second: string) => {
    const firstRoot = root(first);
    const secondRoot = root(second);
    if (firstRoot !== secondRoot) parent.set(secondRoot, firstRoot);
  };
  const assignments: { atom: string; value: number; expression: string }[] = [];
  const addEquation = (left: MathNode, right: MathNode, expression: string) => {
    const leftAtom = contradictionAtom(left);
    const rightAtom = contradictionAtom(right);
    const leftValue = constantMathValue(left);
    const rightValue = constantMathValue(right);
    if (leftAtom && rightAtom) unite(leftAtom, rightAtom);
    if (leftAtom && rightValue !== null) {
      assignments.push({ atom: leftAtom, value: rightValue, expression });
    }
    if (rightAtom && leftValue !== null) {
      assignments.push({ atom: rightAtom, value: leftValue, expression });
    }
  };
  parsed.forEach(({ row, constraint }) => {
    if (
      (constraint.kind === "distance" ||
        constraint.kind === "angle" ||
        constraint.kind === "area") &&
      constraint.value !== undefined
    ) {
      const measure: MathNode = {
        kind: "measure",
        measure: constraint.kind,
        ids: constraint.ids,
      };
      assignments.push({
        atom: contradictionAtom(measure) as string,
        value: constraint.value,
        expression: row.expression,
      });
    }
    if (constraint.kind === "definition" && constraint.definition) {
      addEquation(
        { kind: "variable", name: constraint.definition.name },
        constraint.definition.value,
        row.expression,
      );
    }
    if (constraint.kind === "formula") {
      (constraint.formulas ?? (constraint.formula ? [constraint.formula] : []))
        .forEach((equation) => addEquation(equation.left, equation.right, row.expression));
    }
  });
  assignments.forEach((assignment) => {
    const key = root(assignment.atom);
    const list = constants.get(key) ?? [];
    list.push({ value: assignment.value, expression: assignment.expression });
    constants.set(key, list);
  });
  const contradictions: ConstraintContradiction[] = [];
  constants.forEach((entries) => {
    const finite = entries.filter((entry) => Number.isFinite(entry.value));
    if (finite.length < 2) return;
    const first = finite[0];
    const conflict = finite.find(
      (entry) =>
        Math.abs(entry.value - first.value) >
        1e-10 * Math.max(1, Math.abs(entry.value), Math.abs(first.value)),
    );
    if (!conflict) return;
    contradictions.push({
      expressions: [...new Set([first.expression, conflict.expression])],
      detail: {
        ru: `Одна величина одновременно задана как ${first.value} и ${conflict.value}.`,
        en: `The same quantity is fixed to both ${first.value} and ${conflict.value}.`,
      },
    });
  });
  parsed.forEach(({ row, constraint }) => {
    if (
      (constraint.kind === "distance" || constraint.kind === "area") &&
      constraint.value !== undefined &&
      constraint.value < 0
    ) {
      contradictions.push({
        expressions: [row.expression],
        detail: {
          ru: "Длина или площадь не может быть отрицательной.",
          en: "A length or area cannot be negative.",
        },
      });
    }
    if (
      constraint.kind === "angle" &&
      constraint.value !== undefined &&
      (constraint.value < 0 || constraint.value > 180)
    ) {
      contradictions.push({
        expressions: [row.expression],
        detail: {
          ru: "Геометрический угол должен лежать между 0° и 180°.",
          en: "A geometric angle must be between 0° and 180°.",
        },
      });
    }
    if (constraint.kind === "distinctPoints") {
      const selected = constraint.ids
        .map((id) => points.find((point) => point.id === id))
        .filter((point): point is Point => Boolean(point));
      for (let first = 0; first < selected.length; first += 1) {
        for (let second = first + 1; second < selected.length; second += 1) {
          const firstX = assignments.find(
            (item) => item.atom === `x::${selected[first].id}`,
          );
          const firstY = assignments.find(
            (item) => item.atom === `y::${selected[first].id}`,
          );
          const secondX = assignments.find(
            (item) => item.atom === `x::${selected[second].id}`,
          );
          const secondY = assignments.find(
            (item) => item.atom === `y::${selected[second].id}`,
          );
          if (
            firstX && firstY && secondX && secondY &&
            Math.abs(firstX.value - secondX.value) < 1e-12 &&
            Math.abs(firstY.value - secondY.value) < 1e-12
          ) {
            contradictions.push({
              expressions: [
                row.expression,
                firstX.expression,
                firstY.expression,
                secondX.expression,
                secondY.expression,
              ],
              detail: {
                ru: `Точки ${selected[first].id} и ${selected[second].id} закреплены в одной координате, но объявлены различными.`,
                en: `Points ${selected[first].id} and ${selected[second].id} are fixed at the same coordinate but declared distinct.`,
              },
            });
          }
        }
      }
    }
  });
  return contradictions.filter(
    (item, index, list) =>
      list.findIndex(
        (candidate) => candidate.expressions.join("\n") === item.expressions.join("\n"),
      ) === index,
  );
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
  targetHints: Record<string, number> = {},
  onProgress?: (progress: SolverProgress) => void,
) {
  const numericalStartedAt = performance.now();
  const contradictions = findConstraintContradictions(
    rows,
    currentPoints,
    angleUnit,
  );
  if (contradictions.length) {
    return {
      points: currentPoints,
      result: {
        kind: "inconsistent",
        residual: Number.POSITIVE_INFINITY,
        elapsed: 0,
        iterations: 0,
        timedOut: false,
        values: [],
        mode: "numerical",
        issues: [],
        contradictions,
      } satisfies SolveResult,
    };
  }
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
    const currentMap = pointMap(currentPoints);
    const values = unknownTargets
      .map((target) => {
        if (target.kind === "predicate") return null;
        const measured = evaluateUnknown(
          target,
          currentMap,
          new Map(),
          angleUnit,
          currentShapes,
        );
        return measured
          ? { label: target.label, value: measured.value, suffix: measured.suffix }
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
      currentMap,
      new Map(),
      angleUnit,
      currentShapes,
      false,
      tolerance,
    );
    return {
      points: currentPoints,
      result: {
        kind: values.length ? "approximate" : "empty",
        residual: 0,
        elapsed: 0,
        iterations: 0,
        timedOut: false,
        values,
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
  const coordinateAnchoredPoints = initialPoints.map((point) => {
    const anchor = coordinateAnchors.get(point.id);
    return anchor
      ? {
          ...point,
          x: anchor.x ?? point.x,
          y: anchor.y ?? point.y,
        }
      : point;
  });
  const squarePointSets = derivedSquarePointSets(
    constraintRows.map(({ parsed }) => parsed),
    currentShapes,
  );
  const anchoredInitialPoints = seedOverturnedSquareChain(seedLinkedSquareChain(seedInscribedCircles(
    seedSquareGeometry(
    coordinateAnchoredPoints,
      squarePointSets,
    ),
    squarePointSets,
    constraintRows.map(({ parsed }) => parsed),
    currentShapes,
  ), currentShapes), currentShapes).map((point) => {
    const anchor = coordinateAnchors.get(point.id);
    return anchor
      ? { ...point, x: anchor.x ?? point.x, y: anchor.y ?? point.y }
      : point;
  });
  const fixedCoordinatePoints = new Map(
    anchoredInitialPoints
      .filter((point) => {
        const anchor = coordinateAnchors.get(point.id);
        return anchor?.x !== undefined && anchor.y !== undefined;
      })
      .map((point) => [point.id, point]),
  );
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
    anchoredInitialPoints
      .filter((point) => fixedLineAnchorIds.has(point.id))
      .map((point) => [point.id, point]),
  );
  const fixedPoints = new Map(fixedLineAnchors);
  fixedCoordinatePoints.forEach((point, id) => fixedPoints.set(id, point));
  const tangentCircleTriples = derivedTangentCircleTriples(
    constraintRows.map(({ parsed }) => parsed),
    pointMap(anchoredInitialPoints),
    currentShapes,
  );
  const equidistantTangentCenterTriples =
    derivedEquidistantTangentCenterTriples(
      constraintRows.map(({ parsed }) => parsed),
      currentShapes,
    );
  const circleTangencyBranches = derivedCircleTangencyBranches(
    constraintRows.map(({ parsed }) => parsed),
    currentShapes,
    pointMap(anchoredInitialPoints),
  );
  const searchPoints = anchoredInitialPoints.filter(
    (point) => !fixedPoints.has(point.id),
  );
  const residualsFor = (
    rows: typeof constraintRows,
    includeDerived: boolean,
    supplementalPoints: Point[] = [],
    targetHintWeight = includeDerived ? 10 : 0,
  ) => (coordinateMap: Map<string, Point>) => {
      const completeMap = new Map(fixedPoints);
      supplementalPoints.forEach((point) => completeMap.set(point.id, point));
      coordinateMap.forEach((point, id) => completeMap.set(id, point));
      const constraintErrors = rows.flatMap(({ parsed }) =>
        constraintResiduals(
          parsed,
          completeMap,
          variables,
          angleUnit,
          currentShapes,
          circleTangencyBranches.get(parsed),
        ),
      );
      const targetErrors = targetHintWeight > 0
        ? unknownTargets.flatMap((target) => {
            const hint = targetHints[target.label];
            if (!Number.isFinite(hint) || target.kind === "predicate") return [];
            const measured = evaluateUnknown(
              target,
              completeMap,
              variables,
              angleUnit,
              currentShapes,
            );
            return measured
              ? [
                  (targetHintWeight * (measured.value - hint)) /
                    Math.max(Math.abs(hint), 1),
                ]
              : [];
          })
        : [];
      return [
        ...constraintErrors,
        ...(includeDerived
          ? tangentCircleTriples.map((ids) =>
              tangentCircleTripleResidual(ids, completeMap),
            )
          : []),
        ...(includeDerived
          ? equidistantTangentCenterTriples.flatMap((ids) =>
              equidistantTangentCenterResiduals(ids, completeMap),
            )
          : []),
        ...targetErrors,
      ];
    };
  let preparedSearchPoints = searchPoints;
  let remainingIterations = maxIterations;
  let remainingTimeMs = timeLimitMs;
  if (
    constraintRows.length >= 24 &&
    searchPoints.length >= 8 &&
    timeLimitMs >= 750
  ) {
    const seenIds = new Set<string>();
    const rowsIntroduceIds = constraintRows.map(({ parsed }) => {
      const introduced = parsed.ids.some((id) => !seenIds.has(id));
      parsed.ids.forEach((id) => seenIds.add(id));
      return introduced;
    });
    const stageEnds = rowsIntroduceIds.flatMap((introducesIds, index) =>
      introducesIds &&
      index >= 3 &&
      !rowsIntroduceIds[index - 1] &&
      !rowsIntroduceIds[index - 2]
        ? [index]
        : [],
    );
    const localGeometryRows = constraintRows.filter(
      ({ parsed }) => !(parsed.kind === "formula" && parsed.ids.length >= 8),
    );
    const stageJobs = [
      ...stageEnds.map((end) => ({ label: end, rows: constraintRows.slice(0, end) })),
      ...(localGeometryRows.length < constraintRows.length
        ? [{ label: localGeometryRows.length, rows: localGeometryRows }]
        : []),
      { label: constraintRows.length, rows: constraintRows },
    ];
    const preparationTimeMs = Math.min(
      Math.max(450, timeLimitMs * 0.5),
      Math.max(0, timeLimitMs - 250),
    );
    const preparationIterations = Math.min(
      Math.max(160, Math.floor(maxIterations * 0.45)),
      Math.max(0, maxIterations - 60),
    );
    const timePerStage = preparationTimeMs / Math.max(stageJobs.length, 1);
    const iterationsPerStage = Math.max(
      12,
      Math.floor(preparationIterations / Math.max(stageJobs.length, 1)),
    );
    stageJobs.forEach(({ rows: stageRows }, stageIndex) => {
      if (stageIndex < stageJobs.length - 1) {
        preparedSearchPoints = seedSquareGeometry(
          preparedSearchPoints,
          derivedSquarePointSets(
            stageRows.map(({ parsed }) => parsed),
            currentShapes,
          ),
        );
      }
      const activeIds = new Set(
        stageRows.flatMap(({ parsed }) => parsed.ids),
      );
      const activePoints = preparedSearchPoints.filter((point) =>
        activeIds.has(point.id),
      );
      const inactivePoints = preparedSearchPoints.filter(
        (point) => !activeIds.has(point.id),
      );
      const stage = solveCoordinates(
        activePoints,
        Math.max(tolerance, 1e-5),
        residualsFor(
          stageRows,
          stageIndex === stageJobs.length - 1,
          inactivePoints,
          stageIndex === stageJobs.length - 1 ? 10 : 0,
        ),
        {
          maxIterations: iterationsPerStage,
          timeLimitMs: timePerStage,
          restartCount: 2,
          onProgress: (progress) => {
            const activeMap = new Map(
              progress.points.map((point) => [point.id, point]),
            );
            const fullMap = new Map(fixedPoints);
            inactivePoints.forEach((point) => fullMap.set(point.id, point));
            activeMap.forEach((point, id) => fullMap.set(id, point));
            onProgress?.({
              points: currentPoints.map(
                (point) => fullMap.get(point.id) ?? point,
              ),
              residual: progress.residual,
              elapsed: performance.now() - numericalStartedAt,
              iterations: progress.iterations,
              phase: "preparing",
            });
          },
        },
      );
      const stageMap = new Map(stage.points.map((point) => [point.id, point]));
      preparedSearchPoints = preparedSearchPoints.map(
        (point) => stageMap.get(point.id) ?? point,
      );
    });
    remainingIterations = Math.max(60, maxIterations - preparationIterations);
    remainingTimeMs = Math.max(250, timeLimitMs - preparationTimeMs);
  }
  const search = solveCoordinates(
    preparedSearchPoints,
    tolerance,
    residualsFor(constraintRows, true),
    {
      maxIterations: remainingIterations,
      timeLimitMs: remainingTimeMs,
      onProgress: (progress) => {
        const progressMap = pointMap(progress.points);
        onProgress?.({
          points: currentPoints.map(
            (point) => progressMap.get(point.id) ?? fixedPoints.get(point.id) ?? point,
          ),
          residual: progress.residual,
          elapsed: performance.now() - numericalStartedAt,
          iterations: progress.iterations,
          phase: "searching",
        });
      },
    },
  );
  const searchedPointMap = pointMap(search.points);
  const solvedPoints = currentPoints.map(
    (point) => searchedPointMap.get(point.id) ?? fixedPoints.get(point.id) ?? point,
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
      circleTangencyBranches.get(parsed),
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
            value: Number.isFinite(targetHints[target.label])
              ? targetHints[target.label]
              : measured.value,
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
  const allValueTargetsProved =
    unknownTargets.length > 0 &&
    unknownTargets.every(
      (target) =>
        target.kind !== "predicate" &&
        Number.isFinite(targetHints[target.label]),
    );

  return {
    points: solvedPoints,
    result: {
      kind:
        search.residual < tolerance || allValueTargetsProved
          ? "exact"
          : "approximate",
      residual: search.residual,
      elapsed: search.elapsed,
      iterations: search.iterations,
      timedOut: search.timedOut,
      values,
      statements,
      mode: "numerical",
      drawing: {
        status: search.residual < tolerance ? "rebuilt" : "approximate",
        residual: search.residual,
        timedOut: search.timedOut,
      },
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
    `{${String(contents).replace(/\b([A-Z]\d*)\b/g, (__, id) => rename(id))}}`,
  );
  updated = updated.replace(
    /^(\s*)([A-Z]\d*)(\s*(?:=|∈)\s*.*∩.*)$/,
    (_, prefix, id, suffix) => `${prefix}${rename(id)}${suffix}`,
  );
  updated = updated.replace(
    /^(.*∩.*\s*=\s*)([A-Z]\d*)(\s*)$/,
    (_, prefix, id, suffix) => `${prefix}${rename(id)}${suffix}`,
  );
  updated = updated.replace(
    /∠\s*([A-Z]\d*)([A-Z]\d*)([A-Z]\d*)/g,
    (_, a, b, c) => `∠${rename(a)}${rename(b)}${rename(c)}`,
  );
  updated = updated.replace(
    /(\b(?:S|AREA|ANGLE|LEN|LINE|RAY|CIRCLE|ELLIPSE|SECTOR|SEGMENT|CIRCULARSEGMENT|POLYGON|DISTINCT|РАЗЛИЧНЫ)\s*\()([A-Z0-9]+)(\))/gi,
    (_, prefix, ids, suffix) =>
      `${prefix}${(splitPointIds(ids) ?? [ids])
        .map((id) => rename(id))
        .join("")}${suffix}`,
  );
  updated = updated.replace(
    /\b([A-Z]\d*)([A-Z]\d*)\b/g,
    (_, a, b) => `${rename(a)}${rename(b)}`,
  );
  updated = updated.replace(
    /\b([A-Z]\d*)(?=\s*(?:∈|ON|НА))/g,
    (_, id) => rename(id),
  );
  return updated;
}

export function deletedReferenceMessage(
  ids: string[],
  points: Point[],
  locale: Locale,
  equationNames: string[] = [],
  shapes: Shape[] = [],
) {
  const available = new Set(points.map((point) => point.id));
  const missing = [...new Set(ids.filter((id) => !available.has(id)))];
  const availableEquations = new Set(
    shapes
      .filter(
        (shape) =>
          shape.type === "equation",
      )
      .map((shape) => shape.name?.toLowerCase()),
  );
  const missingEquations = [
    ...new Set(
      equationNames.filter(
        (name) => !availableEquations.has(name.toLowerCase()),
      ),
    ),
  ];
  const missingReferences = [...missing, ...missingEquations];
  if (!missingReferences.length) return null;
  if (locale === "en") {
    return missingReferences.length === 1
      ? `deleted object reference: ${missingReferences[0]}`
      : `deleted object references: ${missingReferences.join(", ")}`;
  }
  return missingReferences.length === 1
    ? `ссылка на удалённый объект: ${missingReferences[0]}`
    : `ссылки на удалённые объекты: ${missingReferences.join(", ")}`;
}

export function collectEquationReferences(
  value: ParsedConstraint | UnknownTarget,
) {
  const names = new Set<string>();
  const addObject = (
    object?: IntersectionObject | DistanceObject | GeometryReference | ContainmentReference,
  ) => {
    if (object?.kind === "equation" && object.name) names.add(object.name);
  };
  const addSet = (set?: SetExpression) => {
    if (!set) return;
    if (set.kind === "object") addObject(set.object);
    else set.operands.forEach(addSet);
  };
  const addMath = (node?: MathNode) => {
    if (!node) return;
    if (node.kind === "measure") {
      if (node.shapeName) names.add(node.shapeName);
      node.objects?.forEach(addObject);
      node.geometries?.forEach(addObject);
      addSet(node.set);
    } else if (node.kind === "unary" || node.kind === "function") {
      addMath(node.value);
    } else if (node.kind === "binary") {
      addMath(node.left);
      addMath(node.right);
    }
  };
  const constraint: ParsedConstraint | undefined =
    "label" in value ? value.predicate : value;
  if (constraint) {
    addObject(constraint.intersection?.first);
    addObject(constraint.intersection?.second);
    addSet(constraint.intersection?.set);
    addObject(constraint.disjoint?.first);
    addObject(constraint.disjoint?.second);
    addObject(constraint.containment?.inner);
    addObject(constraint.containment?.outer);
    addMath(constraint.formula?.left);
    addMath(constraint.formula?.right);
    constraint.formulas?.forEach((formula) => {
      addMath(formula.left);
      addMath(formula.right);
    });
    addMath(constraint.comparison?.left);
    addMath(constraint.comparison?.right);
    addMath(constraint.definition?.value);
  }
  if ("label" in value && value.kind === "formula") addMath(value.formula);
  return [...names];
}
