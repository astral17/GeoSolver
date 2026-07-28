import type { Locale } from "./i18n";

const ENGLISH_TOOLS: Record<string, { label: string; hint: string }> = {
  select: {
    label: "Move",
    hint: "Drag points or an empty area",
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
  segment: { label: "Segment", hint: "Select two points" },
  line: { label: "Line", hint: "Select two points" },
  ray: {
    label: "Ray",
    hint: "Select the origin and a direction point",
  },
  circle: {
    label: "Circle",
    hint: "Select the center and a point on the circle",
  },
  ellipse: {
    label: "Ellipse",
    hint: "Select the center and the ends of two semiaxes",
  },
  sector: {
    label: "Sector",
    hint: "Select the center and two points on the minor arc",
  },
  majorSector: {
    label: "Major sector",
    hint: "Select the center and two points; the angle is greater than 180°",
  },
  circularSegment: {
    label: "Circular segment",
    hint: "Select the center and the chord endpoints",
  },
  polygon: {
    label: "Polygon",
    hint: "Select vertices; click a selected point to close",
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
  square: {
    label: "Square",
    hint: "Select four vertices in order",
  },
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
    hint: "Select existing vertices; drag the canvas to pan",
  },
};

const ENGLISH_GROUPS: Record<string, string> = {
  circles: "Circles",
  polygons: "Polygons",
  triangles: "Triangles",
  quadrilaterals: "Quadrilaterals",
};

export function localizeTools<
  T extends { id: string; label: string; hint: string },
>(tools: T[], locale: Locale): T[] {
  if (locale === "ru") return tools;
  return tools.map((tool) => ({
    ...tool,
    ...(ENGLISH_TOOLS[tool.id] ?? {}),
  }));
}

export function localizeToolGroups<T extends { id: string; label: string }>(
  groups: T[],
  locale: Locale,
): T[] {
  if (locale === "ru") return groups;
  return groups.map((group) => ({
    ...group,
    label: ENGLISH_GROUPS[group.id] ?? group.label,
  }));
}
