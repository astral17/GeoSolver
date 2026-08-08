export const CURRENT_PROJECT_FORMAT_VERSION = 7;

type ProjectData = Record<string, unknown>;
type ProjectMigration = (source: ProjectData) => ProjectData;

function isRecord(value: unknown): value is ProjectData {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const LEGACY_INTERSECTION_OBJECT =
  String.raw`(?:[A-Z]{2}|(?:segment|line|ray|circle)\s*\(\s*[A-Z]{2}\s*\))`;

export function migrateLegacyIntersectionExpression(expression: string) {
  const match = expression.match(
    new RegExp(
      String.raw`^\s*([A-Z])\s*=\s*(${LEGACY_INTERSECTION_OBJECT})\s*∩\s*(${LEGACY_INTERSECTION_OBJECT})\s*$`,
      "i",
    ),
  );
  return match
    ? `${match[1].toUpperCase()} ∈ ${match[2].trim()} ∩ ${match[3].trim()}`
    : expression;
}

function migrateExpressionRows(
  value: unknown,
  migrateExpression: (expression: string) => string,
) {
  return Array.isArray(value)
    ? value.map((row) =>
        isRecord(row) && typeof row.expression === "string"
          ? { ...row, expression: migrateExpression(row.expression) }
          : row,
      )
    : value;
}

export function migrateLegacyInsideExpression(expression: string) {
  const match = expression.match(
    /^\s*(?:inside|внутри)\s*\(\s*(.+?)\s*,\s*(.+?)\s*\)\s*$/i,
  );
  if (!match) return expression;
  const inner = match[1].trim();
  const outer = match[2].trim();
  const point = inner.match(/^[A-Z]\d*$/i);
  const polygonOuter =
    /^(?:[A-Z]\d*){3,}$/i.test(outer.replace(/\s+/g, "")) ||
    /^polygon\s*\(/i.test(outer);
  return point && !polygonOuter
    ? `point(${inner.toUpperCase()}) ∈ ${outer}`
    : `${inner} ∈ ${outer}`;
}

export function migrateLegacySectorDirections(source: ProjectData) {
  const pointCoordinates = new Map<string, { x: number; y: number }>();
  const arcRenames = new Map<string, string>();
  if (Array.isArray(source.points)) {
    source.points.forEach((point) => {
      if (
        isRecord(point) &&
        typeof point.id === "string" &&
        typeof point.x === "number" &&
        typeof point.y === "number"
      ) {
        pointCoordinates.set(point.id, { x: point.x, y: point.y });
      }
    });
  }
  const shapes = Array.isArray(source.shapes)
    ? source.shapes.map((shape) => {
        if (
          !isRecord(shape) ||
          shape.type !== "sector" ||
          !Array.isArray(shape.points) ||
          shape.points.length !== 3 ||
          !shape.points.every((id) => typeof id === "string")
        ) {
          return shape;
        }
        const [centerId, startId, endId] = shape.points as string[];
        const center = pointCoordinates.get(centerId);
        const start = pointCoordinates.get(startId);
        const end = pointCoordinates.get(endId);
        let points = [centerId, startId, endId];
        if (center && start && end) {
          const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
          const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
          const oldArc = shape.arc === "major" ? "major" : "minor";
          let oldSweep = endAngle - startAngle;
          while (oldSweep > Math.PI) oldSweep -= Math.PI * 2;
          while (oldSweep < -Math.PI) oldSweep += Math.PI * 2;
          if (oldArc === "major") {
            oldSweep += oldSweep >= 0 ? -Math.PI * 2 : Math.PI * 2;
          }
          if (oldSweep > 0) {
            points = [centerId, endId, startId];
            arcRenames.set(
              `${centerId}${startId}${endId}`.toUpperCase(),
              `${centerId}${endId}${startId}`.toUpperCase(),
            );
          }
        }
        return { ...shape, points, arc: "clockwise" };
      })
    : source.shapes;
  const migrateArcReferences = (expression: string) =>
    expression.replace(
      /\b(arc|sector)\s*\(\s*([A-Z])\s*([A-Z])\s*([A-Z])\s*\)/gi,
      (match, kind: string, center: string, start: string, end: string) => {
        const renamed = arcRenames.get(
          `${center}${start}${end}`.toUpperCase(),
        );
        return renamed ? `${kind}(${renamed})` : match;
      },
    );
  return {
    ...source,
    version: 4,
    shapes,
    known: migrateExpressionRows(source.known, migrateArcReferences),
    unknown: migrateExpressionRows(source.unknown, migrateArcReferences),
  };
}

const PROJECT_MIGRATIONS: Record<number, ProjectMigration> = {
  // Versionless projects predate explicit format tracking. Version 1 only
  // records that baseline, so no data transformation is necessary here.
  0: (source) => ({ ...source, version: 1 }),
  // In format 2, `A = X ∩ Y` means that A is the complete one-point
  // intersection. Preserve the old membership meaning explicitly with `∈`.
  1: (source) => ({
    ...source,
    version: 2,
    known: migrateExpressionRows(
      source.known,
      migrateLegacyIntersectionExpression,
    ),
    unknown: migrateExpressionRows(
      source.unknown,
      migrateLegacyIntersectionExpression,
    ),
  }),
  // Format 3 stores the selected solving strategy with the project. Existing
  // projects keep the long-standing numerical behavior.
  2: (source) => ({
    ...source,
    version: 3,
    solverMode:
      source.solverMode === "analytic" ? "analytic" : "numerical",
  }),
  // Format 4 makes sector orientation explicit and stable. A sector always
  // follows the clockwise sweep from its first radius to its second; swapping
  // those two points selects the complementary sector. Preserve the visible
  // arc of old minor/major sectors by swapping their endpoints when needed.
  3: migrateLegacySectorDirections,
  // Format 5 permits recursive editor groups through an optional
  // `parentGroupId`. Existing groups remain at the section root.
  4: (source) => ({ ...source, version: 5 }),
  // Format 6 stores one common ordering for points, figures and lines.
  5: (source) => {
    let editorOrder = 0;
    const addOrder = (value: unknown) =>
      Array.isArray(value)
        ? value.map((item) =>
            isRecord(item)
              ? { ...item, editorOrder: editorOrder++ }
              : item,
          )
        : value;
    return {
      ...source,
      version: 6,
      points: addOrder(source.points),
      shapes: addOrder(source.shapes),
    };
  },
  // Format 7 has one implicit-equation object. Equality draws a curve;
  // inequalities draw a region. It also replaces the legacy inside(A, B)
  // spelling with the common set-membership notation A ∈ B.
  6: (source) => ({
    ...source,
    version: 7,
    shapes: Array.isArray(source.shapes)
      ? source.shapes.map((shape) =>
          isRecord(shape) &&
          (shape.type === "equationLine" ||
            shape.type === "equationRegion")
            ? { ...shape, type: "equation" }
            : shape,
        )
      : source.shapes,
    known: migrateExpressionRows(
      source.known,
      migrateLegacyInsideExpression,
    ),
    unknown: migrateExpressionRows(
      source.unknown,
      migrateLegacyInsideExpression,
    ),
  }),
};

export function migrateProjectData(source: ProjectData) {
  const rawVersion = source.version;
  const version = rawVersion === undefined ? 0 : Number(rawVersion);
  if (!Number.isInteger(version) || version < 0) {
    throw new Error("Некорректная версия формата проекта GeoSolver.");
  }
  if (version > CURRENT_PROJECT_FORMAT_VERSION) {
    throw new Error(
      `Проект создан в более новой версии GeoSolver (формат ${version}).`,
    );
  }

  let migrated = source;
  let currentVersion = version;
  while (currentVersion < CURRENT_PROJECT_FORMAT_VERSION) {
    const migration = PROJECT_MIGRATIONS[currentVersion];
    if (!migration) {
      throw new Error(
        `Не найдена миграция формата GeoSolver ${currentVersion} → ${currentVersion + 1}.`,
      );
    }
    migrated = migration(migrated);
    currentVersion += 1;
  }
  return migrated;
}
