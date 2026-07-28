"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { HelpDialog, SYMBOL_COMMANDS } from "./help-dialog";
import type { Locale } from "./i18n";
import { localText } from "./i18n";
import { AppMark, ToolGlyph } from "./interface-icons";
import { SettingsDialog } from "./settings-dialog";
import { solveCoordinates } from "./solver";
import {
  localizeToolGroups,
  localizeTools,
} from "./tool-localization";

type Point = { id: string; x: number; y: number };
type Shape = {
  id: string;
  type:
    | "segment"
    | "line"
    | "ray"
    | "circle"
    | "ellipse"
    | "sector"
    | "circularSegment"
    | "polygon";
  points: string[];
  color: string;
  arc?: "minor" | "major";
};
type Measurement = {
  id: number;
  kind: "distance" | "angle" | "area";
  points: string[];
  color: string;
};
type ExpressionRow = {
  id: number;
  expression: string;
  enabled: boolean;
  color: string;
};
type ToolId =
  | "select"
  | "marquee"
  | "point"
  | "pointOnSegment"
  | "segment"
  | "line"
  | "ray"
  | "circle"
  | "ellipse"
  | "sector"
  | "majorSector"
  | "circularSegment"
  | "polygon"
  | "regularPolygon"
  | "triangle"
  | "rightTriangle"
  | "isoscelesTriangle"
  | "equilateralTriangle"
  | "square"
  | "rectangle"
  | "parallelogram"
  | "trapezoid"
  | "rhombus"
  | "length"
  | "angle"
  | "area";
type MathNode =
  | { kind: "number"; value: number }
  | { kind: "variable"; name: string }
  | {
      kind: "measure";
      measure: "distance" | "angle" | "area" | "x" | "y";
      ids: string[];
    }
  | { kind: "unary"; operator: "+" | "-"; value: MathNode }
  | {
      kind: "binary";
      operator: "+" | "-" | "*" | "/" | "^";
      left: MathNode;
      right: MathNode;
    }
  | {
      kind: "function";
      name: "sqrt" | "abs" | "sin" | "cos" | "tan" | "deg" | "rad";
      value: MathNode;
    };
type AngleUnit = "degrees" | "radians";
type FormulaEquation = {
  left: MathNode;
  right: MathNode;
  source: string;
};
type ComparisonOperator = "!=" | "<" | ">" | "<=" | ">=";
type FormulaComparison = {
  left: MathNode;
  right: MathNode;
  operator: ComparisonOperator;
  source: string;
};
type VariableDefinition = {
  name: string;
  value: MathNode;
  source: string;
};
type IntersectionObject = {
  kind: "auto" | "segment" | "line" | "ray" | "circle";
  ids: [string, string];
};
type IntersectionDefinition = {
  point: string;
  first: IntersectionObject;
  second: IntersectionObject;
};
type ParsedConstraint = {
  kind:
    | "distance"
    | "angle"
    | "area"
    | "parallel"
    | "perpendicular"
    | "onSegment"
    | "onLine"
    | "onRay"
    | "onCircle"
    | "onEllipse"
    | "distinctPoints"
    | "nonIntersecting"
    | "intersectionPoint"
    | "definition"
    | "formula"
    | "inequality";
  ids: string[];
  value?: number;
  formula?: FormulaEquation;
  formulas?: FormulaEquation[];
  comparison?: FormulaComparison;
  comparisons?: FormulaComparison[];
  definition?: VariableDefinition;
  intersection?: IntersectionDefinition;
  source?: string;
};
type UnknownTarget = {
  kind: "distance" | "angle" | "area" | "formula";
  ids: string[];
  label: string;
  formula?: MathNode;
};
type SolveResult = {
  kind: "exact" | "approximate" | "dirty" | "empty";
  residual: number;
  elapsed: number;
  values: { label: string; value: number; suffix: string }[];
  issues: { expression: string; error: number }[];
};
type DrawingSnapshot = {
  points: Point[];
  shapes: Shape[];
  measurements: Measurement[];
  known: ExpressionRow[];
  unknown: ExpressionRow[];
};
type CanvasView = { x: number; y: number; scale: number };
type ImportedProject = {
  projectTitle: string;
  snapshot: DrawingSnapshot;
  solverEpsilon: string;
  view: CanvasView | null;
};
type HistoryState = {
  past: DrawingSnapshot[];
  present: DrawingSnapshot;
  future: DrawingSnapshot[];
};

const COLORS = ["#5b6df9", "#ef6b62", "#26a880", "#f0a11b", "#8c5ad7"];
const DEFAULT_PROJECT_TITLE = "Прямоугольный треугольник";
const DEFAULT_SOLVER_EPSILON = 1e-6;
const DEFAULT_SOLVER_EPSILON_INPUT = "1e-6";
const DEFAULT_DECIMAL_DIGITS = 3;
const SETTINGS_STORAGE_KEY = "geosolver-settings-v1";
const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024;
const MOBILE_WORKSPACE_QUERY =
  "(max-width: 680px), (max-width: 1000px) and (max-height: 650px) and (orientation: landscape)";
const SYMBOL_COMMAND_MAP = new Map<string, string>(
  SYMBOL_COMMANDS.map(({ command, symbol }) => [command, symbol]),
);

function expandSymbolCommands(
  value: string,
  selectionStart: number,
  selectionEnd: number,
) {
  const replacements: {
    index: number;
    length: number;
    symbol: string;
  }[] = [];
  const expanded = value.replace(
    /\\([A-Za-z]+)/g,
    (match, command: string, index: number) => {
      const symbol = SYMBOL_COMMAND_MAP.get(command.toLowerCase());
      if (!symbol) return match;
      replacements.push({ index, length: match.length, symbol });
      return symbol;
    },
  );
  const adjustPosition = (position: number) =>
    replacements.reduce(
      (current, replacement) =>
        replacement.index + replacement.length <= position
          ? current + replacement.symbol.length - replacement.length
          : current,
      position,
    );
  return {
    value: expanded,
    selectionStart: adjustPosition(selectionStart),
    selectionEnd: adjustPosition(selectionEnd),
    changed: replacements.length > 0,
  };
}

function parseSolverEpsilon(value: string | number) {
  const parsed =
    typeof value === "number"
      ? value
      : Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1
    ? parsed
    : DEFAULT_SOLVER_EPSILON;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function isImportedPoint(value: unknown): value is Point {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    /^[A-Z][A-Z0-9]*$/.test(value.id) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    Math.abs(value.x) <= 1_000_000 &&
    typeof value.y === "number" &&
    Number.isFinite(value.y) &&
    Math.abs(value.y) <= 1_000_000
  );
}

function isImportedShape(value: unknown): value is Shape {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !Array.isArray(value.points) ||
    !value.points.every((id) => typeof id === "string") ||
    !isSafeColor(value.color)
  ) {
    return false;
  }
  const type = String(value.type);
  if (
    ![
      "segment",
      "line",
      "ray",
      "circle",
      "ellipse",
      "sector",
      "circularSegment",
      "polygon",
    ].includes(type)
  ) {
    return false;
  }
  if (type === "polygon") return value.points.length >= 3;
  if (
    type === "ellipse" ||
    type === "sector" ||
    type === "circularSegment"
  ) {
    if (
      value.arc !== undefined &&
      value.arc !== "minor" &&
      value.arc !== "major"
    ) {
      return false;
    }
    return value.points.length === 3;
  }
  return value.points.length === 2;
}

function isImportedMeasurement(value: unknown): value is Measurement {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    Number.isSafeInteger(value.id) &&
    ["distance", "angle", "area"].includes(String(value.kind)) &&
    Array.isArray(value.points) &&
    value.points.every((id) => typeof id === "string") &&
    isSafeColor(value.color)
  );
}

function isImportedExpression(value: unknown): value is ExpressionRow {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    Number.isSafeInteger(value.id) &&
    typeof value.expression === "string" &&
    value.expression.length <= 5000 &&
    typeof value.enabled === "boolean" &&
    isSafeColor(value.color)
  );
}

function parseImportedProject(source: string): ImportedProject {
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    throw new Error("Файл содержит некорректный JSON.");
  }
  if (!isRecord(data)) {
    throw new Error("Файл не похож на проект GeoSolver.");
  }

  const measurements = data.measurements ?? [];
  if (
    !Array.isArray(data.points) ||
    data.points.length > 5000 ||
    !data.points.every(isImportedPoint) ||
    !Array.isArray(data.shapes) ||
    data.shapes.length > 5000 ||
    !data.shapes.every(isImportedShape) ||
    !Array.isArray(measurements) ||
    measurements.length > 5000 ||
    !measurements.every(isImportedMeasurement) ||
    !Array.isArray(data.known) ||
    data.known.length > 5000 ||
    !data.known.every(isImportedExpression) ||
    !Array.isArray(data.unknown) ||
    data.unknown.length > 5000 ||
    !data.unknown.every(isImportedExpression)
  ) {
    throw new Error("В файле повреждены или отсутствуют данные чертежа.");
  }

  const pointIds = new Set(data.points.map((point) => point.id));
  if (
    pointIds.size !== data.points.length ||
    data.shapes.some((shape) =>
      shape.points.some((pointId) => !pointIds.has(pointId)),
    ) ||
    measurements.some((measurement) =>
      measurement.points.some((pointId) => !pointIds.has(pointId)),
    )
  ) {
    throw new Error("Файл содержит повторяющиеся или отсутствующие точки.");
  }

  const title =
    typeof data.projectTitle === "string" && data.projectTitle.trim()
      ? data.projectTitle.trim().slice(0, 80)
      : DEFAULT_PROJECT_TITLE;
  const epsilonCandidate =
    typeof data.solverEpsilon === "string" ||
    typeof data.solverEpsilon === "number"
      ? data.solverEpsilon
      : DEFAULT_SOLVER_EPSILON_INPUT;
  const normalizedEpsilon = Number(
    String(epsilonCandidate).trim().replace(",", "."),
  );
  const solverEpsilon =
    Number.isFinite(normalizedEpsilon) &&
    normalizedEpsilon > 0 &&
    normalizedEpsilon <= 1
      ? String(epsilonCandidate)
      : DEFAULT_SOLVER_EPSILON_INPUT;
  const importedView = data.view;
  const view =
    isRecord(importedView) &&
    typeof importedView.x === "number" &&
    Number.isFinite(importedView.x) &&
    Math.abs(importedView.x) <= 1_000_000 &&
    typeof importedView.y === "number" &&
    Number.isFinite(importedView.y) &&
    Math.abs(importedView.y) <= 1_000_000 &&
    typeof importedView.scale === "number" &&
    Number.isFinite(importedView.scale) &&
    importedView.scale >= 0.01 &&
    importedView.scale <= 10_000
      ? {
          x: importedView.x,
          y: importedView.y,
          scale: importedView.scale,
        }
      : null;

  return {
    projectTitle: title,
    snapshot: cloneSnapshot({
      points: data.points,
      shapes: data.shapes,
      measurements,
      known: data.known,
      unknown: data.unknown,
    }),
    solverEpsilon,
    view,
  };
}

const INITIAL_POINTS: Point[] = [
  { id: "A", x: -3, y: -2 },
  { id: "B", x: 2, y: -2 },
  { id: "C", x: -3, y: 2 },
];

const INITIAL_SHAPES: Shape[] = [
  {
    id: "shape-triangle",
    type: "polygon",
    points: ["A", "B", "C"],
    color: "#5b6df9",
  },
];
const INITIAL_MEASUREMENTS: Measurement[] = [];

const INITIAL_KNOWN: ExpressionRow[] = [
  { id: 1, expression: "AB = 5", enabled: true, color: COLORS[0] },
  { id: 2, expression: "AC = 4", enabled: true, color: COLORS[1] },
  { id: 3, expression: "∠BAC = 90°", enabled: true, color: COLORS[2] },
];

const INITIAL_UNKNOWN: ExpressionRow[] = [
  { id: 4, expression: "BC = ?", enabled: true, color: COLORS[3] },
];

const PENDING_RESULT: SolveResult = {
  kind: "dirty",
  residual: 0,
  elapsed: 0,
  values: [],
  issues: [],
};

const TOOLS: {
  id: ToolId;
  label: string;
  icon: string;
  hint: string;
  shortcut: string;
  code: string;
}[] = [
  {
    id: "select",
    label: "Переместить",
    icon: "↖",
    hint: "Тяните точки или свободное место",
    shortcut: "V",
    code: "KeyV",
  },
  {
    id: "marquee",
    label: "Выделить область",
    icon: "□",
    hint: "Обведите точки рамкой, затем перетащите или удалите их",
    shortcut: "B",
    code: "KeyB",
  },
  {
    id: "point",
    label: "Точка",
    icon: "•",
    hint: "Кликните на поле",
    shortcut: "P",
    code: "KeyP",
  },
  {
    id: "pointOnSegment",
    label: "Точка на объекте",
    icon: "⊙",
    hint: "Кликните по границе отрезка, линии, окружности, эллипса или фигуры",
    shortcut: "O",
    code: "KeyO",
  },
  {
    id: "segment",
    label: "Отрезок",
    icon: "╱",
    hint: "Выберите две точки",
    shortcut: "S",
    code: "KeyS",
  },
  {
    id: "line",
    label: "Прямая",
    icon: "―",
    hint: "Выберите две точки",
    shortcut: "L",
    code: "KeyL",
  },
  {
    id: "ray",
    label: "Луч",
    icon: "⟶",
    hint: "Укажите начало и точку направления",
    shortcut: "R",
    code: "KeyR",
  },
  {
    id: "circle",
    label: "Окружность",
    icon: "○",
    hint: "Укажите центр и точку на окружности",
    shortcut: "1",
    code: "",
  },
  {
    id: "ellipse",
    label: "Эллипс",
    icon: "⬭",
    hint: "Укажите центр и концы двух полуосей",
    shortcut: "2",
    code: "",
  },
  {
    id: "sector",
    label: "Сектор",
    icon: "◔",
    hint: "Укажите центр и две точки на малой дуге",
    shortcut: "3",
    code: "",
  },
  {
    id: "majorSector",
    label: "Большой сектор",
    icon: "◕",
    hint: "Укажите центр и две точки; угол будет больше 180°",
    shortcut: "4",
    code: "",
  },
  {
    id: "circularSegment",
    label: "Сегмент окружности",
    icon: "◒",
    hint: "Укажите центр и концы хорды",
    shortcut: "5",
    code: "",
  },
  {
    id: "polygon",
    label: "Многоугольник",
    icon: "⬠",
    hint: "Выбирайте вершины; кликните по выбранной точке, чтобы замкнуть",
    shortcut: "G",
    code: "KeyG",
  },
  {
    id: "regularPolygon",
    label: "Правильный многоугольник",
    icon: "⬡",
    hint: "Задайте вершины по порядку и замкните выбранной точкой",
    shortcut: "2",
    code: "",
  },
  {
    id: "triangle",
    label: "Произвольный треугольник",
    icon: "△",
    hint: "Выберите три вершины",
    shortcut: "1",
    code: "",
  },
  {
    id: "rightTriangle",
    label: "Прямоугольный треугольник",
    icon: "◺",
    hint: "Сначала вершина прямого угла, затем две остальные",
    shortcut: "2",
    code: "",
  },
  {
    id: "isoscelesTriangle",
    label: "Равнобедренный треугольник",
    icon: "△",
    hint: "Сначала вершина, затем две точки основания",
    shortcut: "3",
    code: "",
  },
  {
    id: "equilateralTriangle",
    label: "Равносторонний треугольник",
    icon: "△",
    hint: "Выберите три вершины",
    shortcut: "4",
    code: "",
  },
  {
    id: "square",
    label: "Квадрат",
    icon: "□",
    hint: "Выберите четыре вершины по порядку",
    shortcut: "1",
    code: "",
  },
  {
    id: "rectangle",
    label: "Прямоугольник",
    icon: "▭",
    hint: "Выберите четыре вершины по порядку",
    shortcut: "2",
    code: "",
  },
  {
    id: "parallelogram",
    label: "Параллелограмм",
    icon: "▱",
    hint: "Выберите четыре вершины по порядку",
    shortcut: "3",
    code: "",
  },
  {
    id: "trapezoid",
    label: "Трапеция",
    icon: "⏢",
    hint: "Сначала выберите основание, затем второе основание",
    shortcut: "4",
    code: "",
  },
  {
    id: "rhombus",
    label: "Ромб",
    icon: "◇",
    hint: "Выберите четыре вершины по порядку",
    shortcut: "5",
    code: "",
  },
  {
    id: "length",
    label: "Измерить длину",
    icon: "↔",
    hint: "Выберите две существующие точки; тяните поле для перемещения",
    shortcut: "D",
    code: "KeyD",
  },
  {
    id: "angle",
    label: "Измерить угол",
    icon: "∠",
    hint: "Выберите три существующие точки; тяните поле для перемещения",
    shortcut: "A",
    code: "KeyA",
  },
  {
    id: "area",
    label: "Измерить площадь",
    icon: "S",
    hint: "Выбирайте существующие вершины; тяните поле для перемещения",
    shortcut: "Q",
    code: "KeyQ",
  },
];

type ToolGroupId =
  | "circles"
  | "polygons"
  | "triangles"
  | "quadrilaterals";
const TOOL_GROUPS: {
  id: ToolGroupId;
  label: string;
  icon: string;
  shortcut: string;
  code: string;
  toolIds: ToolId[];
}[] = [
  {
    id: "circles",
    label: "Окружности",
    icon: "○",
    shortcut: "C",
    code: "KeyC",
    toolIds: [
      "circle",
      "ellipse",
      "sector",
      "majorSector",
      "circularSegment",
    ],
  },
  {
    id: "polygons",
    label: "Многоугольники",
    icon: "⬠",
    shortcut: "G",
    code: "KeyG",
    toolIds: ["polygon", "regularPolygon"],
  },
  {
    id: "triangles",
    label: "Треугольники",
    icon: "△",
    shortcut: "T",
    code: "KeyT",
    toolIds: [
      "triangle",
      "rightTriangle",
      "isoscelesTriangle",
      "equilateralTriangle",
    ],
  },
  {
    id: "quadrilaterals",
    label: "Четырёхугольники",
    icon: "□",
    shortcut: "4",
    code: "Digit4",
    toolIds: [
      "square",
      "rectangle",
      "parallelogram",
      "trapezoid",
      "rhombus",
    ],
  },
];

const TOOL_RAIL_ITEMS: (
  | { kind: "tool"; id: ToolId }
  | { kind: "group"; id: ToolGroupId }
)[] = [
  { kind: "tool", id: "select" },
  { kind: "tool", id: "marquee" },
  { kind: "tool", id: "point" },
  { kind: "tool", id: "pointOnSegment" },
  { kind: "tool", id: "segment" },
  { kind: "tool", id: "line" },
  { kind: "tool", id: "ray" },
  { kind: "group", id: "circles" },
  { kind: "group", id: "polygons" },
  { kind: "group", id: "triangles" },
  { kind: "group", id: "quadrilaterals" },
  { kind: "tool", id: "length" },
  { kind: "tool", id: "angle" },
  { kind: "tool", id: "area" },
];

const trimNumber = (value: number, digits = 2) => {
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
      /\b(?:area|s)\s*\(\s*((?:[A-Za-z]\s*,?\s*){3,})\)/gi,
      (_, ids) =>
        `AREA_${String(ids).replace(/[^A-Za-z]/g, "")}`.toUpperCase(),
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

function parseMathExpression(source: string): MathNode | null {
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
  resolving: Set<string> = new Set(),
): number {
  if (node.kind === "number") return node.value;
  if (node.kind === "variable") {
    if (resolving.has(node.name)) return Number.NaN;
    const value = variables.get(node.name);
    if (!value) return Number.NaN;
    const nextResolving = new Set(resolving);
    nextResolving.add(node.name);
    return evaluateMath(value, map, variables, angleUnit, nextResolving);
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
    return polygonArea(p);
  }
  if (node.kind === "unary") {
    const value = evaluateMath(
      node.value,
      map,
      variables,
      angleUnit,
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
  const left = evaluateMath(node.left, map, variables, angleUnit, resolving);
  const right = evaluateMath(node.right, map, variables, angleUnit, resolving);
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

function parseConstraint(
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

function parseUnknown(expression: string): UnknownTarget | null {
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
    };
  }
  const formula = parseMathExpression(source);
  if (formula) {
    if (formula.kind === "measure" && formula.measure === "area") {
      return {
        kind: "area",
        ids: formula.ids,
        label: source,
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

function normalizeUnknownExpression(expression: string) {
  const trimmed = expression.trim();
  if (!trimmed || /=\s*\?\s*$/.test(trimmed)) return trimmed;
  return parseUnknown(trimmed) ? `${trimmed} = ?` : expression;
}

function pointMap(points: Point[]) {
  return new Map(points.map((point) => [point.id, point]));
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleDegrees(a: Point, b: Point, c: Point) {
  const ux = a.x - b.x;
  const uy = a.y - b.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const denominator = Math.max(Math.hypot(ux, uy) * Math.hypot(vx, vy), 1e-9);
  const cosine = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / denominator));
  return (Math.acos(cosine) * 180) / Math.PI;
}

function resolveArcEnd(
  start: number,
  rawEnd: number,
  arc: "minor" | "major" = "minor",
) {
  let delta = rawEnd - start;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  if (arc === "major") {
    delta += delta >= 0 ? -Math.PI * 2 : Math.PI * 2;
  }
  return start + delta;
}

function isAngleOnArc(start: number, end: number, angle: number) {
  const span = end - start;
  let offset = angle - start;
  if (span >= 0) {
    while (offset < 0) offset += Math.PI * 2;
    while (offset > Math.PI * 2) offset -= Math.PI * 2;
    return offset <= span + 1e-6;
  }
  while (offset > 0) offset -= Math.PI * 2;
  while (offset < -Math.PI * 2) offset += Math.PI * 2;
  return offset >= span - 1e-6;
}

function traceRightAngleMarker(
  context: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  size: number,
) {
  const abLength = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1e-9);
  const cbLength = Math.max(Math.hypot(c.x - b.x, c.y - b.y), 1e-9);
  const ab = {
    x: ((a.x - b.x) / abLength) * size,
    y: ((a.y - b.y) / abLength) * size,
  };
  const cb = {
    x: ((c.x - b.x) / cbLength) * size,
    y: ((c.y - b.y) / cbLength) * size,
  };
  context.beginPath();
  context.moveTo(b.x + ab.x, b.y + ab.y);
  context.lineTo(b.x + ab.x + cb.x, b.y + ab.y + cb.y);
  context.lineTo(b.x + cb.x, b.y + cb.y);
}

function polygonArea(points: Point[]) {
  if (points.length < 3) return 0;
  const doubledArea = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - point.y * next.x;
  }, 0);
  return Math.abs(doubledArea) / 2;
}

function pointToSegmentDistance(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) return distance(point, start);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        lengthSquared,
    ),
  );
  return Math.hypot(
    point.x - (start.x + t * dx),
    point.y - (start.y + t * dy),
  );
}

function orientation(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  const epsilon = 1e-9;
  const within = (value: number, first: number, second: number) =>
    value >= Math.min(first, second) - epsilon &&
    value <= Math.max(first, second) + epsilon;
  if (
    Math.abs(o1) < epsilon &&
    within(c.x, a.x, b.x) &&
    within(c.y, a.y, b.y)
  ) {
    return true;
  }
  if (
    Math.abs(o2) < epsilon &&
    within(d.x, a.x, b.x) &&
    within(d.y, a.y, b.y)
  ) {
    return true;
  }
  if (
    Math.abs(o3) < epsilon &&
    within(a.x, c.x, d.x) &&
    within(a.y, c.y, d.y)
  ) {
    return true;
  }
  if (
    Math.abs(o4) < epsilon &&
    within(b.x, c.x, d.x) &&
    within(b.y, c.y, d.y)
  ) {
    return true;
  }
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function segmentDistance(a: Point, b: Point, c: Point, d: Point) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointToSegmentDistance(a, c, d),
    pointToSegmentDistance(b, c, d),
    pointToSegmentDistance(c, a, b),
    pointToSegmentDistance(d, a, b),
  );
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
  return Math.hypot(cross / Math.max(length, 1), outside);
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
      );
      const right = evaluateMath(
        comparison.right,
        map,
        variables,
        angleUnit,
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
      const left = evaluateMath(equation.left, map, variables, angleUnit);
      const right = evaluateMath(equation.right, map, variables, angleUnit);
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
    const value = evaluateMath(target.formula, map, variables, angleUnit);
    return Number.isFinite(value) ? { value, suffix: "" } : null;
  }
  return { value: polygonArea(p), suffix: " ед²" };
}

function equationText(constraint: ParsedConstraint) {
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
  if (constraint.kind === "onEllipse") {
    return constraint.source ?? `${constraint.ids[0]} ∈ ellipse`;
  }
  return constraint.kind === "parallel"
    ? `${constraint.ids[0]}${constraint.ids[1]} × ${constraint.ids[2]}${constraint.ids[3]} = 0`
    : `${constraint.ids[0]}${constraint.ids[1]} · ${constraint.ids[2]}${constraint.ids[3]} = 0`;
}

function solveNumerically(
  currentPoints: Point[],
  currentShapes: Shape[],
  rows: ExpressionRow[],
  unknownRows: ExpressionRow[],
  tolerance: number,
  angleUnit: AngleUnit,
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
  const search = solveCoordinates(
    currentPoints,
    tolerance,
    (coordinateMap) =>
      constraintRows.map(({ parsed }) =>
        constraintResidual(
          parsed,
          coordinateMap,
          variables,
          angleUnit,
          currentShapes,
        ),
      ),
  );
  const solvedMap = pointMap(search.points);
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
  const values = unknownRows
    .filter((row) => row.enabled)
    .map((row) => parseUnknown(row.expression))
    .filter((target): target is UnknownTarget => Boolean(target))
    .map((target) => {
      const measured = evaluateUnknown(
        target,
        solvedMap,
        variables,
        angleUnit,
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

  return {
    points: search.points,
    result: {
      kind: search.residual < tolerance ? "exact" : "approximate",
      residual: search.residual,
      elapsed: search.elapsed,
      values,
      issues: individualErrors
        .filter((item) => item.error >= tolerance)
        .sort((a, b) => b.error - a.error)
        .slice(0, 3),
    } satisfies SolveResult,
  };
}

function polygonConstraintExpressions(ids: string[], regular = false) {
  if (ids.length < 3) return [];
  const expressions = [`distinct(${ids.join("")})`];
  const edges = ids.map(
    (id, index) => `${id}${ids[(index + 1) % ids.length]}`,
  );
  for (let first = 0; first < edges.length; first += 1) {
    for (let second = first + 1; second < edges.length; second += 1) {
      const adjacent =
        second === first + 1 ||
        (first === 0 && second === edges.length - 1);
      if (!adjacent) {
        expressions.push(`${edges[first]} ∩ ${edges[second]} = ∅`);
      }
    }
  }
  if (regular) {
    expressions.unshift(edges.join(" = "));
    const angles = ids.map((id, index) => {
      const previous = ids[(index - 1 + ids.length) % ids.length];
      const next = ids[(index + 1) % ids.length];
      return `∠${previous}${id}${next}`;
    });
    expressions.unshift(angles.join(" = "));
  }
  return expressions;
}

function quadrilateralConstraintExpressions(
  tool:
    | "square"
    | "rectangle"
    | "parallelogram"
    | "trapezoid"
    | "rhombus",
  ids: string[],
) {
  const [a, b, c, d] = ids;
  const expressions = polygonConstraintExpressions(ids);
  if (tool === "square") {
    expressions.unshift(
      `${a}${b} = ${b}${c} = ${c}${d} = ${d}${a}`,
      `${a}${b} ∥ ${c}${d}`,
      `${b}${c} ∥ ${d}${a}`,
      `∠${d}${a}${b} = 90°`,
    );
  } else if (tool === "rectangle") {
    expressions.unshift(
      `${a}${b} = ${c}${d}`,
      `${b}${c} = ${d}${a}`,
      `${a}${b} ∥ ${c}${d}`,
      `${b}${c} ∥ ${d}${a}`,
      `∠${d}${a}${b} = 90°`,
    );
  } else if (tool === "parallelogram") {
    expressions.unshift(
      `${a}${b} = ${c}${d}`,
      `${b}${c} = ${d}${a}`,
      `${a}${b} ∥ ${c}${d}`,
      `${b}${c} ∥ ${d}${a}`,
    );
  } else if (tool === "trapezoid") {
    expressions.unshift(`${a}${b} ∥ ${c}${d}`);
  } else {
    expressions.unshift(
      `${a}${b} = ${b}${c} = ${c}${d} = ${d}${a}`,
      `${a}${b} ∥ ${c}${d}`,
      `${b}${c} ∥ ${d}${a}`,
    );
  }
  return expressions;
}

function nextPointId(points: Point[]) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const used = new Set(points.map((point) => point.id));
  const freeLetter = [...alphabet].find((letter) => !used.has(letter));
  if (freeLetter) return freeLetter;
  let index = points.length + 1;
  while (used.has(`P${index}`)) index += 1;
  return `P${index}`;
}

function projectPointToSegment(
  point: Point,
  start: Point,
  end: Point,
  mode: "segment" | "line" | "ray" = "segment",
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = Math.max(dx * dx + dy * dy, 1e-9);
  const rawT =
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  const t =
    mode === "line"
      ? rawT
      : mode === "ray"
        ? Math.max(0, rawT)
        : Math.max(0, Math.min(1, rawT));
  return {
    id: point.id,
    x: start.x + dx * t,
    y: start.y + dy * t,
    t,
  };
}

function projectPointToCircle(
  point: Point,
  center: Point,
  radiusPoint: Point,
) {
  const radius = Math.max(distance(center, radiusPoint), 1e-9);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const length = Math.hypot(dx, dy);
  const directionX =
    length < 1e-9 ? (radiusPoint.x - center.x) / radius : dx / length;
  const directionY =
    length < 1e-9 ? (radiusPoint.y - center.y) / radius : dy / length;
  return {
    id: point.id,
    x: center.x + directionX * radius,
    y: center.y + directionY * radius,
    angle: Math.atan2(directionY, directionX),
  };
}

function pointOnEllipse(
  center: Point,
  firstAxis: Point,
  secondAxis: Point,
  angle: number,
  id = "",
) {
  const radiusX = Math.max(distance(center, firstAxis), 1e-9);
  const radiusY = Math.max(distance(center, secondAxis), 1e-9);
  const rotation = Math.atan2(
    firstAxis.y - center.y,
    firstAxis.x - center.x,
  );
  const localX = Math.cos(angle) * radiusX;
  const localY = Math.sin(angle) * radiusY;
  return {
    id,
    x:
      center.x +
      localX * Math.cos(rotation) -
      localY * Math.sin(rotation),
    y:
      center.y +
      localX * Math.sin(rotation) +
      localY * Math.cos(rotation),
    angle,
  };
}

function projectPointToEllipse(
  point: Point,
  center: Point,
  firstAxis: Point,
  secondAxis: Point,
) {
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
  const angle = Math.atan2(localY / radiusY, localX / radiusX);
  return pointOnEllipse(center, firstAxis, secondAxis, angle, point.id);
}

function cloneSnapshot(snapshot: DrawingSnapshot): DrawingSnapshot {
  return {
    points: snapshot.points.map((point) => ({ ...point })),
    shapes: snapshot.shapes.map((shape) => ({
      ...shape,
      points: [...shape.points],
    })),
    measurements: snapshot.measurements.map((measurement) => ({
      ...measurement,
      points: [...measurement.points],
    })),
    known: snapshot.known.map((row) => ({ ...row })),
    unknown: snapshot.unknown.map((row) => ({ ...row })),
  };
}

function snapshotKey(snapshot: DrawingSnapshot) {
  return JSON.stringify(snapshot);
}

function renamePointInExpression(
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

function deletedReferenceMessage(
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

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const importDragDepthRef = useRef(0);
  const [projectTitle, setProjectTitle] = useState(DEFAULT_PROJECT_TITLE);
  const [points, setPoints] = useState<Point[]>(INITIAL_POINTS);
  const [shapes, setShapes] = useState<Shape[]>(INITIAL_SHAPES);
  const [measurements, setMeasurements] =
    useState<Measurement[]>(INITIAL_MEASUREMENTS);
  const [known, setKnown] = useState<ExpressionRow[]>(INITIAL_KNOWN);
  const [unknown, setUnknown] =
    useState<ExpressionRow[]>(INITIAL_UNKNOWN);
  const [activeTool, setActiveTool] = useState<ToolId>("select");
  const [openToolGroup, setOpenToolGroup] =
    useState<ToolGroupId | null>(null);
  const [toolGroupIndex, setToolGroupIndex] = useState(0);
  const [pendingPoints, setPendingPoints] = useState<string[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null);
  const [selectedPoints, setSelectedPoints] = useState<string[]>([]);
  const [renameValue, setRenameValue] = useState("");
  const [drag, setDrag] = useState<
    | { type: "point"; id: string }
    | {
        type: "group";
        ids: string[];
        start: { x: number; y: number };
        origins: { id: string; x: number; y: number }[];
      }
    | {
        type: "marquee";
        startX: number;
        startY: number;
        currentX: number;
        currentY: number;
      }
    | {
        type: "measurementPan";
        hit: string | null;
        startX: number;
        startY: number;
        originX: number;
        originY: number;
        moved: boolean;
      }
    | { type: "pan"; startX: number; startY: number; originX: number; originY: number }
    | null
  >(null);
  const [view, setView] = useState({ x: 35, y: 34, scale: 74 });
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 700 });
  const [result, setResult] = useState<SolveResult>(PENDING_RESULT);
  const [solving, setSolving] = useState(false);
  const [solverEpsilonInput, setSolverEpsilonInput] = useState(
    DEFAULT_SOLVER_EPSILON_INPUT,
  );
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [mobilePanel, setMobilePanel] = useState<
    "canvas" | "conditions" | "solver"
  >("canvas");
  const [locale, setLocale] = useState<Locale>("ru");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showCongruenceMarks, setShowCongruenceMarks] = useState(true);
  const [showAngles, setShowAngles] = useState(true);
  const [showToolHint, setShowToolHint] = useState(true);
  const [bareAngleUnit, setBareAngleUnit] =
    useState<AngleUnit>("degrees");
  const [decimalDigits, setDecimalDigits] = useState(
    DEFAULT_DECIMAL_DIGITS,
  );
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [importDragActive, setImportDragActive] = useState(false);
  const [addMenu, setAddMenu] = useState<"known" | "unknown" | null>(null);
  const [draggedExpression, setDraggedExpression] = useState<{
    group: "known" | "unknown";
    id: number;
  } | null>(null);
  const draggedExpressionRef = useRef<{
    group: "known" | "unknown";
    id: number;
  } | null>(null);
  const expressionDragCleanupRef = useRef<(() => void) | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [canvasNotice, setCanvasNotice] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const historyTimerRef = useRef<number | null>(null);
  const historyReadyRef = useRef(false);
  const storageKeyRef = useRef<string | null>(null);
  const expressionIdRef = useRef(0);
  const historyRef = useRef<HistoryState>({
    past: [],
    present: cloneSnapshot({
      points: INITIAL_POINTS,
      shapes: INITIAL_SHAPES,
      measurements: INITIAL_MEASUREMENTS,
      known: INITIAL_KNOWN,
      unknown: INITIAL_UNKNOWN,
    }),
    future: [],
  });

  useEffect(
    () => () => expressionDragCleanupRef.current?.(),
    [],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const parsedKnown = useMemo(
    () =>
      known
        .filter((row) => row.enabled)
        .map((row) => ({
          ...row,
          parsed: parseConstraint(row.expression, bareAngleUnit),
        })),
    [bareAngleUnit, known],
  );
  const objectMemberships = useMemo(
    () =>
      parsedKnown
        .map((row) => row.parsed)
        .filter(
          (constraint): constraint is ParsedConstraint =>
            constraint?.kind === "onSegment" ||
            constraint?.kind === "onLine" ||
            constraint?.kind === "onRay" ||
            constraint?.kind === "onCircle" ||
            constraint?.kind === "onEllipse",
        ),
    [parsedKnown],
  );
  const equalSideMarks = useMemo(() => {
    const sideKey = (ids: string[]) =>
      ids.length === 2 ? [...ids].sort().join("|") : null;
    const distanceSide = (node: MathNode) =>
      node.kind === "measure" && node.measure === "distance"
        ? sideKey(node.ids)
        : null;
    const drawableSides = new Map<string, [string, string]>();
    const visibleObjectGroups = new Map<string, Set<string>>();
    const indexVisibleGroup = (group: Set<string>) => {
      const ids = [...group];
      for (let first = 0; first < ids.length; first += 1) {
        for (let second = first + 1; second < ids.length; second += 1) {
          const pair = [ids[first], ids[second]] as [string, string];
          const key = sideKey(pair);
          if (!key) continue;
          visibleObjectGroups.set(key, group);
          drawableSides.set(key, pair);
        }
      }
    };
    const registerVisibleObject = (ids: [string, string]) => {
      const key = sideKey(ids);
      if (!key) return;
      const group = visibleObjectGroups.get(key) ?? new Set<string>();
      ids.forEach((id) => group.add(id));
      indexVisibleGroup(group);
    };

    shapes.forEach((shape) => {
      if (
        (shape.type === "segment" ||
          shape.type === "line" ||
          shape.type === "ray") &&
        shape.points.length >= 2
      ) {
        registerVisibleObject([shape.points[0], shape.points[1]]);
      }
      if (shape.type === "polygon" && shape.points.length >= 3) {
        shape.points.forEach((id, index) => {
          registerVisibleObject([
            id,
            shape.points[(index + 1) % shape.points.length],
          ]);
        });
      }
      if (shape.type === "sector" && shape.points.length >= 3) {
        registerVisibleObject([shape.points[0], shape.points[1]]);
        registerVisibleObject([shape.points[0], shape.points[2]]);
      }
    });

    const memberships = parsedKnown
      .map(({ parsed }) => parsed)
      .filter(
        (parsed): parsed is ParsedConstraint =>
          parsed?.kind === "onSegment" ||
          parsed?.kind === "onLine" ||
          parsed?.kind === "onRay",
      );
    let expanded = true;
    for (
      let pass = 0;
      expanded && pass <= memberships.length;
      pass += 1
    ) {
      expanded = false;
      memberships.forEach((membership) => {
        const baseKey = sideKey(membership.ids.slice(1, 3));
        const group = baseKey ? visibleObjectGroups.get(baseKey) : null;
        const pointId = membership.ids[0];
        if (!group || group.has(pointId)) return;
        group.add(pointId);
        indexVisibleGroup(group);
        expanded = true;
      });
    }

    const parent = new Map<string, string>();
    const find = (key: string): string => {
      const current = parent.get(key);
      if (!current) {
        parent.set(key, key);
        return key;
      }
      if (current === key) return key;
      const root = find(current);
      parent.set(key, root);
      return root;
    };
    const unite = (first: string, second: string) => {
      const firstRoot = find(first);
      const secondRoot = find(second);
      if (firstRoot !== secondRoot) parent.set(secondRoot, firstRoot);
    };

    parsedKnown.forEach(({ parsed }) => {
      if (parsed?.kind !== "formula" || !parsed.formula) return;
      (parsed.formulas ?? [parsed.formula]).forEach((equation) => {
        const left = distanceSide(equation.left);
        const right = distanceSide(equation.right);
        if (left && right) unite(left, right);
      });
    });

    const groups = new Map<string, string[]>();
    parent.forEach((_, key) => {
      if (!drawableSides.has(key)) return;
      const root = find(key);
      const group = groups.get(root) ?? [];
      if (!group.includes(key)) group.push(key);
      groups.set(root, group);
    });

    return [...groups.values()]
      .filter((group) => group.length >= 2)
      .map((group) => group.sort())
      .sort((first, second) => first.join().localeCompare(second.join()))
      .flatMap((group, index) =>
        group.map((key) => ({
          ids: drawableSides.get(key) as [string, string],
          count: index + 1,
        })),
      );
  }, [parsedKnown, shapes]);

  const tools = useMemo(() => localizeTools(TOOLS, locale), [locale]);
  const toolGroups = useMemo(
    () => localizeToolGroups(TOOL_GROUPS, locale),
    [locale],
  );
  const activeToolInfo =
    tools.find((tool) => tool.id === activeTool) ?? tools[0];
  const t = useCallback(
    (russian: string, english: string) =>
      localText(locale, russian, english),
    [locale],
  );
  const solverEpsilon = useMemo(
    () => parseSolverEpsilon(solverEpsilonInput),
    [solverEpsilonInput],
  );
  const solverEpsilonValid = useMemo(() => {
    const parsed = Number(solverEpsilonInput.trim().replace(",", "."));
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 1;
  }, [solverEpsilonInput]);
  const formatNumber = useCallback(
    (value: number) => trimNumber(value, decimalDigits),
    [decimalDigits],
  );
  const selectedPointData =
    points.find((point) => point.id === selectedPoint) ?? null;
  const measurementReadings = useMemo(() => {
    const map = pointMap(points);
    return measurements.map((measurement) => {
      const measuredPoints = measurement.points
        .map((id) => map.get(id))
        .filter((point): point is Point => Boolean(point));
      const value =
        measurement.kind === "distance" && measuredPoints.length === 2
          ? formatNumber(distance(measuredPoints[0], measuredPoints[1]))
          : measurement.kind === "angle" && measuredPoints.length === 3
            ? `${formatNumber(
                angleDegrees(
                  measuredPoints[0],
                  measuredPoints[1],
                  measuredPoints[2],
                ),
              )}°`
            : measurement.kind === "area" && measuredPoints.length >= 3
              ? `${formatNumber(polygonArea(measuredPoints))} ${t("ед²", "units²")}`
            : "—";
      return {
        ...measurement,
        label:
          measurement.kind === "distance"
            ? measurement.points.join("")
            : measurement.kind === "angle"
              ? `∠${measurement.points.join("")}`
              : `S(${measurement.points.join("")})`,
        value,
      };
    });
  }, [formatNumber, measurements, points, t]);

  const captureSnapshot = useCallback(
    () => cloneSnapshot({ points, shapes, measurements, known, unknown }),
    [known, measurements, points, shapes, unknown],
  );

  const markDirty = useCallback(() => {
    setResult((current) =>
      current.kind === "dirty" ? current : PENDING_RESULT,
    );
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        setTheme(
          document.documentElement.dataset.theme === "dark"
            ? "dark"
            : "light",
        ),
      0,
    );
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.locale === "ru" || parsed.locale === "en") {
            setLocale(parsed.locale);
          }
          if (typeof parsed.showCongruenceMarks === "boolean") {
            setShowCongruenceMarks(parsed.showCongruenceMarks);
          }
          if (typeof parsed.showAngles === "boolean") {
            setShowAngles(parsed.showAngles);
          }
          if (typeof parsed.showToolHint === "boolean") {
            setShowToolHint(parsed.showToolHint);
          }
          if (
            parsed.bareAngleUnit === "degrees" ||
            parsed.bareAngleUnit === "radians"
          ) {
            setBareAngleUnit(parsed.bareAngleUnit);
          }
          if (
            Number.isInteger(parsed.decimalDigits) &&
            parsed.decimalDigits >= 0 &&
            parsed.decimalDigits <= 8
          ) {
            setDecimalDigits(parsed.decimalDigits);
          }
        }
      } catch {
        // Invalid or unavailable browser storage should not block the editor.
      } finally {
        setSettingsHydrated(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!settingsHydrated) return;
    try {
      localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify({
          locale,
          showCongruenceMarks,
          showAngles,
          showToolHint,
          bareAngleUnit,
          decimalDigits,
        }),
      );
    } catch {
      // Settings still work for the current page without browser storage.
    }
  }, [
    bareAngleUnit,
    decimalDigits,
    locale,
    settingsHydrated,
    showAngles,
    showCongruenceMarks,
    showToolHint,
  ]);

  const selectTheme = (nextTheme: "light" | "dark") => {
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    try {
      localStorage.setItem("geosolver-theme", nextTheme);
    } catch {
      // The theme still works for the current page without browser storage.
    }
  };

  useEffect(() => {
    let disposed = false;
    let timer: number | null = null;
    let channel: BroadcastChannel | null = null;
    let occupied = false;
    const makeId = () =>
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const instanceId = makeId();
    let workspaceId =
      sessionStorage.getItem("geosolver-workspace-v2") ?? makeId();

    const loadWorkspace = () => {
      if (disposed) return;
      if (occupied) workspaceId = makeId();

      let loaded = cloneSnapshot({
        points: INITIAL_POINTS,
        shapes: INITIAL_SHAPES,
        measurements: INITIAL_MEASUREMENTS,
        known: INITIAL_KNOWN,
        unknown: INITIAL_UNKNOWN,
      });
      let loadedProjectTitle = DEFAULT_PROJECT_TITLE;
      let loadedSolverEpsilon = DEFAULT_SOLVER_EPSILON_INPUT;

      try {
        sessionStorage.setItem("geosolver-workspace-v2", workspaceId);
        const storageKey = `geosolver-drawing-v2:${workspaceId}`;
        storageKeyRef.current = storageKey;
        let saved = localStorage.getItem(storageKey);

        // Migrate the old shared draft once. Every later tab starts independently.
        if (
          !saved &&
          localStorage.getItem("geosolver-storage-migrated-v2") !== "1"
        ) {
          saved = localStorage.getItem("geosolver-drawing-v1");
          localStorage.setItem("geosolver-storage-migrated-v2", "1");
        }

        if (saved) {
          const data = JSON.parse(saved);
          loaded = {
            points: Array.isArray(data.points) ? data.points : loaded.points,
            shapes: Array.isArray(data.shapes) ? data.shapes : loaded.shapes,
            measurements: Array.isArray(data.measurements)
              ? data.measurements
              : loaded.measurements,
            known: Array.isArray(data.known) ? data.known : loaded.known,
            unknown: Array.isArray(data.unknown)
              ? data.unknown
              : loaded.unknown,
          };
          if (typeof data.projectTitle === "string" && data.projectTitle.trim()) {
            loadedProjectTitle = data.projectTitle.trim().slice(0, 80);
          }
          if (
            (typeof data.solverEpsilon === "string" ||
              typeof data.solverEpsilon === "number") &&
            parseSolverEpsilon(data.solverEpsilon) ===
              Number(String(data.solverEpsilon).replace(",", "."))
          ) {
            loadedSolverEpsilon = String(data.solverEpsilon);
          }
        }
      } catch {
        // A damaged or unavailable local draft should never block the app.
      }

      setPoints(loaded.points);
      setShapes(loaded.shapes);
      setMeasurements(loaded.measurements);
      setKnown(loaded.known);
      setUnknown(loaded.unknown);
      setProjectTitle(loadedProjectTitle);
      setSolverEpsilonInput(loadedSolverEpsilon);
      setResult(PENDING_RESULT);
      historyRef.current = {
        past: [],
        present: cloneSnapshot(loaded),
        future: [],
      };
      historyReadyRef.current = true;
      setHydrated(true);
    };

    if ("BroadcastChannel" in window) {
      channel = new BroadcastChannel("geosolver-tabs-v2");
      channel.onmessage = (event) => {
        const message = event.data;
        if (
          message?.type === "probe" &&
          message.workspaceId === workspaceId &&
          message.instanceId !== instanceId
        ) {
          channel?.postMessage({
            type: "occupied",
            workspaceId,
            targetInstanceId: message.instanceId,
          });
        }
        if (
          message?.type === "occupied" &&
          message.workspaceId === workspaceId &&
          message.targetInstanceId === instanceId
        ) {
          occupied = true;
        }
      };
      channel.postMessage({ type: "probe", workspaceId, instanceId });
      timer = window.setTimeout(loadWorkspace, 80);
    } else {
      loadWorkspace();
    }

    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
      channel?.close();
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !historyReadyRef.current) return;
    const current = captureSnapshot();
    if (snapshotKey(current) === snapshotKey(historyRef.current.present)) return;
    if (historyTimerRef.current !== null) {
      window.clearTimeout(historyTimerRef.current);
    }
    setHistoryVersion((version) => version + 1);
    historyTimerRef.current = window.setTimeout(() => {
      const history = historyRef.current;
      const latest = captureSnapshot();
      if (snapshotKey(latest) === snapshotKey(history.present)) return;
      history.past.push(cloneSnapshot(history.present));
      if (history.past.length > 80) history.past.shift();
      history.present = cloneSnapshot(latest);
      history.future = [];
      historyTimerRef.current = null;
      setHistoryVersion((version) => version + 1);
    }, 220);
    return () => {
      if (historyTimerRef.current !== null) {
        window.clearTimeout(historyTimerRef.current);
        historyTimerRef.current = null;
      }
    };
  }, [captureSnapshot, hydrated]);

  useEffect(() => {
    if (!hydrated || !storageKeyRef.current) return;
    try {
      localStorage.setItem(
        storageKeyRef.current,
        JSON.stringify({
          points,
          shapes,
          measurements,
          known,
          unknown,
          projectTitle,
          solverEpsilon: solverEpsilonInput,
        }),
      );
    } catch {
      // The editor remains usable if browser storage is unavailable.
    }
  }, [
    hydrated,
    known,
    measurements,
    points,
    projectTitle,
    shapes,
    solverEpsilonInput,
    unknown,
  ]);

  const applySnapshot = useCallback((snapshot: DrawingSnapshot) => {
    const next = cloneSnapshot(snapshot);
    setPoints(next.points);
    setShapes(next.shapes);
    setMeasurements(next.measurements);
    setKnown(next.known);
    setUnknown(next.unknown);
    setSelectedPoint(null);
    setSelectedPoints([]);
    setPendingPoints([]);
    setResult(PENDING_RESULT);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setRenameValue(selectedPoint ?? ""),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [selectedPoint]);

  const undo = useCallback(() => {
    if (!historyReadyRef.current) return;
    if (historyTimerRef.current !== null) {
      window.clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    }
    const history = historyRef.current;
    const current = captureSnapshot();
    if (snapshotKey(current) !== snapshotKey(history.present)) {
      history.past.push(cloneSnapshot(history.present));
      history.present = cloneSnapshot(current);
      history.future = [];
    }
    const previous = history.past.pop();
    if (!previous) return;
    history.future.push(cloneSnapshot(history.present));
    history.present = cloneSnapshot(previous);
    applySnapshot(previous);
    setHistoryVersion((version) => version + 1);
  }, [applySnapshot, captureSnapshot]);

  const redo = useCallback(() => {
    if (!historyReadyRef.current) return;
    if (historyTimerRef.current !== null) {
      window.clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    }
    const history = historyRef.current;
    const current = captureSnapshot();
    if (snapshotKey(current) !== snapshotKey(history.present)) {
      history.past.push(cloneSnapshot(history.present));
      history.present = cloneSnapshot(current);
      history.future = [];
      setHistoryVersion((version) => version + 1);
      return;
    }
    const next = history.future.pop();
    if (!next) return;
    history.past.push(cloneSnapshot(history.present));
    history.present = cloneSnapshot(next);
    applySnapshot(next);
    setHistoryVersion((version) => version + 1);
  }, [applySnapshot, captureSnapshot]);

  void historyVersion;
  /* eslint-disable react-hooks/refs -- History is intentionally stored outside
     React state; historyVersion invalidates these read-only availability flags. */
  const canUndo =
    historyRef.current.past.length > 0 ||
    snapshotKey(captureSnapshot()) !== snapshotKey(historyRef.current.present);
  const canRedo = historyRef.current.future.length > 0;
  /* eslint-enable react-hooks/refs */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(320, entry.contentRect.width);
      const height = Math.max(320, entry.contentRect.height);
      setCanvasSize({ width, height });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const worldToScreen = useCallback(
    (point: Point) => ({
      x: canvasSize.width / 2 + view.x + point.x * view.scale,
      y: canvasSize.height / 2 + view.y - point.y * view.scale,
    }),
    [canvasSize, view],
  );

  const screenToWorld = useCallback(
    (x: number, y: number) => ({
      x: (x - canvasSize.width / 2 - view.x) / view.scale,
      y: -(y - canvasSize.height / 2 - view.y) / view.scale,
    }),
    [canvasSize, view],
  );

  const findPointAt = useCallback(
    (x: number, y: number) => {
      let closest: { id: string; distance: number } | null = null;
      points.forEach((point) => {
        const screen = worldToScreen(point);
        const hitDistance = Math.hypot(screen.x - x, screen.y - y);
        if (hitDistance <= 13 && (!closest || hitDistance < closest.distance)) {
          closest = { id: point.id, distance: hitDistance };
        }
      });
      return closest ? (closest as { id: string }).id : null;
    },
    [points, worldToScreen],
  );

  const findObjectAt = useCallback(
    (x: number, y: number) => {
      const map = pointMap(points);
      let closest:
        | {
            startId: string;
            endId: string;
            thirdId?: string;
            point: Point;
            distance: number;
            constraintKind:
              | "onSegment"
              | "onLine"
              | "onRay"
              | "onCircle"
              | "onEllipse";
            objectName: string;
          }
        | null = null;
      shapes.forEach((shape) => {
        if (shape.type === "ellipse") {
          const center = map.get(shape.points[0]);
          const firstAxis = map.get(shape.points[1]);
          const secondAxis = map.get(shape.points[2]);
          if (!center || !firstAxis || !secondAxis) return;
          const centerScreen = worldToScreen(center);
          const firstScreen = worldToScreen(firstAxis);
          const secondScreen = worldToScreen(secondAxis);
          const radiusX = Math.max(
            1,
            Math.hypot(
              firstScreen.x - centerScreen.x,
              firstScreen.y - centerScreen.y,
            ),
          );
          const radiusY = Math.max(
            1,
            Math.hypot(
              secondScreen.x - centerScreen.x,
              secondScreen.y - centerScreen.y,
            ),
          );
          const rotation = Math.atan2(
            firstScreen.y - centerScreen.y,
            firstScreen.x - centerScreen.x,
          );
          const dx = x - centerScreen.x;
          const dy = y - centerScreen.y;
          const localX =
            dx * Math.cos(rotation) + dy * Math.sin(rotation);
          const localY =
            -dx * Math.sin(rotation) + dy * Math.cos(rotation);
          const angle = Math.atan2(localY / radiusY, localX / radiusX);
          const projectedLocalX = Math.cos(angle) * radiusX;
          const projectedLocalY = Math.sin(angle) * radiusY;
          const projectedX =
            centerScreen.x +
            projectedLocalX * Math.cos(rotation) -
            projectedLocalY * Math.sin(rotation);
          const projectedY =
            centerScreen.y +
            projectedLocalX * Math.sin(rotation) +
            projectedLocalY * Math.cos(rotation);
          const hitDistance = Math.hypot(
            x - projectedX,
            y - projectedY,
          );
          if (
            hitDistance <= 18 &&
            (!closest || hitDistance < closest.distance)
          ) {
            closest = {
              startId: center.id,
              endId: firstAxis.id,
              thirdId: secondAxis.id,
              point: {
                id: "",
                ...screenToWorld(projectedX, projectedY),
              },
              distance: hitDistance,
              constraintKind: "onEllipse",
              objectName: `ellipse(${center.id}${firstAxis.id}${secondAxis.id})`,
            };
          }
          return;
        }
        if (
          shape.type === "circle" ||
          shape.type === "sector" ||
          shape.type === "circularSegment"
        ) {
          const center = map.get(shape.points[0]);
          const radiusPoint = map.get(shape.points[1]);
          if (!center || !radiusPoint) return;
          const centerScreen = worldToScreen(center);
          const radiusScreen = worldToScreen(radiusPoint);
          const radius = Math.hypot(
            radiusScreen.x - centerScreen.x,
            radiusScreen.y - centerScreen.y,
          );
          const hitDistance = Math.abs(
            Math.hypot(x - centerScreen.x, y - centerScreen.y) - radius,
          );
          const arcHit =
            shape.type === "circle" ||
            (() => {
              const secondRadiusPoint = map.get(shape.points[2]);
              if (!secondRadiusPoint) return false;
              const secondRadiusScreen = worldToScreen(secondRadiusPoint);
              const start = Math.atan2(
                radiusScreen.y - centerScreen.y,
                radiusScreen.x - centerScreen.x,
              );
              const rawEnd = Math.atan2(
                secondRadiusScreen.y - centerScreen.y,
                secondRadiusScreen.x - centerScreen.x,
              );
              const end = resolveArcEnd(start, rawEnd, shape.arc);
              const pointerAngle = Math.atan2(
                y - centerScreen.y,
                x - centerScreen.x,
              );
              return isAngleOnArc(start, end, pointerAngle);
            })();
          if (
            arcHit &&
            hitDistance <= 18 &&
            (!closest || hitDistance < closest.distance)
          ) {
            closest = {
              startId: center.id,
              endId: radiusPoint.id,
              point: projectPointToCircle(
                { id: "", ...screenToWorld(x, y) },
                center,
                radiusPoint,
              ),
              distance: hitDistance,
              constraintKind: "onCircle",
              objectName: `circle(${center.id}${radiusPoint.id})`,
            };
          }
          if (shape.type === "circle") return;
        }
        if (
          shape.type !== "segment" &&
          shape.type !== "polygon" &&
          shape.type !== "line" &&
          shape.type !== "ray" &&
          shape.type !== "sector" &&
          shape.type !== "circularSegment"
        ) {
          return;
        }
        const edges: [string, string][] =
          shape.type === "polygon"
            ? shape.points.map((id, index) => [
                id,
                shape.points[(index + 1) % shape.points.length],
              ])
            : shape.type === "sector"
              ? [
                  [shape.points[0], shape.points[1]],
                  [shape.points[0], shape.points[2]],
                ]
              : shape.type === "circularSegment"
                ? [[shape.points[1], shape.points[2]]]
                : [[shape.points[0], shape.points[1]]];
        edges.forEach(([startId, endId]) => {
          const start = map.get(startId);
          const end = map.get(endId);
          if (!start || !end) return;
          const startScreen = worldToScreen(start);
          const endScreen = worldToScreen(end);
          const dx = endScreen.x - startScreen.x;
          const dy = endScreen.y - startScreen.y;
          const lengthSquared = Math.max(dx * dx + dy * dy, 1e-9);
          const rawT =
            ((x - startScreen.x) * dx + (y - startScreen.y) * dy) /
            lengthSquared;
          const mode =
            shape.type === "line"
              ? "line"
              : shape.type === "ray"
                ? "ray"
                : "segment";
          const t =
            mode === "line"
              ? rawT
              : mode === "ray"
                ? Math.max(0, rawT)
                : Math.max(0, Math.min(1, rawT));
          const projectedX = startScreen.x + dx * t;
          const projectedY = startScreen.y + dy * t;
          const hitDistance = Math.hypot(x - projectedX, y - projectedY);
          if (
            hitDistance <= 18 &&
            (!closest || hitDistance < closest.distance)
          ) {
            closest = {
              startId,
              endId,
              point: {
                id: "",
                x: start.x + (end.x - start.x) * t,
                y: start.y + (end.y - start.y) * t,
              },
              distance: hitDistance,
              constraintKind:
                mode === "line"
                  ? "onLine"
                  : mode === "ray"
                    ? "onRay"
                    : "onSegment",
              objectName:
                mode === "line"
                  ? `line(${startId}${endId})`
                  : mode === "ray"
                    ? `ray(${startId}${endId})`
                    : `${startId}${endId}`,
            };
          }
        });
      });
      return closest as
        | {
            startId: string;
            endId: string;
            thirdId?: string;
            point: Point;
            distance: number;
            constraintKind:
              | "onSegment"
              | "onLine"
              | "onRay"
              | "onCircle"
              | "onEllipse";
            objectName: string;
          }
        | null;
    },
    [points, screenToWorld, shapes, worldToScreen],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvasSize.width * dpr);
    canvas.height = Math.round(canvasSize.height * dpr);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, canvasSize.width, canvasSize.height);
    const canvasPalette =
      theme === "dark"
        ? {
            grid: "#292e38",
            axis: "#3d4451",
            primary: "#7c89ff",
            label: "#e9ecf3",
            labelBackground: "#20242deb",
            measurementBackground: "#342d20",
            pointFill: "#171a20",
            selectedPoint: "#f4f6fb",
            congruence: "#f2f4f8",
            congruenceHalo: "#14171d",
            resultBackground: "#15382e",
            resultText: "#65d1aa",
          }
        : {
            grid: "#e9eaee",
            axis: "#cfd2d9",
            primary: "#5b6df9",
            label: "#20242d",
            labelBackground: "#ffffffea",
            measurementBackground: "#fff8e8",
            pointFill: "#ffffff",
            selectedPoint: "#151923",
            congruence: "#1f232b",
            congruenceHalo: "#fbfbfc",
            resultBackground: "#e7f7f0",
            resultText: "#168564",
          };

    const originX = canvasSize.width / 2 + view.x;
    const originY = canvasSize.height / 2 + view.y;
    const minor = view.scale;
    const gridStep = minor < 38 ? minor * 2 : minor;
    context.lineWidth = 1;
    for (
      let x = ((originX % gridStep) + gridStep) % gridStep;
      x <= canvasSize.width;
      x += gridStep
    ) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, canvasSize.height);
      context.strokeStyle = canvasPalette.grid;
      context.stroke();
    }
    for (
      let y = ((originY % gridStep) + gridStep) % gridStep;
      y <= canvasSize.height;
      y += gridStep
    ) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvasSize.width, y);
      context.strokeStyle = canvasPalette.grid;
      context.stroke();
    }
    context.strokeStyle = canvasPalette.axis;
    context.beginPath();
    context.moveTo(0, originY);
    context.lineTo(canvasSize.width, originY);
    context.moveTo(originX, 0);
    context.lineTo(originX, canvasSize.height);
    context.stroke();

    const map = pointMap(points);
    shapes.forEach((shape) => {
      const shapePoints = shape.points
        .map((id) => map.get(id))
        .filter((point): point is Point => Boolean(point));
      if (shapePoints.length < 2) return;
      if (
        (shape.type === "ellipse" ||
          shape.type === "sector" ||
          shape.type === "circularSegment") &&
        shapePoints.length < 3
      ) {
        return;
      }
      const screens = shapePoints.map(worldToScreen);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = 2.4;
      context.strokeStyle = shape.color;
      if (shape.type === "polygon" && screens.length >= 3) {
        context.beginPath();
        context.moveTo(screens[0].x, screens[0].y);
        screens.slice(1).forEach((screen) => context.lineTo(screen.x, screen.y));
        context.closePath();
        context.fillStyle = `${shape.color}16`;
        context.fill();
        context.stroke();
      } else if (shape.type === "circle") {
        const radius = Math.hypot(
          screens[1].x - screens[0].x,
          screens[1].y - screens[0].y,
        );
        context.beginPath();
        context.arc(screens[0].x, screens[0].y, radius, 0, Math.PI * 2);
        context.fillStyle = `${shape.color}0b`;
        context.fill();
        context.stroke();
      } else if (shape.type === "ellipse" && screens.length >= 3) {
        const center = screens[0];
        const firstAxis = screens[1];
        const secondAxis = screens[2];
        const radiusX = Math.max(
          1,
          Math.hypot(firstAxis.x - center.x, firstAxis.y - center.y),
        );
        const radiusY = Math.max(
          1,
          Math.hypot(secondAxis.x - center.x, secondAxis.y - center.y),
        );
        const rotation = Math.atan2(
          firstAxis.y - center.y,
          firstAxis.x - center.x,
        );
        context.beginPath();
        context.ellipse(
          center.x,
          center.y,
          radiusX,
          radiusY,
          rotation,
          0,
          Math.PI * 2,
        );
        context.fillStyle = `${shape.color}0b`;
        context.fill();
        context.stroke();
      } else if (
        (shape.type === "sector" ||
          shape.type === "circularSegment") &&
        screens.length >= 3
      ) {
        const center = screens[0];
        const firstRadius = screens[1];
        const secondRadius = screens[2];
        const radius = Math.max(
          1,
          Math.hypot(
            firstRadius.x - center.x,
            firstRadius.y - center.y,
          ),
        );
        const start = Math.atan2(
          firstRadius.y - center.y,
          firstRadius.x - center.x,
        );
        const rawEnd = Math.atan2(
          secondRadius.y - center.y,
          secondRadius.x - center.x,
        );
        const end = resolveArcEnd(start, rawEnd, shape.arc);
        context.beginPath();
        if (shape.type === "sector") {
          context.moveTo(center.x, center.y);
          context.lineTo(firstRadius.x, firstRadius.y);
        } else {
          context.moveTo(firstRadius.x, firstRadius.y);
        }
        context.arc(
          center.x,
          center.y,
          radius,
          start,
          end,
          end < start,
        );
        context.closePath();
        context.fillStyle = `${shape.color}16`;
        context.fill();
        context.stroke();
      } else {
        const start = screens[0];
        const end = screens[1];
        context.beginPath();
        if (shape.type === "line") {
          const dx = end.x - start.x;
          const dy = end.y - start.y;
          const length = Math.max(Math.hypot(dx, dy), 1);
          context.moveTo(
            start.x - (dx / length) * 1800,
            start.y - (dy / length) * 1800,
          );
          context.lineTo(
            end.x + (dx / length) * 1800,
            end.y + (dy / length) * 1800,
          );
        } else if (shape.type === "ray") {
          const dx = end.x - start.x;
          const dy = end.y - start.y;
          const length = Math.max(Math.hypot(dx, dy), 1);
          context.moveTo(start.x, start.y);
          context.lineTo(
            end.x + (dx / length) * 1800,
            end.y + (dy / length) * 1800,
          );
        } else {
          context.moveTo(start.x, start.y);
          context.lineTo(end.x, end.y);
        }
        context.stroke();
      }
    });

    if (showCongruenceMarks) equalSideMarks.forEach((mark) => {
      const first = map.get(mark.ids[0]);
      const second = map.get(mark.ids[1]);
      if (!first || !second) return;
      const start = worldToScreen(first);
      const end = worldToScreen(second);
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);
      if (length < 12 + (mark.count - 1) * 2) return;
      const directionX = dx / length;
      const directionY = dy / length;
      const normalX = -directionY;
      const normalY = directionX;
      const spacing =
        mark.count > 1
          ? Math.min(6, (length - 12) / (mark.count - 1))
          : 0;
      const halfTick = Math.min(6, Math.max(4, length * 0.12));

      const traceTicks = () => {
        context.beginPath();
        for (let index = 0; index < mark.count; index += 1) {
          const offset = (index - (mark.count - 1) / 2) * spacing;
          const centerX = (start.x + end.x) / 2 + directionX * offset;
          const centerY = (start.y + end.y) / 2 + directionY * offset;
          context.moveTo(
            centerX - normalX * halfTick,
            centerY - normalY * halfTick,
          );
          context.lineTo(
            centerX + normalX * halfTick,
            centerY + normalY * halfTick,
          );
        }
      };

      context.lineCap = "round";
      context.setLineDash([]);
      traceTicks();
      context.strokeStyle = canvasPalette.congruenceHalo;
      context.lineWidth = 4.6;
      context.stroke();
      traceTicks();
      context.strokeStyle = canvasPalette.congruence;
      context.lineWidth = 1.9;
      context.stroke();
    });

    if (
      (
        [
          "polygon",
          "regularPolygon",
          "triangle",
          "rightTriangle",
          "isoscelesTriangle",
          "equilateralTriangle",
          "ellipse",
          "sector",
          "majorSector",
          "circularSegment",
          "square",
          "rectangle",
          "parallelogram",
          "trapezoid",
          "rhombus",
          "area",
        ] as ToolId[]
      ).includes(activeTool) &&
      pendingPoints.length >= 2
    ) {
      const pendingScreens = pendingPoints
        .map((id) => map.get(id))
        .filter((point): point is Point => Boolean(point))
        .map(worldToScreen);
      if (pendingScreens.length >= 2) {
        context.beginPath();
        context.moveTo(pendingScreens[0].x, pendingScreens[0].y);
        pendingScreens
          .slice(1)
          .forEach((screen) => context.lineTo(screen.x, screen.y));
        context.strokeStyle = canvasPalette.primary;
        context.lineWidth = 2;
        context.setLineDash([7, 5]);
        context.stroke();
        context.setLineDash([]);
      }
    }

    parsedKnown.forEach((row) => {
      if (!row.parsed) return;
      const itemPoints = row.parsed.ids
        .map((id) => map.get(id))
        .filter((point): point is Point => Boolean(point));
      if (
        row.parsed.kind === "distance" &&
        itemPoints.length === 2
      ) {
        const a = worldToScreen(itemPoints[0]);
        const b = worldToScreen(itemPoints[1]);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.max(Math.hypot(dx, dy), 1);
        const label = formatNumber(row.parsed.value ?? 0);
        context.font = "600 12px ui-monospace, SFMono-Regular, monospace";
        const width = context.measureText(label).width + 14;
        const labelX = midX + (-dy / len) * 18;
        const labelY = midY + (dx / len) * 18;
        context.fillStyle = canvasPalette.labelBackground;
        context.beginPath();
        context.roundRect(labelX - width / 2, labelY - 11, width, 22, 6);
        context.fill();
        context.strokeStyle = `${row.color}55`;
        context.stroke();
        context.fillStyle = row.color;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(label, labelX, labelY + 0.5);
      }
      if (
        showAngles &&
        row.parsed.kind === "angle" &&
        itemPoints.length === 3
      ) {
        const a = worldToScreen(itemPoints[0]);
        const b = worldToScreen(itemPoints[1]);
        const c = worldToScreen(itemPoints[2]);
        const start = Math.atan2(a.y - b.y, a.x - b.x);
        let end = Math.atan2(c.y - b.y, c.x - b.x);
        while (end - start > Math.PI) end -= Math.PI * 2;
        while (end - start < -Math.PI) end += Math.PI * 2;
        const isRightAngle = Math.abs((row.parsed.value ?? 0) - 90) < 0.001;
        if (isRightAngle) {
          traceRightAngleMarker(context, a, b, c, 20);
        } else {
          context.beginPath();
          context.arc(b.x, b.y, 27, start, end, end < start);
        }
        context.strokeStyle = row.color;
        context.lineWidth = 2;
        context.stroke();
        const middle = start + (end - start) / 2;
        context.fillStyle = row.color;
        context.font = "600 11px ui-monospace, SFMono-Regular, monospace";
        context.textAlign = "center";
        context.fillText(
          `${formatNumber(row.parsed.value ?? 0)}°`,
          b.x + Math.cos(middle) * 43,
          b.y + Math.sin(middle) * 43,
        );
      }
      if (
        (row.parsed.kind === "onSegment" ||
          row.parsed.kind === "onLine" ||
          row.parsed.kind === "onRay" ||
          row.parsed.kind === "onCircle" ||
          row.parsed.kind === "onEllipse") &&
        itemPoints.length >= 3
      ) {
        const constrained = worldToScreen(itemPoints[0]);
        context.beginPath();
        context.arc(constrained.x, constrained.y, 10, 0, Math.PI * 2);
        context.strokeStyle = `${row.color}88`;
        context.lineWidth = 1.2;
        context.setLineDash([3, 3]);
        context.stroke();
        context.setLineDash([]);
      }
    });

    measurements.forEach((measurement) => {
      const measuredPoints = measurement.points
        .map((id) => map.get(id))
        .filter((point): point is Point => Boolean(point));
      if (measurement.kind === "distance" && measuredPoints.length === 2) {
        const a = worldToScreen(measuredPoints[0]);
        const b = worldToScreen(measuredPoints[1]);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.max(Math.hypot(dx, dy), 1);
        const x = (a.x + b.x) / 2 + (-dy / length) * 28;
        const y = (a.y + b.y) / 2 + (dx / length) * 28;
        const label = `${measurement.points.join("")} = ${formatNumber(
          distance(measuredPoints[0], measuredPoints[1]),
        )}`;
        context.font = "700 12px ui-monospace, SFMono-Regular, monospace";
        const width = context.measureText(label).width + 18;
        context.fillStyle = canvasPalette.measurementBackground;
        context.beginPath();
        context.roundRect(x - width / 2, y - 12, width, 24, 7);
        context.fill();
        context.strokeStyle = `${measurement.color}88`;
        context.lineWidth = 1.2;
        context.stroke();
        context.fillStyle = measurement.color;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(label, x, y + 0.5);
      }
      if (
        showAngles &&
        measurement.kind === "angle" &&
        measuredPoints.length === 3
      ) {
        const a = worldToScreen(measuredPoints[0]);
        const b = worldToScreen(measuredPoints[1]);
        const c = worldToScreen(measuredPoints[2]);
        const start = Math.atan2(a.y - b.y, a.x - b.x);
        let end = Math.atan2(c.y - b.y, c.x - b.x);
        while (end - start > Math.PI) end -= Math.PI * 2;
        while (end - start < -Math.PI) end += Math.PI * 2;
        const measuredAngle = angleDegrees(
          measuredPoints[0],
          measuredPoints[1],
          measuredPoints[2],
        );
        if (Math.abs(measuredAngle - 90) < 0.5) {
          traceRightAngleMarker(context, a, b, c, 25);
        } else {
          context.beginPath();
          context.arc(b.x, b.y, 36, start, end, end < start);
        }
        context.strokeStyle = measurement.color;
        context.lineWidth = 2.4;
        context.setLineDash([5, 3]);
        context.stroke();
        context.setLineDash([]);
        const middle = start + (end - start) / 2;
        const label = `∠${measurement.points.join("")} = ${formatNumber(
          measuredAngle,
        )}°`;
        context.font = "700 11px ui-monospace, SFMono-Regular, monospace";
        context.fillStyle = measurement.color;
        context.textAlign = "center";
        context.fillText(
          label,
          b.x + Math.cos(middle) * 58,
          b.y + Math.sin(middle) * 58,
        );
      }
      if (measurement.kind === "area" && measuredPoints.length >= 3) {
        const screens = measuredPoints.map(worldToScreen);
        context.beginPath();
        context.moveTo(screens[0].x, screens[0].y);
        screens.slice(1).forEach((screen) => {
          context.lineTo(screen.x, screen.y);
        });
        context.closePath();
        context.fillStyle = `${measurement.color}12`;
        context.fill();
        context.strokeStyle = measurement.color;
        context.lineWidth = 2;
        context.setLineDash([5, 3]);
        context.stroke();
        context.setLineDash([]);
        const center = screens.reduce(
          (sum, screen) => ({
            x: sum.x + screen.x / screens.length,
            y: sum.y + screen.y / screens.length,
          }),
          { x: 0, y: 0 },
        );
        const label = `S(${measurement.points.join("")}) = ${formatNumber(
          polygonArea(measuredPoints),
        )}`;
        context.font = "700 12px ui-monospace, SFMono-Regular, monospace";
        const width = context.measureText(label).width + 18;
        context.fillStyle = canvasPalette.measurementBackground;
        context.beginPath();
        context.roundRect(
          center.x - width / 2,
          center.y - 12,
          width,
          24,
          7,
        );
        context.fill();
        context.strokeStyle = `${measurement.color}88`;
        context.lineWidth = 1.2;
        context.stroke();
        context.fillStyle = measurement.color;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(label, center.x, center.y + 0.5);
      }
    });

    if (drag?.type === "marquee") {
      const x = Math.min(drag.startX, drag.currentX);
      const y = Math.min(drag.startY, drag.currentY);
      const width = Math.abs(drag.currentX - drag.startX);
      const height = Math.abs(drag.currentY - drag.startY);
      context.beginPath();
      context.rect(x, y, width, height);
      context.fillStyle = `${canvasPalette.primary}16`;
      context.fill();
      context.strokeStyle = canvasPalette.primary;
      context.lineWidth = 1.4;
      context.setLineDash([6, 4]);
      context.stroke();
      context.setLineDash([]);
    }

    points.forEach((point) => {
      const screen = worldToScreen(point);
      const isSelected =
        selectedPoint === point.id ||
        selectedPoints.includes(point.id) ||
        pendingPoints.includes(point.id);
      context.beginPath();
      context.arc(screen.x, screen.y, isSelected ? 6.5 : 5.2, 0, Math.PI * 2);
      context.fillStyle = canvasPalette.pointFill;
      context.fill();
      context.lineWidth = isSelected ? 3 : 2;
      context.strokeStyle = isSelected
        ? canvasPalette.selectedPoint
        : canvasPalette.primary;
      context.stroke();
      context.fillStyle = canvasPalette.label;
      context.font = "700 13px Inter, Arial, sans-serif";
      context.textAlign = "left";
      context.textBaseline = "middle";
      context.fillText(point.id, screen.x + 11, screen.y - 11);
    });

    if (result.values.length && result.kind !== "dirty") {
      const firstTarget = unknown
        .filter((row) => row.enabled)
        .map((row) => parseUnknown(row.expression))
        .find((target) => target?.kind === "distance");
      const value = result.values.find(
        (item) => item.label === firstTarget?.label,
      );
      if (firstTarget && value) {
        const a = map.get(firstTarget.ids[0]);
        const b = map.get(firstTarget.ids[1]);
        if (a && b) {
          const sa = worldToScreen(a);
          const sb = worldToScreen(b);
          const x = (sa.x + sb.x) / 2;
          const y = (sa.y + sb.y) / 2;
          const text = `${value.label} = ${formatNumber(value.value)}`;
          context.font = "700 12px ui-monospace, SFMono-Regular, monospace";
          const width = context.measureText(text).width + 18;
          context.fillStyle = canvasPalette.resultBackground;
          context.beginPath();
          context.roundRect(x - width / 2, y - 12, width, 24, 7);
          context.fill();
          context.fillStyle = canvasPalette.resultText;
          context.textAlign = "center";
          context.fillText(text, x, y + 0.5);
        }
      }
    }
  }, [
    activeTool,
    canvasSize,
    drag,
    equalSideMarks,
    formatNumber,
    measurements,
    parsedKnown,
    pendingPoints,
    points,
    result,
    selectedPoint,
    selectedPoints,
    shapes,
    showAngles,
    showCongruenceMarks,
    theme,
    unknown,
    view,
    worldToScreen,
  ]);

  const getOrCreatePoint = useCallback(
    (screenX: number, screenY: number) => {
      const hit = findPointAt(screenX, screenY);
      if (hit) return hit;
      const world = screenToWorld(screenX, screenY);
      const id = nextPointId(points);
      setPoints((current) => [...current, { id, x: world.x, y: world.y }]);
      return id;
    },
    [findPointAt, points, screenToWorld],
  );

  const completeToolSelection = useCallback(
    (id: string) => {
      const selection = [...pendingPoints, id];
      const addConstraints = (expressions: string[]) => {
        const startedAt = Date.now();
        setKnown((current) => [
          ...current,
          ...expressions.map((expression, index) => ({
            id: startedAt + index,
            expression,
            enabled: true,
            color: COLORS[(current.length + index) % COLORS.length],
          })),
        ]);
      };
      if (
        activeTool === "segment" ||
        activeTool === "line" ||
        activeTool === "ray"
      ) {
        if (selection.length === 2) {
          setShapes((current) => [
            ...current,
            {
              id: `shape-${Date.now()}`,
              type: activeTool,
              points: selection,
              color: COLORS[current.length % COLORS.length],
            },
          ]);
          setPendingPoints([]);
        } else setPendingPoints(selection);
      } else if (activeTool === "circle") {
        if (selection.length === 2) {
          setShapes((current) => [
            ...current,
            {
              id: `shape-${Date.now()}`,
              type: "circle",
              points: selection,
              color: COLORS[current.length % COLORS.length],
            },
          ]);
          setPendingPoints([]);
        } else setPendingPoints(selection);
      } else if (
        activeTool === "ellipse" ||
        activeTool === "sector" ||
        activeTool === "majorSector" ||
        activeTool === "circularSegment"
      ) {
        if (selection.length === 3) {
          if (new Set(selection).size < 3) {
            setCanvasNotice(
              t("Выберите три различные точки", "Select three distinct points"),
            );
            window.setTimeout(() => setCanvasNotice(null), 1800);
            setPendingPoints([...new Set(selection)]);
          } else {
            const [center, first, second] = selection;
            setShapes((current) => [
              ...current,
              {
                id: `shape-${Date.now()}`,
                type:
                  activeTool === "ellipse"
                    ? "ellipse"
                    : activeTool === "circularSegment"
                      ? "circularSegment"
                      : "sector",
                points: selection,
                color: COLORS[current.length % COLORS.length],
                arc:
                  activeTool === "majorSector" ? "major" : "minor",
              },
            ]);
            addConstraints(
              activeTool === "ellipse"
                ? [
                    `∠${first}${center}${second} = 90°`,
                    `distinct(${selection.join("")})`,
                  ]
                : [
                    `${center}${first} = ${center}${second}`,
                    `distinct(${selection.join("")})`,
                  ],
            );
            setPendingPoints([]);
          }
        } else {
          setPendingPoints(selection);
        }
      } else if (
        activeTool === "polygon" ||
        activeTool === "regularPolygon"
      ) {
        if (pendingPoints.includes(id)) {
          if (pendingPoints.length >= 3) {
            setShapes((current) => [
              ...current,
              {
                id: `shape-${Date.now()}`,
                type: "polygon",
                points: pendingPoints,
                color: COLORS[current.length % COLORS.length],
              },
            ]);
            addConstraints(
              polygonConstraintExpressions(
                pendingPoints,
                activeTool === "regularPolygon",
              ),
            );
            setPendingPoints([]);
          } else {
            setCanvasNotice(
              t(
                "Для многоугольника нужно минимум три вершины",
                "A polygon needs at least three vertices",
              ),
            );
            window.setTimeout(() => setCanvasNotice(null), 1800);
          }
        } else {
          setPendingPoints(selection);
        }
      } else if (
        activeTool === "triangle" ||
        activeTool === "rightTriangle" ||
        activeTool === "isoscelesTriangle" ||
        activeTool === "equilateralTriangle"
      ) {
        if (selection.length === 3) {
          if (new Set(selection).size < 3) {
            setCanvasNotice(
              t(
                "Выберите три различные вершины",
                "Select three distinct vertices",
              ),
            );
            window.setTimeout(() => setCanvasNotice(null), 1800);
            setPendingPoints([...new Set(selection)]);
          } else {
            const [a, b, c] = selection;
            const constraints = [`distinct(${selection.join("")})`];
            if (activeTool === "rightTriangle") {
              constraints.unshift(`∠${b}${a}${c} = 90°`);
            } else if (activeTool === "isoscelesTriangle") {
              constraints.unshift(`${a}${b} = ${a}${c}`);
            } else if (activeTool === "equilateralTriangle") {
              constraints.unshift(`${a}${b} = ${b}${c} = ${c}${a}`);
            }
            setShapes((current) => [
              ...current,
              {
                id: `shape-${Date.now()}`,
                type: "polygon",
                points: selection,
                color: COLORS[current.length % COLORS.length],
              },
            ]);
            addConstraints(constraints);
            setPendingPoints([]);
          }
        } else {
          setPendingPoints(selection);
        }
      } else if (
        activeTool === "square" ||
        activeTool === "rectangle" ||
        activeTool === "parallelogram" ||
        activeTool === "trapezoid" ||
        activeTool === "rhombus"
      ) {
        if (selection.length === 4) {
          if (new Set(selection).size < 4) {
            setCanvasNotice(
              t(
                "Выберите четыре различные вершины",
                "Select four distinct vertices",
              ),
            );
            window.setTimeout(() => setCanvasNotice(null), 1800);
            setPendingPoints([...new Set(selection)]);
          } else {
            setShapes((current) => [
              ...current,
              {
                id: `shape-${Date.now()}`,
                type: "polygon",
                points: selection,
                color: COLORS[current.length % COLORS.length],
              },
            ]);
            addConstraints(
              quadrilateralConstraintExpressions(activeTool, selection),
            );
            setPendingPoints([]);
          }
        } else {
          setPendingPoints(selection);
        }
      } else if (activeTool === "area") {
        if (pendingPoints.includes(id)) {
          if (pendingPoints.length >= 3) {
            setMeasurements((current) => [
              ...current,
              {
                id: Date.now(),
                kind: "area",
                points: pendingPoints,
                color: COLORS[(current.length + 3) % COLORS.length],
              },
            ]);
            setPendingPoints([]);
          } else {
            setCanvasNotice(
              t(
                "Для площади нужны минимум три вершины",
                "An area needs at least three vertices",
              ),
            );
            window.setTimeout(() => setCanvasNotice(null), 1800);
          }
        } else {
          setPendingPoints(selection);
        }
      } else if (activeTool === "angle") {
        if (selection.length === 3) {
          setMeasurements((current) => [
            ...current,
            {
              id: Date.now(),
              kind: "angle",
              points: selection,
              color: COLORS[(current.length + 3) % COLORS.length],
            },
          ]);
          setPendingPoints([]);
        } else setPendingPoints(selection);
      } else if (activeTool === "length") {
        if (selection.length === 2) {
          setMeasurements((current) => [
            ...current,
            {
              id: Date.now(),
              kind: "distance",
              points: selection,
              color: COLORS[(current.length + 3) % COLORS.length],
            },
          ]);
          setPendingPoints([]);
        } else setPendingPoints(selection);
      }
      if (
        activeTool !== "length" &&
        activeTool !== "angle" &&
        activeTool !== "area"
      ) {
        markDirty();
      }
    },
    [activeTool, markDirty, pendingPoints, t],
  );

  const pointerPosition = (
    event:
      | React.PointerEvent<HTMLCanvasElement>
      | React.WheelEvent<HTMLCanvasElement>,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const position = pointerPosition(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    const beginSelectionDrag = (hit: string) => {
      const ids =
        selectedPoints.includes(hit) && selectedPoints.length > 1
          ? selectedPoints
          : [hit];
      setSelectedPoints(ids);
      setSelectedPoint(ids.length === 1 ? hit : null);
      if (ids.length === 1) {
        setDrag({ type: "point", id: hit });
      } else {
        setDrag({
          type: "group",
          ids,
          start: screenToWorld(position.x, position.y),
          origins: points
            .filter((point) => ids.includes(point.id))
            .map((point) => ({ ...point })),
        });
      }
    };
    if (activeTool === "select") {
      const hit = findPointAt(position.x, position.y);
      if (hit) {
        beginSelectionDrag(hit);
      } else {
        setSelectedPoint(null);
        setSelectedPoints([]);
        setDrag({
          type: "pan",
          startX: position.x,
          startY: position.y,
          originX: view.x,
          originY: view.y,
        });
      }
      return;
    }
    if (activeTool === "marquee") {
      const hit = findPointAt(position.x, position.y);
      if (hit) {
        beginSelectionDrag(hit);
      } else {
        setSelectedPoint(null);
        setSelectedPoints([]);
        setDrag({
          type: "marquee",
          startX: position.x,
          startY: position.y,
          currentX: position.x,
          currentY: position.y,
        });
      }
      return;
    }
    if (activeTool === "point") {
      const world = screenToWorld(position.x, position.y);
      const id = nextPointId(points);
      setPoints((current) => [...current, { id, x: world.x, y: world.y }]);
      setSelectedPoint(id);
      setSelectedPoints([id]);
      markDirty();
      return;
    }
    if (activeTool === "pointOnSegment") {
      const object = findObjectAt(position.x, position.y);
      if (!object) {
        setCanvasNotice(
          t(
            "Кликните ближе к границе фигуры",
            "Click closer to a shape boundary",
          ),
        );
        window.setTimeout(() => setCanvasNotice(null), 1800);
        return;
      }
      const id = nextPointId(points);
      setPoints((current) => [
        ...current,
        { ...object.point, id },
      ]);
      setKnown((current) => [
        ...current,
        {
          id: Date.now(),
          expression: `${id} ∈ ${object.objectName}`,
          enabled: true,
          color: COLORS[current.length % COLORS.length],
        },
      ]);
      setSelectedPoint(id);
      setSelectedPoints([id]);
      setCanvasNotice(`${id} закреплена на ${object.objectName}`);
      window.setTimeout(() => setCanvasNotice(null), 1800);
      markDirty();
      return;
    }
    if (
      activeTool === "length" ||
      activeTool === "angle" ||
      activeTool === "area"
    ) {
      const hit = findPointAt(position.x, position.y);
      setDrag({
        type: "measurementPan",
        hit,
        startX: position.x,
        startY: position.y,
        originX: view.x,
        originY: view.y,
        moved: false,
      });
      return;
    }
    const id = getOrCreatePoint(position.x, position.y);
    completeToolSelection(id);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag) return;
    const position = pointerPosition(event);
    if (drag.type === "point") {
      const world = screenToWorld(position.x, position.y);
      setPoints((current) => {
        const currentMap = pointMap(current);
        const nextMap = new Map(
          current.map((point) => [point.id, { ...point }]),
        );
        const ownMembership = objectMemberships.find(
          (constraint) => constraint.ids[0] === drag.id,
        );
        if (ownMembership) {
          const start = currentMap.get(ownMembership.ids[1]);
          const end = currentMap.get(ownMembership.ids[2]);
          if (start && end) {
            nextMap.set(
              drag.id,
              ownMembership.kind === "onEllipse" &&
                currentMap.get(ownMembership.ids[3])
                ? projectPointToEllipse(
                    { id: drag.id, ...world },
                    start,
                    end,
                    currentMap.get(ownMembership.ids[3]) as Point,
                  )
                : ownMembership.kind === "onCircle"
                ? projectPointToCircle(
                    { id: drag.id, ...world },
                    start,
                    end,
                  )
                : projectPointToSegment(
                    { id: drag.id, ...world },
                    start,
                    end,
                    ownMembership.kind === "onLine"
                      ? "line"
                      : ownMembership.kind === "onRay"
                        ? "ray"
                        : "segment",
                  ),
            );
          }
        } else {
          nextMap.set(drag.id, { id: drag.id, ...world });
          objectMemberships.forEach((constraint) => {
            if (
              constraint.ids[1] !== drag.id &&
              constraint.ids[2] !== drag.id &&
              constraint.ids[3] !== drag.id
            ) {
              return;
            }
            const constrained = currentMap.get(constraint.ids[0]);
            const oldStart = currentMap.get(constraint.ids[1]);
            const oldEnd = currentMap.get(constraint.ids[2]);
            const newStart = nextMap.get(constraint.ids[1]);
            const newEnd = nextMap.get(constraint.ids[2]);
            const oldThird = currentMap.get(constraint.ids[3]);
            const newThird = nextMap.get(constraint.ids[3]);
            if (
              !constrained ||
              !oldStart ||
              !oldEnd ||
              !newStart ||
              !newEnd ||
              (constraint.kind === "onEllipse" &&
                (!oldThird || !newThird))
            ) {
              return;
            }
            if (
              constraint.kind === "onEllipse" &&
              oldThird &&
              newThird
            ) {
              const { angle } = projectPointToEllipse(
                constrained,
                oldStart,
                oldEnd,
                oldThird,
              );
              nextMap.set(
                constraint.ids[0],
                pointOnEllipse(
                  newStart,
                  newEnd,
                  newThird,
                  angle,
                  constraint.ids[0],
                ),
              );
            } else if (constraint.kind === "onCircle") {
              const { angle } = projectPointToCircle(
                constrained,
                oldStart,
                oldEnd,
              );
              const radius = distance(newStart, newEnd);
              nextMap.set(constraint.ids[0], {
                id: constraint.ids[0],
                x: newStart.x + Math.cos(angle) * radius,
                y: newStart.y + Math.sin(angle) * radius,
              });
            } else {
              const { t } = projectPointToSegment(
                constrained,
                oldStart,
                oldEnd,
                constraint.kind === "onLine"
                  ? "line"
                  : constraint.kind === "onRay"
                    ? "ray"
                    : "segment",
              );
              nextMap.set(constraint.ids[0], {
                id: constraint.ids[0],
                x: newStart.x + (newEnd.x - newStart.x) * t,
                y: newStart.y + (newEnd.y - newStart.y) * t,
              });
            }
          });
        }
        return current.map((point) => nextMap.get(point.id) ?? point);
      });
      markDirty();
    } else if (drag.type === "group") {
      const world = screenToWorld(position.x, position.y);
      const dx = world.x - drag.start.x;
      const dy = world.y - drag.start.y;
      const origins = new Map(
        drag.origins.map((point) => [point.id, point]),
      );
      setPoints((current) =>
        current.map((point) => {
          const origin = origins.get(point.id);
          return origin
            ? { ...point, x: origin.x + dx, y: origin.y + dy }
            : point;
        }),
      );
      markDirty();
    } else if (drag.type === "marquee") {
      setDrag((current) =>
        current?.type === "marquee"
          ? {
              ...current,
              currentX: position.x,
              currentY: position.y,
            }
          : current,
      );
    } else if (drag.type === "measurementPan") {
      const dx = position.x - drag.startX;
      const dy = position.y - drag.startY;
      const moved = drag.moved || Math.hypot(dx, dy) > 4;
      if (moved) {
        setView((current) => ({
          ...current,
          x: drag.originX + dx,
          y: drag.originY + dy,
        }));
      }
      if (moved !== drag.moved) {
        setDrag((current) =>
          current?.type === "measurementPan"
            ? { ...current, moved: true }
            : current,
        );
      }
    } else {
      setView((current) => ({
        ...current,
        x: drag.originX + position.x - drag.startX,
        y: drag.originY + position.y - drag.startY,
      }));
    }
  };

  const handlePointerUp = () => {
    if (
      drag?.type === "measurementPan" &&
      !drag.moved &&
      drag.hit
    ) {
      completeToolSelection(drag.hit);
    }
    if (drag?.type === "marquee") {
      const left = Math.min(drag.startX, drag.currentX);
      const right = Math.max(drag.startX, drag.currentX);
      const top = Math.min(drag.startY, drag.currentY);
      const bottom = Math.max(drag.startY, drag.currentY);
      const ids = points
        .filter((point) => {
          const screen = worldToScreen(point);
          return (
            screen.x >= left &&
            screen.x <= right &&
            screen.y >= top &&
            screen.y <= bottom
          );
        })
        .map((point) => point.id);
      setSelectedPoints(ids);
      setSelectedPoint(ids.length === 1 ? ids[0] : null);
      setCanvasNotice(
        ids.length
          ? `Выбрано точек: ${ids.length}`
          : "В области нет объектов",
      );
      window.setTimeout(() => setCanvasNotice(null), 1500);
    }
    setDrag(null);
  };

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const position = pointerPosition(event);
    const before = screenToWorld(position.x, position.y);
    const nextScale = Math.max(
      28,
      Math.min(180, view.scale * Math.exp(-event.deltaY * 0.001)),
    );
    setView({
      x: position.x - canvasSize.width / 2 - before.x * nextScale,
      y: position.y - canvasSize.height / 2 + before.y * nextScale,
      scale: nextScale,
    });
  };

  const chooseTool = (tool: ToolId) => {
    setActiveTool(tool);
    setPendingPoints([]);
    setAddMenu(null);
    setOpenToolGroup(null);
  };

  const openToolGroupMenu = useCallback(
    (groupId: ToolGroupId) => {
      const group = toolGroups.find((item) => item.id === groupId);
      if (!group) return;
      const activeIndex = group.toolIds.indexOf(activeTool);
      setToolGroupIndex(activeIndex >= 0 ? activeIndex : 0);
      setOpenToolGroup(groupId);
    },
    [activeTool, toolGroups],
  );

  const toggleToolGroupMenu = (groupId: ToolGroupId) => {
    if (
      window.matchMedia(MOBILE_WORKSPACE_QUERY).matches &&
      openToolGroup === groupId
    ) {
      setOpenToolGroup(null);
      return;
    }
    openToolGroupMenu(groupId);
  };

  const deleteSelected = useCallback(() => {
    const ids = selectedPoints.length
      ? selectedPoints
      : selectedPoint
        ? [selectedPoint]
        : [];
    if (!ids.length) return;
    const selected = new Set(ids);
    setPoints((current) =>
      current.filter((point) => !selected.has(point.id)),
    );
    setShapes((current) =>
      current.filter(
        (shape) => !shape.points.some((id) => selected.has(id)),
      ),
    );
    setMeasurements((current) =>
      current.filter(
        (measurement) =>
          !measurement.points.some((id) => selected.has(id)),
      ),
    );
    setSelectedPoint(null);
    setSelectedPoints([]);
    markDirty();
  }, [markDirty, selectedPoint, selectedPoints]);

  const commitRename = useCallback(() => {
    if (!selectedPoint) return;
    const nextId = renameValue.trim().toUpperCase();
    if (!/^[A-Z]$/.test(nextId)) {
      setCanvasNotice("Имя точки должно быть одной латинской буквой A–Z");
      window.setTimeout(() => setCanvasNotice(null), 2000);
      return;
    }
    if (
      nextId !== selectedPoint &&
      points.some((point) => point.id === nextId)
    ) {
      setCanvasNotice(`Точка ${nextId} уже существует`);
      window.setTimeout(() => setCanvasNotice(null), 2000);
      return;
    }
    if (nextId === selectedPoint) return;
    const previousId = selectedPoint;
    setPoints((current) =>
      current.map((point) =>
        point.id === previousId ? { ...point, id: nextId } : point,
      ),
    );
    setShapes((current) =>
      current.map((shape) => ({
        ...shape,
        points: shape.points.map((id) => (id === previousId ? nextId : id)),
      })),
    );
    setMeasurements((current) =>
      current.map((measurement) => ({
        ...measurement,
        points: measurement.points.map((id) =>
          id === previousId ? nextId : id,
        ),
      })),
    );
    setKnown((current) =>
      current.map((row) => ({
        ...row,
        expression: renamePointInExpression(
          row.expression,
          previousId,
          nextId,
        ),
      })),
    );
    setUnknown((current) =>
      current.map((row) => ({
        ...row,
        expression: renamePointInExpression(
          row.expression,
          previousId,
          nextId,
        ),
      })),
    );
    setSelectedPoint(nextId);
    setSelectedPoints([nextId]);
    setRenameValue(nextId);
    setCanvasNotice(`${previousId} переименована в ${nextId}`);
    window.setTimeout(() => setCanvasNotice(null), 1800);
    markDirty();
  }, [markDirty, points, renameValue, selectedPoint]);

  const runSolver = useCallback(() => {
    if (solving) return;
    setSolving(true);
    window.setTimeout(() => {
      const solved = solveNumerically(
        points,
        shapes,
        known,
        unknown,
        solverEpsilon,
        bareAngleUnit,
      );
      setPoints(solved.points);
      setResult(solved.result);
      setSolving(false);
      setRightOpen(true);
    }, 80);
  }, [
    bareAngleUnit,
    known,
    points,
    solverEpsilon,
    shapes,
    solving,
    unknown,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (helpOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          setHelpOpen(false);
        }
        return;
      }
      if (settingsOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          setSettingsOpen(false);
        }
        return;
      }
      const commandKey = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const undoKey = event.code === "KeyZ" || key === "z";
      const redoKey = event.code === "KeyY" || key === "y";
      if (commandKey && undoKey) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (commandKey && redoKey) {
        event.preventDefault();
        redo();
        return;
      }
      if (event.key === "F1") {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) return;
      if (event.shiftKey && event.code === "Slash") {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }
      const openedGroup = openToolGroup
        ? toolGroups.find((group) => group.id === openToolGroup)
        : null;
      if (openedGroup) {
        if (event.key === "Escape") {
          event.preventDefault();
          setOpenToolGroup(null);
          return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowRight") {
          event.preventDefault();
          setToolGroupIndex(
            (toolGroupIndex + 1) % openedGroup.toolIds.length,
          );
          return;
        }
        if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
          event.preventDefault();
          setToolGroupIndex(
            (toolGroupIndex - 1 + openedGroup.toolIds.length) %
              openedGroup.toolIds.length,
          );
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          chooseTool(openedGroup.toolIds[toolGroupIndex]);
          return;
        }
        const digit = /^Digit([1-9])$/.exec(event.code);
        if (digit) {
          const index = Number(digit[1]) - 1;
          if (openedGroup.toolIds[index]) {
            event.preventDefault();
            chooseTool(openedGroup.toolIds[index]);
            return;
          }
        }
      }
      if (event.key === "Escape") {
        setPendingPoints([]);
        setSelectedPoint(null);
        setSelectedPoints([]);
        setActiveTool("select");
        setOpenToolGroup(null);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        deleteSelected();
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        runSolver();
        return;
      }
      if (commandKey || event.altKey) return;
      const shortcutGroup = toolGroups.find(
        (group) => group.code === event.code,
      );
      if (shortcutGroup) {
        event.preventDefault();
        if (openToolGroup === shortcutGroup.id) {
          const nextIndex =
            (toolGroupIndex + 1) % shortcutGroup.toolIds.length;
          setToolGroupIndex(nextIndex);
          setActiveTool(shortcutGroup.toolIds[nextIndex]);
          setPendingPoints([]);
        } else {
          const activeIndex = shortcutGroup.toolIds.indexOf(activeTool);
          const nextIndex = activeIndex >= 0 ? activeIndex : 0;
          setActiveTool(shortcutGroup.toolIds[nextIndex]);
          setPendingPoints([]);
          openToolGroupMenu(shortcutGroup.id);
        }
        return;
      }
      const shortcutTool = tools.find(
        (tool) => tool.code && tool.code === event.code,
      );
      if (shortcutTool) {
        event.preventDefault();
        chooseTool(shortcutTool.id);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeTool,
    deleteSelected,
    helpOpen,
    openToolGroupMenu,
    openToolGroup,
    redo,
    runSolver,
    settingsOpen,
    toolGroupIndex,
    toolGroups,
    tools,
    undo,
  ]);

  const updateRow = (
    setRows: React.Dispatch<React.SetStateAction<ExpressionRow[]>>,
    id: number,
    patch: Partial<ExpressionRow>,
  ) => {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
    markDirty();
  };

  const updateExpressionInput = (
    setRows: React.Dispatch<React.SetStateAction<ExpressionRow[]>>,
    id: number,
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const input = event.currentTarget;
    const selectionStart = input.selectionStart ?? input.value.length;
    const selectionEnd = input.selectionEnd ?? selectionStart;
    const expanded = expandSymbolCommands(
      input.value,
      selectionStart,
      selectionEnd,
    );
    updateRow(setRows, id, { expression: expanded.value });
    if (expanded.changed) {
      window.requestAnimationFrame(() => {
        if (document.activeElement === input) {
          input.setSelectionRange(
            expanded.selectionStart,
            expanded.selectionEnd,
          );
        }
      });
    }
  };

  const toggleMobilePanel = (panel: "conditions" | "solver") => {
    if (panel === "conditions") setLeftOpen(true);
    if (panel === "solver") setRightOpen(true);
    setMobilePanel((current) => (current === panel ? "canvas" : panel));
  };

  const insertExpressionAfter = (
    group: "known" | "unknown",
    afterId: number,
  ) => {
    expressionIdRef.current = Math.max(
      expressionIdRef.current + 1,
      ...known.map((row) => row.id + 1),
      ...unknown.map((row) => row.id + 1),
    );
    const id = expressionIdRef.current;
    const setRows = group === "known" ? setKnown : setUnknown;
    setRows((current) => {
      const currentIndex = current.findIndex((row) => row.id === afterId);
      const insertIndex =
        currentIndex >= 0 ? currentIndex + 1 : current.length;
      const next = [...current];
      next.splice(insertIndex, 0, {
        id,
        expression: "",
        enabled: true,
        color: COLORS[insertIndex % COLORS.length],
      });
      return next;
    });
    setAddMenu(null);
    markDirty();
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLInputElement>(
          `[data-expression-input="${group}-${id}"]`,
        )
        ?.focus();
    });
  };

  const reorderExpressionRows = (
    group: "known" | "unknown",
    sourceId: number,
    targetId: number,
  ) => {
    if (sourceId === targetId) return;
    const setRows = group === "known" ? setKnown : setUnknown;
    setRows((current) => {
      const sourceIndex = current.findIndex((row) => row.id === sourceId);
      const targetIndex = current.findIndex((row) => row.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      const targetAfterRemoval = next.findIndex((row) => row.id === targetId);
      next.splice(
        sourceIndex < targetIndex
          ? targetAfterRemoval + 1
          : targetAfterRemoval,
        0,
        moved,
      );
      return next;
    });
    markDirty();
  };

  const moveExpressionRow = (
    group: "known" | "unknown",
    id: number,
    direction: -1 | 1,
  ) => {
    const rows = group === "known" ? known : unknown;
    const index = rows.findIndex((row) => row.id === id);
    const target = rows[index + direction];
    if (target) reorderExpressionRows(group, id, target.id);
  };

  const focusAdjacentExpression = (
    group: "known" | "unknown",
    id: number,
    direction: -1 | 1,
  ) => {
    const rows = group === "known" ? known : unknown;
    const index = rows.findIndex((row) => row.id === id);
    const target = rows[index + direction];
    if (!target) return false;
    const input = document.querySelector<HTMLInputElement>(
      `[data-expression-input="${group}-${target.id}"]`,
    );
    if (!input) return false;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    return true;
  };

  const expressionDragHandleProps = (
    group: "known" | "unknown",
    id: number,
  ) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      const next = { group, id };
      draggedExpressionRef.current = next;
      setDraggedExpression(next);

      expressionDragCleanupRef.current?.();
      const move = (moveEvent: PointerEvent) => {
        const current = draggedExpressionRef.current;
        if (
          !current ||
          current.group !== group ||
          current.id !== id
        ) {
          return;
        }
        moveEvent.preventDefault();
        const scrollRegion = document
          .elementFromPoint(moveEvent.clientX, moveEvent.clientY)
          ?.closest<HTMLElement>(".expressions");
        if (scrollRegion) {
          const bounds = scrollRegion.getBoundingClientRect();
          const edge = 54;
          if (moveEvent.clientY < bounds.top + edge) {
            scrollRegion.scrollBy({ top: -14 });
          } else if (moveEvent.clientY > bounds.bottom - edge) {
            scrollRegion.scrollBy({ top: 14 });
          }
        }
        const target = document
          .elementFromPoint(moveEvent.clientX, moveEvent.clientY)
          ?.closest<HTMLElement>("[data-expression-row]");
        if (
          target?.dataset.expressionGroup !== group ||
          !target.dataset.expressionRow
        ) {
          return;
        }
        const targetId = Number(target.dataset.expressionRow);
        if (Number.isSafeInteger(targetId) && targetId !== id) {
          reorderExpressionRows(group, id, targetId);
        }
      };
      const finish = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        expressionDragCleanupRef.current = null;
        draggedExpressionRef.current = null;
        setDraggedExpression(null);
      };
      expressionDragCleanupRef.current = finish;
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (!event.altKey) return;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        moveExpressionRow(group, id, event.key === "ArrowUp" ? -1 : 1);
      }
    },
  });

  const addKnownExpression = (expression: string) => {
    setKnown((current) => [
      ...current,
      {
        id: Date.now(),
        expression,
        enabled: true,
        color: COLORS[current.length % COLORS.length],
      },
    ]);
    setAddMenu(null);
    markDirty();
  };

  const addUnknownExpression = (expression: string) => {
    setUnknown((current) => [
      ...current,
      {
        id: Date.now(),
        expression,
        enabled: true,
        color: COLORS[current.length % COLORS.length],
      },
    ]);
    setAddMenu(null);
    markDirty();
  };

  const clearDrawing = () => {
    if (
      !window.confirm(
        t(
          "Полностью очистить чертёж, условия, цели и измерения? Действие можно отменить.",
          "Clear the drawing, conditions, targets and measurements completely? You can undo this action.",
        ),
      )
    ) {
      return;
    }
    setPoints([]);
    setShapes([]);
    setMeasurements([]);
    setKnown([]);
    setUnknown([]);
    setResult(PENDING_RESULT);
    setView({ x: 0, y: 0, scale: 74 });
    setSelectedPoint(null);
    setSelectedPoints([]);
    setPendingPoints([]);
    setActiveTool("select");
    setOpenToolGroup(null);
    setAddMenu(null);
  };

  const exportDrawing = () => {
    const data = JSON.stringify(
      {
        format: "geosolver",
        version: 1,
        projectTitle: projectTitle.trim() || DEFAULT_PROJECT_TITLE,
        points,
        shapes,
        measurements,
        known,
        unknown,
        solverEpsilon: solverEpsilonInput,
        view,
      },
      null,
      2,
    );
    const href = URL.createObjectURL(
      new Blob([data], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = href;
    const safeTitle = (projectTitle.trim() || "geosolver-drawing")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/g, "")
      .slice(0, 80);
    anchor.download = `${safeTitle || "geosolver-drawing"}.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  };

  const importDrawingFile = async (file: File) => {
    if (file.size > MAX_IMPORT_FILE_SIZE) {
      window.alert("Файл слишком большой. Максимальный размер — 5 МБ.");
      return;
    }
    try {
      const imported = parseImportedProject(await file.text());
      if (
        !window.confirm(
          `Импортировать проект «${imported.projectTitle}»? Текущий чертёж будет заменён.`,
        )
      ) {
        return;
      }

      if (historyTimerRef.current !== null) {
        window.clearTimeout(historyTimerRef.current);
        historyTimerRef.current = null;
      }
      historyRef.current = {
        past: [],
        present: cloneSnapshot(imported.snapshot),
        future: [],
      };
      applySnapshot(imported.snapshot);
      setProjectTitle(imported.projectTitle);
      setSolverEpsilonInput(imported.solverEpsilon);
      setView(imported.view ?? { x: 35, y: 34, scale: 74 });
      setActiveTool("select");
      setOpenToolGroup(null);
      setMobilePanel("canvas");
      expressionIdRef.current = Math.max(
        Date.now(),
        ...imported.snapshot.known.map((row) => row.id + 1),
        ...imported.snapshot.unknown.map((row) => row.id + 1),
      );
      setHistoryVersion((version) => version + 1);
      setCanvasNotice(`Импортирован проект «${imported.projectTitle}»`);
      window.setTimeout(() => setCanvasNotice(null), 2200);
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "Не удалось импортировать проект.",
      );
    }
  };

  const handleImportInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) void importDrawingFile(file);
  };

  const hasDraggedFiles = (event: React.DragEvent<HTMLElement>) =>
    Array.from(event.dataTransfer.types).includes("Files");

  const handleImportDragEnter = (event: React.DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    importDragDepthRef.current += 1;
    setImportDragActive(true);
  };

  const handleImportDragOver = (event: React.DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleImportDragLeave = (event: React.DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    importDragDepthRef.current = Math.max(0, importDragDepthRef.current - 1);
    if (importDragDepthRef.current === 0) setImportDragActive(false);
  };

  const handleImportDrop = (event: React.DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    importDragDepthRef.current = 0;
    setImportDragActive(false);
    const file = event.dataTransfer.files[0];
    if (file) void importDrawingFile(file);
  };

  const fitDrawing = () => {
    if (!points.length) return;
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const scale = Math.min(
      110,
      Math.max(
        35,
        Math.min(
          (canvasSize.width - 180) / Math.max(maxX - minX, 2),
          (canvasSize.height - 180) / Math.max(maxY - minY, 2),
        ),
      ),
    );
    setView({
      scale,
      x: -((minX + maxX) / 2) * scale,
      y: ((minY + maxY) / 2) * scale,
    });
  };

  return (
    <main
      lang={locale}
      className="app-shell"
      onDragEnter={handleImportDragEnter}
      onDragOver={handleImportDragOver}
      onDragLeave={handleImportDragLeave}
      onDrop={handleImportDrop}
    >
      {importDragActive && (
        <div className="import-drop-overlay" role="status" aria-live="polite">
          <div>
            <span aria-hidden="true">↓</span>
            <b>{t("Импорт проекта", "Import project")}</b>
            <small>
              {t("Отпустите JSON-файл GeoSolver", "Drop the GeoSolver JSON file")}
            </small>
          </div>
        </div>
      )}
      <header className="topbar">
        <div className="brand-block">
          <AppMark />
          <span className="brand-name">
            geo<span>solver</span>
          </span>
        </div>
        <div className="project-title">
          <input
            id="project-title"
            name="project-title"
            value={projectTitle}
            maxLength={80}
            autoComplete="off"
            aria-label={t("Название проекта", "Project name")}
            title={t(
              "Название сохраняется автоматически",
              "The name is saved automatically",
            )}
            onChange={(event) => setProjectTitle(event.target.value)}
            onBlur={() =>
              setProjectTitle((current) =>
                current.trim() || DEFAULT_PROJECT_TITLE,
              )
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </div>
        <div className="top-actions">
          <div
            className="history-actions"
            aria-label={t("История действий", "Action history")}
          >
            <button
              className="top-button icon-button"
              onClick={undo}
              disabled={!canUndo}
              title={t("Отменить · Ctrl+Z", "Undo · Ctrl+Z")}
              aria-label={t("Отменить действие", "Undo")}
            >
              ↶
            </button>
            <button
              className="top-button icon-button"
              onClick={redo}
              disabled={!canRedo}
              title={t("Повторить · Ctrl+Y", "Redo · Ctrl+Y")}
              aria-label={t("Повторить действие", "Redo")}
            >
              ↷
            </button>
          </div>
          <button
            className="top-button icon-button clear-button"
            onClick={clearDrawing}
            title={t("Очистить полностью", "Clear completely")}
            aria-label={t("Очистить полностью", "Clear completely")}
          >
            ⌫
          </button>
          <button
            className="top-button help-button"
            onClick={() => setHelpOpen(true)}
            title={t("Открыть справку · F1", "Open help · F1")}
            aria-label={t("Открыть справку", "Open help")}
          >
            <span aria-hidden="true">
              <svg viewBox="0 0 20 20" focusable="false">
                <circle cx="10" cy="10" r="8.25" />
                <path d="M7.8 7.25a2.35 2.35 0 1 1 3.55 2.02C10.4 9.9 10 10.48 10 11.5" />
                <circle className="help-dot" cx="10" cy="14.35" r="0.8" />
              </svg>
            </span>
            <em>{t("Справка", "Help")}</em>
          </button>
          <button
            className={`top-button icon-button settings-button ${
              settingsOpen ? "is-active" : ""
            }`}
            onClick={() => setSettingsOpen((open) => !open)}
            title={t("Настройки", "Settings")}
            aria-label={
              settingsOpen
                ? t("Закрыть настройки", "Close settings")
                : t("Открыть настройки", "Open settings")
            }
            aria-expanded={settingsOpen}
            aria-controls="settings-panel"
          >
            <span aria-hidden="true">⚙</span>
          </button>
          <input
            ref={importInputRef}
            id="project-import"
            name="project-import"
            className="project-import-input"
            type="file"
            accept=".json,application/json"
            onChange={handleImportInput}
          />
          <button
            className={`top-button solver-toggle ${rightOpen ? "is-active" : ""}`}
            onClick={() => setRightOpen((open) => !open)}
          >
            {t("Решение", "Solution")}
            <span>{rightOpen ? "›" : "‹"}</span>
          </button>
        </div>
        <nav
          className="mobile-panel-tabs"
          aria-label={t("Разделы рабочего пространства", "Workspace sections")}
        >
          <button
            className={mobilePanel === "conditions" ? "active" : ""}
            onClick={() => toggleMobilePanel("conditions")}
            aria-pressed={mobilePanel === "conditions"}
            title={t(
              "Развернуть или свернуть условия и цели",
              "Expand or collapse constraints and targets",
            )}
          >
            <span>≡</span>
            {t("Условия", "Conditions")}
          </button>
          <button
            className={mobilePanel === "canvas" ? "active" : ""}
            onClick={() => setMobilePanel("canvas")}
            aria-pressed={mobilePanel === "canvas"}
          >
            <span>◇</span>
            {t("Чертёж", "Drawing")}
          </button>
          <button
            className={mobilePanel === "solver" ? "active" : ""}
            onClick={() => toggleMobilePanel("solver")}
            aria-pressed={mobilePanel === "solver"}
            title={t(
              "Развернуть или свернуть решение",
              "Expand or collapse the solution",
            )}
          >
            <span>✓</span>
            {t("Решение", "Solution")}
          </button>
        </nav>
      </header>

      <section
        className={`workspace ${leftOpen ? "" : "left-collapsed"} ${
          rightOpen ? "" : "right-collapsed"
        } mobile-panel-${mobilePanel}`}
      >
        <aside className="left-panel">
          <nav
            className="tool-rail"
            aria-label={t("Инструменты построения", "Construction tools")}
          >
            {TOOL_RAIL_ITEMS.map((item) => {
              if (item.kind === "tool") {
                const tool = tools.find((candidate) => candidate.id === item.id);
                if (!tool) return null;
                return (
                  <button
                    key={tool.id}
                    data-tool={tool.id}
                    className={activeTool === tool.id ? "active" : ""}
                    onClick={() => chooseTool(tool.id)}
                    title={`${tool.label} · ${tool.shortcut}`}
                    aria-label={tool.label}
                  >
                    <ToolGlyph tool={tool} />
                    <kbd className="tool-shortcut">{tool.shortcut}</kbd>
                  </button>
                );
              }
              const group = toolGroups.find(
                (candidate) => candidate.id === item.id,
              );
              if (!group) return null;
              const groupTools = group.toolIds
                .map((id) => tools.find((tool) => tool.id === id))
                .filter(
                  (tool): tool is (typeof tools)[number] => Boolean(tool),
                );
              const groupActive = group.toolIds.includes(activeTool);
              const selectedGroupTool = groupTools.find(
                (tool) => tool.id === activeTool,
              );
              const groupOpen = openToolGroup === group.id;
              return (
                <div
                  className="tool-group-slot"
                  key={group.id}
                  onPointerEnter={(event) => {
                    if (
                      event.pointerType === "mouse" &&
                      !window.matchMedia(MOBILE_WORKSPACE_QUERY).matches
                    ) {
                      openToolGroupMenu(group.id);
                    }
                  }}
                  onPointerLeave={(event) => {
                    if (
                      event.pointerType === "mouse" &&
                      !window.matchMedia(MOBILE_WORKSPACE_QUERY).matches
                    ) {
                      setOpenToolGroup(null);
                    }
                  }}
                >
                  <button
                    data-tool-group={group.id}
                    className={`tool-group-trigger ${
                      groupActive ? "active" : ""
                    }`}
                    onClick={() => toggleToolGroupMenu(group.id)}
                    title={`${group.label} · ${group.shortcut}${
                      selectedGroupTool ? ` · ${selectedGroupTool.label}` : ""
                    }`}
                    aria-label={
                      selectedGroupTool
                        ? t(
                            `${group.label}: выбран ${selectedGroupTool.label}`,
                            `${group.label}: ${selectedGroupTool.label} selected`,
                          )
                        : group.label
                    }
                    aria-haspopup="menu"
                    aria-expanded={groupOpen}
                  >
                    {selectedGroupTool ? (
                      <ToolGlyph tool={selectedGroupTool} />
                    ) : (
                      <span className="tool-glyph" aria-hidden="true">
                        {group.icon}
                      </span>
                    )}
                    <i className="tool-group-caret">›</i>
                    <kbd className="tool-shortcut">{group.shortcut}</kbd>
                  </button>
                  {groupOpen && (
                    <div
                      className={`tool-flyout ${
                        group.id === "triangles" ||
                        group.id === "quadrilaterals"
                          ? "align-bottom"
                          : ""
                      }`}
                      role="menu"
                      aria-label={group.label}
                    >
                      <div className="tool-flyout-title">
                        <b>{group.label}</b>
                        <span>↑↓ · Enter</span>
                      </div>
                      {groupTools.map((tool, index) => (
                        <button
                          className={`tool-flyout-item ${
                            toolGroupIndex === index ? "focused" : ""
                          } ${activeTool === tool.id ? "current" : ""}`}
                          key={tool.id}
                          role="menuitem"
                          onMouseEnter={() => setToolGroupIndex(index)}
                          onClick={() => chooseTool(tool.id)}
                        >
                          <ToolGlyph tool={tool} />
                          <span>
                            <b>{tool.label}</b>
                            <small>{tool.hint}</small>
                          </span>
                          <kbd>{index + 1}</kbd>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <div className="rail-spacer" />
            <button
              onClick={deleteSelected}
              disabled={!selectedPoint && !selectedPoints.length}
              title={t("Удалить выбранные объекты", "Delete selected objects")}
              aria-label={t("Удалить", "Delete")}
            >
              <span className="trash-icon">×</span>
            </button>
          </nav>

          <div
            className="expressions"
            role="region"
            aria-label={t("Условия и цели", "Conditions and targets")}
            tabIndex={0}
          >
            <div className="panel-heading">
              <div>
                <span className="eyebrow">{t("УСЛОВИЕ", "CONDITION")}</span>
                <h1>{t("Что известно", "Known facts")}</h1>
              </div>
              <div className="heading-actions">
                <button
                  className="round-add"
                  onClick={() =>
                    insertExpressionAfter(
                      "known",
                      known.at(-1)?.id ?? -1,
                    )
                  }
                  aria-label={t(
                    "Добавить пустое условие",
                    "Add empty condition",
                  )}
                  title={t("Пустое условие", "Empty condition")}
                >
                  +
                </button>
                <button
                  className={`round-add examples-trigger ${
                    addMenu === "known" ? "active" : ""
                  }`}
                  onClick={() =>
                    setAddMenu((menu) =>
                      menu === "known" ? null : "known",
                    )
                  }
                  aria-label={t(
                    "Выбрать пример условия",
                    "Choose a condition example",
                  )}
                  title={t("Примеры условий", "Condition examples")}
                  aria-haspopup="menu"
                  aria-expanded={addMenu === "known"}
                >
                  ▾
                </button>
              </div>
            </div>

            {addMenu === "known" && (
              <div
                className="add-popover"
                role="menu"
                aria-label={t("Примеры условий", "Condition examples")}
              >
                <button onClick={() => addKnownExpression("AB = 5")}>
                  <b>AB = 5</b>
                  <span>{t("длина", "length")}</span>
                </button>
                <button onClick={() => addKnownExpression("∠ABC = 60°")}>
                  <b>∠ABC = 60°</b>
                  <span>{t("угол", "angle")}</span>
                </button>
                <button onClick={() => addKnownExpression("S(ABC) = 10")}>
                  <b>S(ABC) = 10</b>
                  <span>
                    {t(
                      "площадь треугольника или многоугольника",
                      "triangle or polygon area",
                    )}
                  </span>
                </button>
                <button onClick={() => addKnownExpression("x(A) = 0")}>
                  <b>x(A) = 0</b>
                  <span>{t("координата x точки", "point x-coordinate")}</span>
                </button>
                <button onClick={() => addKnownExpression("y(A) = 0")}>
                  <b>y(A) = 0</b>
                  <span>{t("координата y точки", "point y-coordinate")}</span>
                </button>
                <button onClick={() => addKnownExpression("A = (0, 0)")}>
                  <b>A = (0, 0)</b>
                  <span>{t("обе координаты точки", "both point coordinates")}</span>
                </button>
                <button onClick={() => addKnownExpression("AB ⟂ AC")}>
                  <b>AB ⟂ AC</b>
                  <span>{t("отношение", "relation")}</span>
                </button>
                <button onClick={() => addKnownExpression("A ≠ B")}>
                  <b>A ≠ B</b>
                  <span>{t("различные точки", "distinct points")}</span>
                </button>
                <button
                  onClick={() =>
                    addKnownExpression("AB ∩ CD = ∅")
                  }
                >
                  <b>AB ∩ CD = ∅</b>
                  <span>{t("отрезки не пересекаются", "segments do not intersect")}</span>
                </button>
                <button
                  onClick={() => addKnownExpression("H = EG ∩ DF")}
                >
                  <b>H = EG ∩ DF</b>
                  <span>{t("точка пересечения", "intersection point")}</span>
                </button>
                <button
                  onClick={() => addKnownExpression("∠ABC = ∠BCA")}
                >
                  <b>∠ABC = ∠BCA</b>
                  <span>{t("равенство углов", "equal angles")}</span>
                </button>
                <button
                  onClick={() =>
                    addKnownExpression("∠ABC + ∠BCA = 90°")
                  }
                >
                  <b>∠ABC + ∠BCA = 90°</b>
                  <span>{t("сумма углов", "angle sum")}</span>
                </button>
                <button onClick={() => addKnownExpression("AB + BC = AC")}>
                  <b>AB + BC = AC</b>
                  <span>{t("формула длин", "length formula")}</span>
                </button>
                <button onClick={() => addKnownExpression("AB = BC = AC")}>
                  <b>AB = BC = AC</b>
                  <span>{t("цепочка равенств", "equality chain")}</span>
                </button>
                <button onClick={() => addKnownExpression("a = AB")}>
                  <b>a = AB</b>
                  <span>{t("определение переменной", "variable definition")}</span>
                </button>
              </div>
            )}

            <div className="expression-list">
              {known.map((row, index) => {
                const parsed = parseConstraint(
                  row.expression,
                  bareAngleUnit,
                );
                const referenceError = parsed
                  ? deletedReferenceMessage(parsed.ids, points, locale)
                  : null;
                return (
                  <div
                    className={`expression-row ${
                      referenceError ? "has-reference-error" : ""
                    } ${
                      draggedExpression?.group === "known" &&
                      draggedExpression.id === row.id
                        ? "is-reordering"
                        : ""
                    }`}
                    key={row.id}
                    data-expression-group="known"
                    data-expression-row={row.id}
                  >
                    <button
                      className="row-drag-handle"
                      title={t("Перетащить · Alt+↑/↓", "Drag · Alt+↑/↓")}
                      aria-label={t(
                        `Переместить условие ${index + 1}`,
                        `Move condition ${index + 1}`,
                      )}
                      {...expressionDragHandleProps("known", row.id)}
                    >
                      ⠿
                    </button>
                    <span className="row-number">{index + 1}</span>
                    <button
                      className={`color-toggle ${row.enabled ? "" : "off"}`}
                      style={{ "--row-color": row.color } as React.CSSProperties}
                      onClick={() =>
                        updateRow(setKnown, row.id, { enabled: !row.enabled })
                      }
                      aria-label={
                        row.enabled
                          ? t("Отключить ограничение", "Disable constraint")
                          : t("Включить ограничение", "Enable constraint")
                      }
                    />
                    <div className="expression-input-wrap">
                      <input
                        id={`known-expression-${row.id}`}
                        name={`known-expression-${row.id}`}
                        value={row.expression}
                        data-expression-input={`known-${row.id}`}
                        autoComplete="off"
                        onChange={(event) =>
                          updateExpressionInput(setKnown, row.id, event)
                        }
                        onKeyDown={(event) => {
                          if (
                            event.altKey &&
                            (event.key === "ArrowUp" ||
                              event.key === "ArrowDown")
                          ) {
                            event.preventDefault();
                            moveExpressionRow(
                              "known",
                              row.id,
                              event.key === "ArrowUp" ? -1 : 1,
                            );
                            return;
                          }
                          if (
                            !event.shiftKey &&
                            !event.ctrlKey &&
                            !event.metaKey &&
                            (event.key === "ArrowUp" ||
                              event.key === "ArrowDown") &&
                            focusAdjacentExpression(
                              "known",
                              row.id,
                              event.key === "ArrowUp" ? -1 : 1,
                            )
                          ) {
                            event.preventDefault();
                            return;
                          }
                          if (event.shiftKey && event.key === "Enter") {
                            event.preventDefault();
                            insertExpressionAfter("known", row.id);
                            return;
                          }
                          if (
                            event.key === "Enter" ||
                            event.key === "Escape"
                          ) {
                            event.preventDefault();
                            event.currentTarget.blur();
                          }
                        }}
                        spellCheck={false}
                        title={t(
                          "↑/↓ — соседняя строка · Alt+↑/↓ — переместить · Shift+Enter — добавить",
                          "↑/↓ — adjacent row · Alt+↑/↓ — move · Shift+Enter — add",
                        )}
                        aria-label={t(
                          `Известное ${index + 1}`,
                          `Known fact ${index + 1}`,
                        )}
                      />
                      <span
                        className={
                          parsed && !referenceError
                            ? "recognized"
                            : "unrecognized"
                        }
                      >
                        {referenceError
                          ? referenceError
                          : parsed?.kind === "definition"
                          ? t("определение переменной", "variable definition")
                          : parsed
                            ? t("распознано", "recognized")
                            : t("проверьте запись", "check the expression")}
                      </span>
                    </div>
                    <button
                      className="row-delete"
                      onClick={() =>
                        setKnown((current) =>
                          current.filter((item) => item.id !== row.id),
                        )
                      }
                      aria-label={t("Удалить условие", "Delete condition")}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="section-divider" />

            <div className="panel-heading find-heading">
              <div>
                <span className="eyebrow">{t("ЦЕЛЬ", "TARGET")}</span>
                <h2>{t("Что найти", "Find")}</h2>
              </div>
              <div className="heading-actions">
                <button
                  className="round-add"
                  onClick={() =>
                    insertExpressionAfter(
                      "unknown",
                      unknown.at(-1)?.id ?? -1,
                    )
                  }
                  aria-label={t("Добавить пустую цель", "Add empty target")}
                  title={t("Пустая цель", "Empty target")}
                >
                  +
                </button>
                <button
                  className={`round-add examples-trigger ${
                    addMenu === "unknown" ? "active" : ""
                  }`}
                  onClick={() =>
                    setAddMenu((menu) =>
                      menu === "unknown" ? null : "unknown",
                    )
                  }
                  aria-label={t(
                    "Выбрать пример цели",
                    "Choose a target example",
                  )}
                  title={t("Примеры целей", "Target examples")}
                  aria-haspopup="menu"
                  aria-expanded={addMenu === "unknown"}
                >
                  ▾
                </button>
              </div>
            </div>

            {addMenu === "unknown" && (
              <div
                className="add-popover unknown-popover"
                role="menu"
                aria-label={t("Примеры целей", "Target examples")}
              >
                <button onClick={() => addUnknownExpression("BC = ?")}>
                  <b>BC = ?</b>
                  <span>{t("длина", "length")}</span>
                </button>
                <button onClick={() => addUnknownExpression("∠ABC = ?")}>
                  <b>∠ABC = ?</b>
                  <span>{t("угол", "angle")}</span>
                </button>
                <button onClick={() => addUnknownExpression("S(ABC) = ?")}>
                  <b>S(ABC) = ?</b>
                  <span>
                    {t(
                      "площадь треугольника или многоугольника",
                      "triangle or polygon area",
                    )}
                  </span>
                </button>
                <button
                  onClick={() => addUnknownExpression("AB + BC = ?")}
                >
                  <b>AB + BC = ?</b>
                  <span>{t("значение формулы", "formula value")}</span>
                </button>
              </div>
            )}

            <div className="expression-list unknown-list">
              {unknown.map((row, index) => {
                const target = parseUnknown(row.expression);
                const referenceError = target
                  ? deletedReferenceMessage(target.ids, points, locale)
                  : null;
                return (
                  <div
                    className={`expression-row ${
                      referenceError ? "has-reference-error" : ""
                    } ${
                      draggedExpression?.group === "unknown" &&
                      draggedExpression.id === row.id
                        ? "is-reordering"
                        : ""
                    }`}
                    key={row.id}
                    data-expression-group="unknown"
                    data-expression-row={row.id}
                  >
                    <button
                      className="row-drag-handle"
                      title={t("Перетащить · Alt+↑/↓", "Drag · Alt+↑/↓")}
                      aria-label={t(
                        `Переместить цель ${index + 1}`,
                        `Move target ${index + 1}`,
                      )}
                      {...expressionDragHandleProps("unknown", row.id)}
                    >
                      ⠿
                    </button>
                    <span className="row-number">{index + 1}</span>
                    <button
                      className={`color-toggle target ${row.enabled ? "" : "off"}`}
                      style={{ "--row-color": row.color } as React.CSSProperties}
                      onClick={() =>
                        updateRow(setUnknown, row.id, { enabled: !row.enabled })
                      }
                      aria-label={t(
                        "Включить или отключить цель",
                        "Enable or disable target",
                      )}
                    />
                    <div className="expression-input-wrap">
                      <input
                        id={`unknown-expression-${row.id}`}
                        name={`unknown-expression-${row.id}`}
                        value={row.expression}
                        data-expression-input={`unknown-${row.id}`}
                        autoComplete="off"
                        onChange={(event) =>
                          updateExpressionInput(setUnknown, row.id, event)
                        }
                        onBlur={() => {
                          const normalized = normalizeUnknownExpression(
                            row.expression,
                          );
                          if (normalized !== row.expression) {
                            updateRow(setUnknown, row.id, {
                              expression: normalized,
                            });
                          }
                        }}
                        onKeyDown={(event) => {
                          if (
                            event.altKey &&
                            (event.key === "ArrowUp" ||
                              event.key === "ArrowDown")
                          ) {
                            event.preventDefault();
                            moveExpressionRow(
                              "unknown",
                              row.id,
                              event.key === "ArrowUp" ? -1 : 1,
                            );
                            return;
                          }
                          if (
                            !event.shiftKey &&
                            !event.ctrlKey &&
                            !event.metaKey &&
                            (event.key === "ArrowUp" ||
                              event.key === "ArrowDown") &&
                            focusAdjacentExpression(
                              "unknown",
                              row.id,
                              event.key === "ArrowUp" ? -1 : 1,
                            )
                          ) {
                            event.preventDefault();
                            return;
                          }
                          if (event.shiftKey && event.key === "Enter") {
                            event.preventDefault();
                            insertExpressionAfter("unknown", row.id);
                            return;
                          }
                          if (
                            event.key === "Enter" ||
                            event.key === "Escape"
                          ) {
                            event.preventDefault();
                            event.currentTarget.blur();
                          }
                        }}
                        spellCheck={false}
                        title={t(
                          "↑/↓ — соседняя строка · Alt+↑/↓ — переместить · Shift+Enter — добавить",
                          "↑/↓ — adjacent row · Alt+↑/↓ — move · Shift+Enter — add",
                        )}
                        aria-label={t(
                          `Неизвестное ${index + 1}`,
                          `Target ${index + 1}`,
                        )}
                      />
                      <span
                        className={
                          target && !referenceError
                            ? "recognized"
                            : "unrecognized"
                        }
                      >
                        {referenceError
                          ? referenceError
                          : target
                            ? t("целевая величина", "target value")
                            : t("проверьте запись", "check the expression")}
                      </span>
                    </div>
                    <button
                      className="row-delete"
                      onClick={() =>
                        setUnknown((current) =>
                          current.filter((item) => item.id !== row.id),
                        )
                      }
                      aria-label={t("Удалить цель", "Delete target")}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="syntax-note">
              <span>i</span>
              {locale === "ru" ? (
                <p>
                  <b>Shift+Enter</b> сохраняет строку и создаёт следующую.{" "}
                  Символы сворачиваются автоматически: <b>\angle</b> → ∠,{" "}
                  <b>\perp</b> → ⟂, <b>\in</b> → ∈. Формулы:{" "}
                  <b>AB + BC = AC</b>, <b>∠ABC = ∠BCA + 10°</b> или цепочка{" "}
                  <b>AB = BC = CD</b>. Площадь: <b>S(ABCD) = ?</b>.
                  Координаты: <b>x(A) = 2</b>, <b>y(A) = -1</b> или{" "}
                  <b>A = (2, -1)</b>. Переменные задаются
                  отдельными строками: <b>a = AB</b>, <b>b = 2*a</b>.
                  Неравенства: <b>0 &lt; AB &lt;= 10</b>. Топология:{" "}
                  <b>distinct(ABCD)</b> и <b>AB ∩ CD = ∅</b>. Пересечение:{" "}
                  <b>H = EG ∩ DF</b> или{" "}
                  <b>H = line(EG) ∩ circle(OA)</b>.
                </p>
              ) : (
                <p>
                  <b>Shift+Enter</b> saves a row and creates the next one.
                  Commands expand automatically: <b>\angle</b> → ∠,{" "}
                  <b>\perp</b> → ⟂, <b>\in</b> → ∈. Formulas:{" "}
                  <b>AB + BC = AC</b>, <b>∠ABC = ∠BCA + 10°</b>, or{" "}
                  <b>AB = BC = CD</b>. Area: <b>S(ABCD) = ?</b>.
                  Coordinates: <b>x(A) = 2</b>, <b>y(A) = -1</b>, or{" "}
                  <b>A = (2, -1)</b>. Define variables on
                  separate rows: <b>a = AB</b>, <b>b = 2*a</b>.
                  Comparisons: <b>0 &lt; AB &lt;= 10</b>.
                  Intersection: <b>H = EG ∩ DF</b> or{" "}
                  <b>H = line(EG) ∩ circle(OA)</b>.
                </p>
              )}
            </div>
          </div>
          <button
            className="panel-collapse"
            onClick={() => setLeftOpen(false)}
            aria-label={t("Свернуть панель условий", "Collapse conditions panel")}
          >
            ‹
          </button>
        </aside>

        <section
          className={`canvas-stage ${showToolHint ? "" : "hint-hidden"}`}
        >
          {!leftOpen && (
            <button
              className="reopen-panel left"
              onClick={() => setLeftOpen(true)}
              aria-label={t("Открыть панель условий", "Open conditions panel")}
            >
              ›
            </button>
          )}
          <canvas
            ref={canvasRef}
            className={`geometry-canvas tool-${activeTool} ${
              drag?.type === "group" ? "is-group-dragging" : ""
            }`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => setDrag(null)}
            onWheel={handleWheel}
            aria-label={t(
              "Координатное поле геометрического чертежа",
              "Geometry coordinate canvas",
            )}
            tabIndex={0}
          />

          {showToolHint && (
            <div className="canvas-hint">
              <ToolGlyph tool={activeToolInfo} />
              <div>
                <b>
                  {activeToolInfo.label}
                  <kbd className="hint-shortcut">
                    {activeToolInfo.shortcut}
                  </kbd>
                </b>
                <small>{activeToolInfo.hint}</small>
              </div>
              {canvasNotice && <em className="notice">{canvasNotice}</em>}
              {!canvasNotice && selectedPoints.length > 1 && (
                <em>
                  {t(
                    `${selectedPoints.length} объектов выбрано`,
                    `${selectedPoints.length} objects selected`,
                  )}
                </em>
              )}
              {pendingPoints.length > 0 && (
                <em>
                  {pendingPoints.join(" → ")} ·{" "}
                  {t(
                    `выбрано ${pendingPoints.length}`,
                    `${pendingPoints.length} selected`,
                  )}
                </em>
              )}
            </div>
          )}

          {selectedPointData && activeTool === "select" && (
            <div className="point-inspector">
              <div className="inspector-title">
                <span>{t("ТОЧКА", "POINT")}</span>
                <small>
                  x {formatNumber(selectedPointData.x)} · y{" "}
                  {formatNumber(selectedPointData.y)}
                </small>
              </div>
              <label>
                <span>{t("Имя", "Name")}</span>
                <input
                  id="selected-point-name"
                  name="selected-point-name"
                  value={renameValue}
                  maxLength={1}
                  autoComplete="off"
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitRename();
                    if (event.key === "Escape") {
                      setRenameValue(selectedPointData.id);
                      event.currentTarget.blur();
                    }
                  }}
                  aria-label={t("Новое имя точки", "New point name")}
                />
              </label>
              <button onClick={commitRename}>
                {t("Переименовать", "Rename")}
              </button>
            </div>
          )}

          {measurementReadings.length > 0 && (
            <div className="measurement-tray">
              <div className="measurement-header">
                <div>
                  <span>{t("ИЗМЕРЕНИЯ", "MEASUREMENTS")}</span>
                  <b>{t("По текущему чертежу", "Current drawing")}</b>
                </div>
                <button
                  onClick={() => setMeasurements([])}
                  aria-label={t("Очистить измерения", "Clear measurements")}
                  title={t("Очистить измерения", "Clear measurements")}
                >
                  ×
                </button>
              </div>
              {measurementReadings.map((measurement) => (
                <div className="measurement-row" key={measurement.id}>
                  <i style={{ background: measurement.color }} />
                  <span>{measurement.label}</span>
                  <b>{measurement.value}</b>
                  <button
                    onClick={() =>
                      setMeasurements((current) =>
                        current.filter((item) => item.id !== measurement.id),
                      )
                    }
                    aria-label={t(
                      `Удалить измерение ${measurement.label}`,
                      `Delete measurement ${measurement.label}`,
                    )}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="canvas-controls">
            <button
              onClick={() =>
                setView((current) => ({
                  ...current,
                  scale: Math.min(180, current.scale * 1.2),
                }))
              }
              aria-label={t("Приблизить", "Zoom in")}
            >
              +
            </button>
            <button
              onClick={() =>
                setView((current) => ({
                  ...current,
                  scale: Math.max(28, current.scale / 1.2),
                }))
              }
              aria-label={t("Отдалить", "Zoom out")}
            >
              −
            </button>
            <button
              onClick={fitDrawing}
              aria-label={t("Показать весь чертёж", "Fit drawing")}
            >
              ⌗
            </button>
          </div>

          <div className="canvas-status">
            <span>{t(`${points.length} точек`, `${points.length} points`)}</span>
            <i />
            <span>{t(`${shapes.length} фигур`, `${shapes.length} shapes`)}</span>
            <i />
            <span>
              {t("масштаб", "zoom")} {Math.round((view.scale / 74) * 100)}%
            </span>
          </div>
        </section>

        <aside className="solver-panel">
          <div className="solver-header">
            <div>
              <span className="eyebrow">{t("РЕШАТЕЛЬ", "SOLVER")}</span>
              <h2>{t("Ход решения", "Solution steps")}</h2>
            </div>
            <button
              onClick={() => {
                setRightOpen(false);
                setMobilePanel("canvas");
              }}
              aria-label={t("Закрыть решение", "Close solution")}
            >
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
                    .filter((item) => item.parsed)
                    .map((item) => (
                      <div className="equation" key={item.id}>
                        <i style={{ background: item.color }} />
                        <code>{equationText(item.parsed as ParsedConstraint)}</code>
                      </div>
                    ))}
                  {!parsedKnown.some((item) => item.parsed) && (
                    <div className="empty-equations">
                      {t("Добавьте хотя бы одно условие", "Add at least one condition")}
                    </div>
                  )}
                </div>
                <span className="equation-count">
                  {
                    parsedKnown.filter(
                      (item) => item.parsed && item.parsed.kind !== "definition",
                    ).length
                  }{" "}
                  {t("ограничений", "constraints")} ·{" "}
                  {
                    parsedKnown.filter(
                      (item) => item.parsed?.kind === "definition",
                    ).length
                  }{" "}
                  {t("переменных", "variables")} ·{" "}
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
                    "Несколько стартовых приближений, минимизация общей невязки и проверка каждого ограничения.",
                    "Multiple starting approximations, total residual minimization and a check of every constraint.",
                  )}
                </p>
                <div className="method-pills">
                  <span>multi-start</span>
                  <span>{t("градиент", "gradient")}</span>
                </div>
              </div>
            </div>

            <div className="solve-step final-step">
              <div
                className={`step-marker ${
                  result.kind === "approximate" ? "warning" : "complete"
                }`}
              >
                {result.kind === "dirty" ? "…" : result.kind === "approximate" ? "!" : "✓"}
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
                      <small>{formatNumber(result.elapsed)} мс</small>
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
                    <b>{t("Противоречивые условия", "Conflicting conditions")}</b>
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
            <button className="solve-button" onClick={runSolver} disabled={solving}>
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

        {!rightOpen && (
          <button
            className="reopen-panel right"
            onClick={() => setRightOpen(true)}
            aria-label={t("Открыть решение", "Open solution")}
          >
            ‹
          </button>
        )}
      </section>
      {settingsOpen && (
        <SettingsDialog
          locale={locale}
          theme={theme}
          showCongruenceMarks={showCongruenceMarks}
          showAngles={showAngles}
          showToolHint={showToolHint}
          solverEpsilonInput={solverEpsilonInput}
          solverEpsilonValid={solverEpsilonValid}
          bareAngleUnit={bareAngleUnit}
          decimalDigits={decimalDigits}
          onLocaleChange={setLocale}
          onThemeChange={selectTheme}
          onShowCongruenceMarksChange={setShowCongruenceMarks}
          onShowAnglesChange={setShowAngles}
          onShowToolHintChange={setShowToolHint}
          onSolverEpsilonInputChange={(value) => {
            setSolverEpsilonInput(value);
            markDirty();
          }}
          onSolverEpsilonInputBlur={() =>
            setSolverEpsilonInput(String(solverEpsilon))
          }
          onBareAngleUnitChange={(unit) => {
            setBareAngleUnit(unit);
            markDirty();
          }}
          onDecimalDigitsChange={setDecimalDigits}
          onExport={exportDrawing}
          onImport={() => {
            setSettingsOpen(false);
            window.setTimeout(() => importInputRef.current?.click(), 0);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {helpOpen && (
        <HelpDialog
          tools={tools}
          locale={locale}
          onClose={() => setHelpOpen(false)}
        />
      )}
    </main>
  );
}
