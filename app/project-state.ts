import type {
  DrawingSnapshot,
  EditorGroup,
  ExpressionRow,
  ImportedProject,
  Measurement,
  Point,
  Shape,
  SolveResult,
} from "./domain";

export const COLORS = [
  "#5b6df9",
  "#ef6b62",
  "#26a880",
  "#f0a11b",
  "#8c5ad7",
];
export const DEFAULT_PROJECT_TITLE = "Прямоугольный треугольник";
export const EMPTY_PROJECT_TITLE = {
  ru: "Новый чертёж",
  en: "New drawing",
} as const;
export const DEFAULT_SOLVER_EPSILON = 1e-6;
export const DEFAULT_SOLVER_EPSILON_INPUT = "1e-6";
export const DEFAULT_SOLVER_MAX_ITERATIONS = 1200;
export const DEFAULT_SOLVER_MAX_ITERATIONS_INPUT = "1200";
export const DEFAULT_SOLVER_TIME_LIMIT_MS = 2500;
export const DEFAULT_SOLVER_TIME_LIMIT_MS_INPUT = "2500";
export const DEFAULT_DECIMAL_DIGITS = 3;
export const SETTINGS_STORAGE_KEY = "geosolver-settings-v1";
export const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024;

export const INITIAL_POINTS: Point[] = [
  { id: "A", x: -3, y: -2 },
  { id: "B", x: 2, y: -2 },
  { id: "C", x: -3, y: 2 },
];

export const INITIAL_SHAPES: Shape[] = [
  {
    id: "shape-triangle",
    type: "polygon",
    points: ["A", "B", "C"],
    color: COLORS[0],
  },
];

export const INITIAL_MEASUREMENTS: Measurement[] = [];

export const INITIAL_KNOWN: ExpressionRow[] = [
  { id: 1, expression: "AB = 5", enabled: true, color: COLORS[0] },
  { id: 2, expression: "AC = 4", enabled: true, color: COLORS[1] },
  { id: 3, expression: "∠BAC = 90°", enabled: true, color: COLORS[2] },
];

export const INITIAL_UNKNOWN: ExpressionRow[] = [
  { id: 4, expression: "BC = ?", enabled: true, color: COLORS[3] },
];
export const INITIAL_GROUPS: EditorGroup[] = [];

export const PENDING_RESULT: SolveResult = {
  kind: "dirty",
  residual: 0,
  elapsed: 0,
  iterations: 0,
  timedOut: false,
  values: [],
  issues: [],
};

export function parseSolverEpsilon(value: string | number) {
  const parsed =
    typeof value === "number"
      ? value
      : Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1
    ? parsed
    : DEFAULT_SOLVER_EPSILON;
}

export function parseSolverLimit(
  value: string | number,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed =
    typeof value === "number"
      ? value
      : Number(value.trim().replace(",", "."));
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
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
    Math.abs(value.y) <= 1_000_000 &&
    (value.visible === undefined || typeof value.visible === "boolean") &&
    (value.groupId === undefined || typeof value.groupId === "string")
  );
}

function isImportedShape(value: unknown): value is Shape {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !Array.isArray(value.points) ||
    !value.points.every((id) => typeof id === "string") ||
    !isSafeColor(value.color) ||
    (value.visible !== undefined && typeof value.visible !== "boolean") ||
    (value.groupId !== undefined && typeof value.groupId !== "string")
  ) {
    return false;
  }
  const type = String(value.type);
  if (
    ![
      "segment",
      "line",
      "ray",
      "polyline",
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
  if (type === "polyline") return value.points.length >= 2;
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
    (value.shapeId === undefined || typeof value.shapeId === "string") &&
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
    isSafeColor(value.color) &&
    (value.groupId === undefined || typeof value.groupId === "string")
  );
}

function isImportedGroup(value: unknown): value is EditorGroup {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    value.id.length <= 120 &&
    ["objects", "known", "unknown"].includes(String(value.section)) &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    value.name.length <= 80 &&
    (value.collapsed === undefined || typeof value.collapsed === "boolean") &&
    (value.anchorId === undefined ||
      (typeof value.anchorId === "string" && value.anchorId.length <= 120)) &&
    (value.anchorSide === undefined ||
      value.anchorSide === "before" ||
      value.anchorSide === "after")
  );
}

export function cloneSnapshot(
  snapshot: DrawingSnapshot,
): DrawingSnapshot {
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
    groups: snapshot.groups.map((group) => ({ ...group })),
  };
}

export function snapshotKey(snapshot: DrawingSnapshot) {
  return JSON.stringify(snapshot);
}

export function parseImportedProject(source: string): ImportedProject {
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
  const groups = data.groups ?? [];
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
    !Array.isArray(groups) ||
    groups.length > 1000 ||
    !groups.every(isImportedGroup) ||
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
  const groupIds = new Set(groups.map((group) => group.id));
  if (
    pointIds.size !== data.points.length ||
    groupIds.size !== groups.length ||
    data.shapes.some((shape) =>
      shape.points.some((pointId) => !pointIds.has(pointId)),
    ) ||
    measurements.some((measurement) =>
      measurement.points.some((pointId) => !pointIds.has(pointId)),
    ) ||
    data.points.some(
      (point) =>
        point.groupId &&
        !groups.some(
          (group) =>
            group.id === point.groupId && group.section === "objects",
        ),
    ) ||
    data.shapes.some(
      (shape) =>
        shape.groupId &&
        !groups.some(
          (group) =>
            group.id === shape.groupId && group.section === "objects",
        ),
    ) ||
    data.known.some(
      (row) =>
        row.groupId &&
        !groups.some(
          (group) =>
            group.id === row.groupId && group.section === "known",
        ),
    ) ||
    data.unknown.some(
      (row) =>
        row.groupId &&
        !groups.some(
          (group) =>
            group.id === row.groupId && group.section === "unknown",
        ),
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
  const iterationCandidate =
    typeof data.solverMaxIterations === "string" ||
    typeof data.solverMaxIterations === "number"
      ? data.solverMaxIterations
      : DEFAULT_SOLVER_MAX_ITERATIONS_INPUT;
  const solverMaxIterations = String(
    parseSolverLimit(
      iterationCandidate,
      DEFAULT_SOLVER_MAX_ITERATIONS,
      1,
      100_000,
    ),
  );
  const timeLimitCandidate =
    typeof data.solverTimeLimitMs === "string" ||
    typeof data.solverTimeLimitMs === "number"
      ? data.solverTimeLimitMs
      : DEFAULT_SOLVER_TIME_LIMIT_MS_INPUT;
  const solverTimeLimitMs = String(
    parseSolverLimit(
      timeLimitCandidate,
      DEFAULT_SOLVER_TIME_LIMIT_MS,
      50,
      60_000,
    ),
  );
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
      groups,
    }),
    solverEpsilon,
    solverMaxIterations,
    solverTimeLimitMs,
    view,
  };
}
