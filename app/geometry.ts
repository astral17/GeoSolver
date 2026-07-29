import type { GeometryKind, Point, Shape } from "./domain";

export function pointMap(points: Point[]) {
  return new Map(points.map((point) => [point.id, point]));
}

export function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function angleDegrees(a: Point, b: Point, c: Point) {
  const ux = a.x - b.x;
  const uy = a.y - b.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const denominator = Math.max(
    Math.hypot(ux, uy) * Math.hypot(vx, vy),
    1e-9,
  );
  const cosine = Math.max(
    -1,
    Math.min(1, (ux * vx + uy * vy) / denominator),
  );
  return (Math.acos(cosine) * 180) / Math.PI;
}

export function resolveArcEnd(
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

export function isAngleOnArc(
  start: number,
  end: number,
  angle: number,
) {
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

export function traceRightAngleMarker(
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

export function polygonArea(points: Point[]) {
  if (points.length < 3) return 0;
  const doubledArea = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - point.y * next.x;
  }, 0);
  return Math.abs(doubledArea) / 2;
}

export function polygonPerimeter(points: Point[]) {
  if (points.length < 2) return 0;
  return points.reduce(
    (sum, point, index) =>
      sum + distance(point, points[(index + 1) % points.length]),
    0,
  );
}

function circularArcRadians(
  points: Point[],
  arc: "minor" | "major" = "minor",
) {
  if (points.length < 3) return Number.NaN;
  const [center, startPoint, endPoint] = points;
  const start = Math.atan2(
    startPoint.y - center.y,
    startPoint.x - center.x,
  );
  const rawEnd = Math.atan2(
    endPoint.y - center.y,
    endPoint.x - center.x,
  );
  return Math.abs(resolveArcEnd(start, rawEnd, arc) - start);
}

export function matchingGeometryShape(
  geometry: GeometryKind,
  ids: string[],
  shapes: Shape[],
) {
  return shapes.find(
    (shape) =>
      shape.type === geometry &&
      shape.points.length === ids.length &&
      shape.points.every((id, index) => id === ids[index]),
  );
}

export function geometryMetric(
  measure: "area" | "perimeter",
  geometry: GeometryKind,
  points: Point[],
  arc: "minor" | "major" = "minor",
) {
  if (geometry === "polygon") {
    return measure === "area"
      ? polygonArea(points)
      : polygonPerimeter(points);
  }
  if (geometry === "circle") {
    if (points.length < 2) return Number.NaN;
    const radius = distance(points[0], points[1]);
    return measure === "area"
      ? Math.PI * radius * radius
      : 2 * Math.PI * radius;
  }
  if (geometry === "ellipse") {
    if (points.length < 3) return Number.NaN;
    const firstRadius = distance(points[0], points[1]);
    const secondRadius = distance(points[0], points[2]);
    if (measure === "area") return Math.PI * firstRadius * secondRadius;
    const sum = firstRadius + secondRadius;
    if (sum < 1e-12) return 0;
    const h =
      ((firstRadius - secondRadius) * (firstRadius - secondRadius)) /
      (sum * sum);
    return (
      Math.PI *
      sum *
      (1 + (3 * h) / (10 + Math.sqrt(Math.max(4 - 3 * h, 0))))
    );
  }
  if (points.length < 3) return Number.NaN;
  const radius =
    (distance(points[0], points[1]) + distance(points[0], points[2])) / 2;
  const angle = circularArcRadians(points, arc);
  if (!Number.isFinite(angle)) return Number.NaN;
  if (geometry === "sector") {
    return measure === "area"
      ? (radius * radius * angle) / 2
      : radius * angle + 2 * radius;
  }
  return measure === "area"
    ? (radius * radius * (angle - Math.sin(angle))) / 2
    : radius * angle + distance(points[1], points[2]);
}

export function pointToSegmentDistance(
  point: Point,
  start: Point,
  end: Point,
) {
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

export function orientation(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export function segmentsIntersect(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
) {
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

export function segmentDistance(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointToSegmentDistance(a, c, d),
    pointToSegmentDistance(b, c, d),
    pointToSegmentDistance(c, a, b),
    pointToSegmentDistance(d, a, b),
  );
}

export function nextPointId(points: Point[]) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const used = new Set(points.map((point) => point.id));
  const freeLetter = [...alphabet].find((letter) => !used.has(letter));
  if (freeLetter) return freeLetter;
  let index = points.length + 1;
  while (used.has(`P${index}`)) index += 1;
  return `P${index}`;
}

export function projectPointToSegment(
  point: Point,
  start: Point,
  end: Point,
  mode: "segment" | "line" | "ray" = "segment",
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = Math.max(dx * dx + dy * dy, 1e-9);
  const rawT =
    ((point.x - start.x) * dx + (point.y - start.y) * dy) /
    lengthSquared;
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

export function projectPointToCircle(
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

export function projectPointToArc(
  point: Point,
  center: Point,
  startPoint: Point,
  endPoint: Point,
  arc: "minor" | "major" = "minor",
) {
  const projected = projectPointToCircle(point, center, startPoint);
  const start = Math.atan2(
    startPoint.y - center.y,
    startPoint.x - center.x,
  );
  const rawEnd = Math.atan2(
    endPoint.y - center.y,
    endPoint.x - center.x,
  );
  const end = resolveArcEnd(start, rawEnd, arc);
  if (isAngleOnArc(start, end, projected.angle)) return projected;
  const endpoint =
    distance(projected, startPoint) <= distance(projected, endPoint)
      ? startPoint
      : endPoint;
  return {
    id: point.id,
    x: endpoint.x,
    y: endpoint.y,
    angle: Math.atan2(endpoint.y - center.y, endpoint.x - center.x),
  };
}

export function pointOnEllipse(
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

export function projectPointToEllipse(
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
