import type { Locale } from "./i18n";

export type ToolId =
  | "select"
  | "marquee"
  | "point"
  | "pointOnSegment"
  | "intersectionPoint"
  | "segment"
  | "line"
  | "ray"
  | "polyline"
  | "circle"
  | "ellipse"
  | "sector"
  | "circularSegment"
  | "polygon"
  | "crossedPolygon"
  | "regularPolygon"
  | "triangle"
  | "rightTriangle"
  | "isoscelesTriangle"
  | "equilateralTriangle"
  | "quadrilateral"
  | "square"
  | "rectangle"
  | "parallelogram"
  | "trapezoid"
  | "rhombus"
  | "length"
  | "angle"
  | "area"
  | "setLength"
  | "setAngle"
  | "setArea";

export type ToolGroupId =
  | "linear"
  | "circles"
  | "polygons"
  | "triangles"
  | "quadrilaterals"
  | "constraints";

export type ToolDefinition = {
  id: ToolId;
  label: string;
  icon: string;
  hint: string;
  shortcut: string;
  code: string;
};

export type ToolGroupDefinition = {
  id: ToolGroupId;
  label: string;
  icon: string;
  shortcut: string;
  code: string;
  toolIds: ToolId[];
};

export const TOOLS: ToolDefinition[] = [
  {
    id: "select",
    label: "Переместить",
    icon: "↖",
    hint: "Тяните точки; повторный клик переключает совпадающие",
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
    hint:
      "Кликните по границе отрезка, линии, окружности, эллипса или фигуры",
    shortcut: "O",
    code: "KeyO",
  },
  {
    id: "intersectionPoint",
    label: "Точка пересечения",
    icon: "⊗",
    hint: "Кликните рядом с двумя линиями или выберите их двумя кликами",
    shortcut: "I",
    code: "KeyI",
  },
  {
    id: "segment",
    label: "Отрезок",
    icon: "╱",
    hint: "Выберите две точки",
    shortcut: "1",
    code: "",
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
    id: "polyline",
    label: "Ломаная",
    icon: "⌁",
    hint: "Выбирайте вершины; нажмите последнюю точку ещё раз для завершения",
    shortcut: "4",
    code: "",
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
    hint: "Укажите два фокуса и точку на эллипсе",
    shortcut: "2",
    code: "",
  },
  {
    id: "sector",
    label: "Сектор",
    icon: "◔",
    hint: "Укажите центр, начало и конец дуги по часовой стрелке",
    shortcut: "3",
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
    label: "Многоугольник без самопересечений",
    icon: "⬠",
    hint: "Выбирайте вершины; кликните по выбранной точке, чтобы замкнуть",
    shortcut: "1",
    code: "",
  },
  {
    id: "crossedPolygon",
    label: "Многоугольник с самопересечениями",
    icon: "☆",
    hint: "Выбирайте вершины; самопересечения разрешены",
    shortcut: "2",
    code: "",
  },
  {
    id: "regularPolygon",
    label: "Правильный многоугольник",
    icon: "⬡",
    hint: "Задайте вершины по порядку и замкните выбранной точкой",
    shortcut: "3",
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
    id: "quadrilateral",
    label: "Произвольный четырёхугольник",
    icon: "▱",
    hint: "Выберите четыре вершины по порядку",
    shortcut: "1",
    code: "",
  },
  {
    id: "square",
    label: "Квадрат",
    icon: "□",
    hint: "Выберите четыре вершины по порядку",
    shortcut: "2",
    code: "",
  },
  {
    id: "rectangle",
    label: "Прямоугольник",
    icon: "▭",
    hint: "Выберите четыре вершины по порядку",
    shortcut: "3",
    code: "",
  },
  {
    id: "parallelogram",
    label: "Параллелограмм",
    icon: "▱",
    hint: "Выберите четыре вершины по порядку",
    shortcut: "4",
    code: "",
  },
  {
    id: "trapezoid",
    label: "Трапеция",
    icon: "⏢",
    hint: "Сначала выберите основание, затем второе основание",
    shortcut: "5",
    code: "",
  },
  {
    id: "rhombus",
    label: "Ромб",
    icon: "◇",
    hint: "Выберите четыре вершины по порядку",
    shortcut: "6",
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
    hint:
      "Кликните фигуру или обойдите вершины; тяните поле для перемещения",
    shortcut: "Q",
    code: "KeyQ",
  },
  {
    id: "setLength",
    label: "Задать длину",
    icon: "↔",
    hint: "Выберите две существующие точки и введите длину в условии",
    shortcut: "1",
    code: "",
  },
  {
    id: "setAngle",
    label: "Задать угол",
    icon: "∠",
    hint: "Выберите три существующие точки и введите угол в условии",
    shortcut: "2",
    code: "",
  },
  {
    id: "setArea",
    label: "Задать площадь",
    icon: "S",
    hint:
      "Обойдите вершины и нажмите последнюю точку ещё раз, затем введите площадь",
    shortcut: "3",
    code: "",
  },
];

export const TOOL_GROUPS: ToolGroupDefinition[] = [
  {
    id: "linear",
    label: "Линии",
    icon: "╱",
    shortcut: "S",
    code: "KeyS",
    toolIds: ["segment", "line", "ray", "polyline"],
  },
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
      "circularSegment",
    ],
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
    shortcut: "F",
    code: "KeyF",
    toolIds: [
      "quadrilateral",
      "square",
      "rectangle",
      "parallelogram",
      "trapezoid",
      "rhombus",
    ],
  },
  {
    id: "polygons",
    label: "Многоугольники",
    icon: "⬠",
    shortcut: "G",
    code: "KeyG",
    toolIds: ["polygon", "crossedPolygon", "regularPolygon"],
  },
  {
    id: "constraints",
    label: "Задать условие",
    icon: "=",
    shortcut: "E",
    code: "KeyE",
    toolIds: ["setLength", "setAngle", "setArea"],
  },
];

export const TOOL_RAIL_ITEMS: (
  | { kind: "tool"; id: ToolId }
  | { kind: "group"; id: ToolGroupId }
)[] = [
  { kind: "tool", id: "select" },
  { kind: "tool", id: "marquee" },
  { kind: "tool", id: "point" },
  { kind: "tool", id: "pointOnSegment" },
  { kind: "tool", id: "intersectionPoint" },
  { kind: "group", id: "linear" },
  { kind: "group", id: "circles" },
  { kind: "group", id: "triangles" },
  { kind: "group", id: "quadrilaterals" },
  { kind: "group", id: "polygons" },
  { kind: "group", id: "constraints" },
  { kind: "tool", id: "length" },
  { kind: "tool", id: "angle" },
  { kind: "tool", id: "area" },
];

const ENGLISH_TOOLS: Record<
  ToolId,
  { label: string; hint: string }
> = {
  select: {
    label: "Move",
    hint: "Drag points; click again to cycle overlapping points",
  },
  marquee: {
    label: "Area selection",
    hint: "Draw a box around points, then drag or delete them",
  },
  point: { label: "Point", hint: "Click the canvas" },
  pointOnSegment: {
    label: "Point on object",
    hint: "Click the boundary of a segment, line, circle, ellipse or shape",
  },
  intersectionPoint: {
    label: "Intersection point",
    hint: "Click near both lines, or select them with two clicks",
  },
  segment: { label: "Segment", hint: "Select two points" },
  line: { label: "Line", hint: "Select two points" },
  ray: {
    label: "Ray",
    hint: "Select the origin and a direction point",
  },
  polyline: {
    label: "Polyline",
    hint: "Select vertices; click the last point again to finish",
  },
  circle: {
    label: "Circle",
    hint: "Select the center and a point on the circle",
  },
  ellipse: {
    label: "Ellipse",
    hint: "Select two foci and a point on the ellipse",
  },
  sector: {
    label: "Sector",
    hint: "Select the center, then the arc start and clockwise end",
  },
  circularSegment: {
    label: "Circular segment",
    hint: "Select the center and the chord endpoints",
  },
  polygon: {
    label: "Non-self-intersecting polygon",
    hint: "Select vertices; click a selected point to close",
  },
  crossedPolygon: {
    label: "Self-intersecting polygon",
    hint: "Select vertices; self-intersections are allowed",
  },
  regularPolygon: {
    label: "Regular polygon",
    hint: "Select vertices in order and close on a selected point",
  },
  triangle: {
    label: "Arbitrary triangle",
    hint: "Select three vertices",
  },
  rightTriangle: {
    label: "Right triangle",
    hint: "Select the right-angle vertex, then the other two",
  },
  isoscelesTriangle: {
    label: "Isosceles triangle",
    hint: "Select the apex, then the two base points",
  },
  equilateralTriangle: {
    label: "Equilateral triangle",
    hint: "Select three vertices",
  },
  quadrilateral: {
    label: "Arbitrary quadrilateral",
    hint: "Select four vertices in order",
  },
  square: { label: "Square", hint: "Select four vertices in order" },
  rectangle: {
    label: "Rectangle",
    hint: "Select four vertices in order",
  },
  parallelogram: {
    label: "Parallelogram",
    hint: "Select four vertices in order",
  },
  trapezoid: {
    label: "Trapezoid",
    hint: "Select one base first, then the other base",
  },
  rhombus: {
    label: "Rhombus",
    hint: "Select four vertices in order",
  },
  length: {
    label: "Measure length",
    hint: "Select two existing points; drag the canvas to pan",
  },
  angle: {
    label: "Measure angle",
    hint: "Select three existing points; drag the canvas to pan",
  },
  area: {
    label: "Measure area",
    hint: "Click a shape or select its vertices; drag the canvas to pan",
  },
  setLength: {
    label: "Set length",
    hint: "Select two existing points, then enter the length in the condition",
  },
  setAngle: {
    label: "Set angle",
    hint: "Select three existing points, then enter the angle in the condition",
  },
  setArea: {
    label: "Set area",
    hint: "Select vertices and click the last point again, then enter the area",
  },
};

const ENGLISH_GROUPS: Record<ToolGroupId, string> = {
  linear: "Lines",
  circles: "Circles",
  polygons: "Polygons",
  triangles: "Triangles",
  quadrilaterals: "Quadrilaterals",
  constraints: "Set condition",
};

export function localizeTools(
  tools: ToolDefinition[],
  locale: Locale,
): ToolDefinition[] {
  if (locale === "ru") return tools;
  return tools.map((tool) => ({
    ...tool,
    ...ENGLISH_TOOLS[tool.id],
  }));
}

export function localizeToolGroups(
  groups: ToolGroupDefinition[],
  locale: Locale,
): ToolGroupDefinition[] {
  if (locale === "ru") return groups;
  return groups.map((group) => ({
    ...group,
    label: ENGLISH_GROUPS[group.id],
  }));
}

export function polygonConstraintExpressions(
  ids: string[],
  regular = false,
  allowSelfIntersections = false,
) {
  if (ids.length < 3) return [];
  const expressions = [`distinct(${ids.join("")})`];
  const edges = ids.map(
    (id, index) => `${id}${ids[(index + 1) % ids.length]}`,
  );
  if (!regular && !allowSelfIntersections) {
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
  }
  if (regular) {
    expressions.push(`convex(${ids.join("")})`);
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
export function quadrilateralConstraintExpressions(
  tool:
    | "quadrilateral"
    | "square"
    | "rectangle"
    | "parallelogram"
    | "trapezoid"
    | "rhombus",
  ids: string[],
) {
  const [a, b, c, d] = ids;
  const expressions = polygonConstraintExpressions(ids);
  if (tool === "quadrilateral") {
    return expressions;
  }
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
