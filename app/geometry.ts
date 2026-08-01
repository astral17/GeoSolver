import type { ArcMode, GeometryKind, Point, Shape } from "./domain";

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
  arc: ArcMode = "minor",
  clockwisePositive = false,
) {
  let delta = rawEnd - start;
  if (arc === "clockwise") {
    if (clockwisePositive) {
      while (delta < 0) delta += Math.PI * 2;
      while (delta >= Math.PI * 2) delta -= Math.PI * 2;
    } else {
      while (delta > 0) delta -= Math.PI * 2;
      while (delta <= -Math.PI * 2) delta += Math.PI * 2;
    }
    return start + delta;
  }
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
  let turnSign = 0;
  let convex = true;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const c = points[(index + 2) % points.length];
    const turn = (b.x - a.x) * (c.y - a.y) -
      (b.y - a.y) * (c.x - a.x);
    if (Math.abs(turn) <= 1e-12) continue;
    const nextSign = Math.sign(turn);
    if (turnSign && nextSign !== turnSign) {
      convex = false;
      break;
    }
    turnSign = nextSign;
  }
  if (convex) return Math.abs(doubledArea) / 2;

  const criticalY = points.map((point) => point.y);
  let selfIntersects = false;
  for (let first = 0; first < points.length; first += 1) {
    const firstEndIndex = (first + 1) % points.length;
    const firstStart = points[first];
    const firstEnd = points[firstEndIndex];
    for (let second = first + 1; second < points.length; second += 1) {
      const secondEndIndex = (second + 1) % points.length;
      if (
        first === second ||
        firstEndIndex === second ||
        secondEndIndex === first
      ) {
        continue;
      }
      const secondStart = points[second];
      const secondEnd = points[secondEndIndex];
      const firstX = firstEnd.x - firstStart.x;
      const firstY = firstEnd.y - firstStart.y;
      const secondX = secondEnd.x - secondStart.x;
      const secondY = secondEnd.y - secondStart.y;
      const denominator = firstX * secondY - firstY * secondX;
      if (Math.abs(denominator) <= 1e-12) continue;
      const offsetX = secondStart.x - firstStart.x;
      const offsetY = secondStart.y - firstStart.y;
      const firstT =
        (offsetX * secondY - offsetY * secondX) / denominator;
      const secondT =
        (offsetX * firstY - offsetY * firstX) / denominator;
      if (
        firstT > 1e-10 &&
        firstT < 1 - 1e-10 &&
        secondT > 1e-10 &&
        secondT < 1 - 1e-10
      ) {
        selfIntersects = true;
        criticalY.push(firstStart.y + firstY * firstT);
      }
    }
  }
  if (!selfIntersects) return Math.abs(doubledArea) / 2;

  const levels = [...criticalY]
    .sort((first, second) => first - second)
    .filter(
      (value, index, values) =>
        index === 0 || Math.abs(value - values[index - 1]) > 1e-10,
    );
  let area = 0;
  for (let level = 0; level + 1 < levels.length; level += 1) {
    const lower = levels[level];
    const upper = levels[level + 1];
    if (upper - lower <= 1e-12) continue;
    const y = (lower + upper) / 2;
    const crossings: number[] = [];
    points.forEach((start, index) => {
      const end = points[(index + 1) % points.length];
      if ((start.y < y && end.y > y) || (end.y < y && start.y > y)) {
        crossings.push(
          start.x +
            ((y - start.y) * (end.x - start.x)) / (end.y - start.y),
        );
      }
    });
    crossings.sort((first, second) => first - second);
    let filledWidth = 0;
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      filledWidth += crossings[index + 1] - crossings[index];
    }
    area += filledWidth * (upper - lower);
  }
  return area;
}

export function polygonPerimeter(points: Point[]) {
  if (points.length < 2) return 0;
  return points.reduce(
    (sum, point, index) =>
      sum + distance(point, points[(index + 1) % points.length]),
    0,
  );
}

export function ellipseGeometry(
  firstFocus: Point,
  secondFocus: Point,
  boundaryPoint: Point,
) {
  const center = {
    id: "",
    x: (firstFocus.x + secondFocus.x) / 2,
    y: (firstFocus.y + secondFocus.y) / 2,
  };
  const focalRadius = distance(firstFocus, secondFocus) / 2;
  const radiusX = Math.max(
    (distance(boundaryPoint, firstFocus) +
      distance(boundaryPoint, secondFocus)) /
      2,
    focalRadius + 1e-9,
  );
  const radiusY = Math.sqrt(
    Math.max(radiusX * radiusX - focalRadius * focalRadius, 1e-18),
  );
  const rotation =
    focalRadius > 1e-9
      ? Math.atan2(
          secondFocus.y - firstFocus.y,
          secondFocus.x - firstFocus.x,
        )
      : Math.atan2(
          boundaryPoint.y - center.y,
          boundaryPoint.x - center.x,
        );
  return { center, radiusX, radiusY, rotation };
}

function circularArcRadians(
  points: Point[],
  arc: ArcMode = "minor",
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
  arc: ArcMode = "minor",
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
    const {
      radiusX: firstRadius,
      radiusY: secondRadius,
    } = ellipseGeometry(points[0], points[1], points[2]);
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
  arc: ArcMode = "minor",
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
  firstFocus: Point,
  secondFocus: Point,
  boundaryPoint: Point,
  angle: number,
  id = "",
) {
  const { center, radiusX, radiusY, rotation } = ellipseGeometry(
    firstFocus,
    secondFocus,
    boundaryPoint,
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
  firstFocus: Point,
  secondFocus: Point,
  boundaryPoint: Point,
) {
  const { center, radiusX, radiusY, rotation } = ellipseGeometry(
    firstFocus,
    secondFocus,
    boundaryPoint,
  );
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const localX = dx * Math.cos(rotation) + dy * Math.sin(rotation);
  const localY = -dx * Math.sin(rotation) + dy * Math.cos(rotation);
  const angle = Math.atan2(localY / radiusY, localX / radiusX);
  return pointOnEllipse(
    firstFocus,
    secondFocus,
    boundaryPoint,
    angle,
    point.id,
  );
}

export function linearIntersection(
  firstStart: Point,
  firstEnd: Point,
  firstKind: "segment" | "line" | "ray",
  secondStart: Point,
  secondEnd: Point,
  secondKind: "segment" | "line" | "ray",
) {
  const firstX = firstEnd.x - firstStart.x;
  const firstY = firstEnd.y - firstStart.y;
  const secondX = secondEnd.x - secondStart.x;
  const secondY = secondEnd.y - secondStart.y;
  const denominator = firstX * secondY - firstY * secondX;
  if (Math.abs(denominator) < 1e-12) return null;
  const offsetX = secondStart.x - firstStart.x;
  const offsetY = secondStart.y - firstStart.y;
  const firstT = (offsetX * secondY - offsetY * secondX) / denominator;
  const secondT = (offsetX * firstY - offsetY * firstX) / denominator;
  const accepts = (kind: "segment" | "line" | "ray", value: number) =>
    kind === "line" ||
    (kind === "ray" ? value >= -1e-9 : value >= -1e-9 && value <= 1 + 1e-9);
  if (!accepts(firstKind, firstT) || !accepts(secondKind, secondT)) {
    return null;
  }
  return {
    x: firstStart.x + firstX * firstT,
    y: firstStart.y + firstY * firstT,
  };
}

export function circleLinearIntersections(
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
  const intersections: Array<{ x: number; y: number }> = [];
  values.filter(accepts).forEach((value) => {
    const point = {
      x: start.x + dx * value,
      y: start.y + dy * value,
    };
    if (
      intersections.every(
        (candidate) =>
          Math.hypot(candidate.x - point.x, candidate.y - point.y) > 1e-7,
      )
    ) {
      intersections.push(point);
    }
  });
  return intersections;
}

export function sampleGeometryBoundary(
  geometry: GeometryKind,
  points: Point[],
  arc: ArcMode = "minor",
  sampleCount = 24,
) {
  if (geometry === "polygon") {
    return points.flatMap((point, index) => {
      const next = points[(index + 1) % points.length];
      return Array.from({ length: 4 }, (_, step) => ({
        id: "",
        x: point.x + ((next.x - point.x) * step) / 4,
        y: point.y + ((next.y - point.y) * step) / 4,
      }));
    });
  }
  if (geometry === "circle" && points.length >= 2) {
    const radius = distance(points[0], points[1]);
    return Array.from({ length: sampleCount }, (_, index) => {
      const angle = (index / sampleCount) * Math.PI * 2;
      return {
        id: "",
        x: points[0].x + Math.cos(angle) * radius,
        y: points[0].y + Math.sin(angle) * radius,
      };
    });
  }
  if (geometry === "ellipse" && points.length >= 3) {
    return Array.from({ length: sampleCount }, (_, index) =>
      pointOnEllipse(
        points[0],
        points[1],
        points[2],
        (index / sampleCount) * Math.PI * 2,
      ),
    );
  }
  if (points.length < 3) return [];
  const [center, startPoint, endPoint] = points;
  const start = Math.atan2(
    startPoint.y - center.y,
    startPoint.x - center.x,
  );
  const rawEnd = Math.atan2(
    endPoint.y - center.y,
    endPoint.x - center.x,
  );
  const end = resolveArcEnd(start, rawEnd, arc);
  const radius = distance(center, startPoint);
  const arcPoints = Array.from({ length: sampleCount + 1 }, (_, index) => {
    const angle = start + ((end - start) * index) / sampleCount;
    return {
      id: "",
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
  });
  return geometry === "sector" ? [center, ...arcPoints] : arcPoints;
}

export function pointInPolygon(point: Point, polygon: Point[]) {
  if (polygon.length < 3) return false;
  for (let index = 0; index < polygon.length; index += 1) {
    if (
      pointToSegmentDistance(
        point,
        polygon[index],
        polygon[(index + 1) % polygon.length],
      ) <= 1e-9
    ) {
      return true;
    }
  }
  let inside = false;
  for (
    let first = 0, second = polygon.length - 1;
    first < polygon.length;
    second = first++
  ) {
    const a = polygon[first];
    const b = polygon[second];
    const crosses =
      a.y > point.y !== b.y > point.y &&
      point.x <
        ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function cleanPolygon(points: Point[]) {
  const cleaned: Point[] = [];
  points.forEach((point) => {
    const previous = cleaned.at(-1);
    if (!previous || distance(previous, point) > 1e-9) {
      cleaned.push({ ...point });
    }
  });
  if (
    cleaned.length > 1 &&
    distance(cleaned[0], cleaned[cleaned.length - 1]) <= 1e-9
  ) {
    cleaned.pop();
  }
  return cleaned;
}

function signedPolygonArea(points: Point[]) {
  return (
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return sum + point.x * next.y - point.y * next.x;
    }, 0) / 2
  );
}

function isConvexPolygon(points: Point[]) {
  if (points.length < 3) return false;
  let sign = 0;
  for (let index = 0; index < points.length; index += 1) {
    const turn = orientation(
      points[index],
      points[(index + 1) % points.length],
      points[(index + 2) % points.length],
    );
    if (Math.abs(turn) <= 1e-9) continue;
    const nextSign = Math.sign(turn);
    if (sign && nextSign !== sign) return false;
    sign = nextSign;
  }
  return sign !== 0;
}

function lineIntersectionPoint(
  firstStart: Point,
  firstEnd: Point,
  secondStart: Point,
  secondEnd: Point,
) {
  const firstX = firstEnd.x - firstStart.x;
  const firstY = firstEnd.y - firstStart.y;
  const secondX = secondEnd.x - secondStart.x;
  const secondY = secondEnd.y - secondStart.y;
  const denominator = firstX * secondY - firstY * secondX;
  if (Math.abs(denominator) < 1e-12) return { ...firstEnd };
  const offsetX = secondStart.x - firstStart.x;
  const offsetY = secondStart.y - firstStart.y;
  const t = (offsetX * secondY - offsetY * secondX) / denominator;
  return {
    id: "",
    x: firstStart.x + firstX * t,
    y: firstStart.y + firstY * t,
  };
}

function clipByConvexPolygon(subject: Point[], clip: Point[]) {
  let output = cleanPolygon(subject);
  const clipSign = signedPolygonArea(clip) >= 0 ? 1 : -1;
  for (let edge = 0; edge < clip.length && output.length; edge += 1) {
    const edgeStart = clip[edge];
    const edgeEnd = clip[(edge + 1) % clip.length];
    const input = output;
    output = [];
    const inside = (point: Point) =>
      clipSign * orientation(edgeStart, edgeEnd, point) >= -1e-9;
    for (let index = 0; index < input.length; index += 1) {
      const current = input[index];
      const previous = input[(index - 1 + input.length) % input.length];
      const currentInside = inside(current);
      const previousInside = inside(previous);
      if (currentInside !== previousInside) {
        output.push(
          lineIntersectionPoint(previous, current, edgeStart, edgeEnd),
        );
      }
      if (currentInside) output.push(current);
    }
    output = cleanPolygon(output);
  }
  return output;
}

function pointInTriangle(point: Point, a: Point, b: Point, c: Point) {
  const first = orientation(a, b, point);
  const second = orientation(b, c, point);
  const third = orientation(c, a, point);
  const hasNegative = first < -1e-9 || second < -1e-9 || third < -1e-9;
  const hasPositive = first > 1e-9 || second > 1e-9 || third > 1e-9;
  return !(hasNegative && hasPositive);
}

function triangulatePolygon(source: Point[]) {
  const polygon = cleanPolygon(source);
  if (polygon.length < 3) return [];
  const points =
    signedPolygonArea(polygon) >= 0 ? polygon : [...polygon].reverse();
  const remaining = points.map((_, index) => index);
  const triangles: Point[][] = [];
  let guard = points.length * points.length;
  while (remaining.length > 3 && guard > 0) {
    guard -= 1;
    let clipped = false;
    for (let index = 0; index < remaining.length; index += 1) {
      const previousIndex = remaining[
        (index - 1 + remaining.length) % remaining.length
      ];
      const currentIndex = remaining[index];
      const nextIndex = remaining[(index + 1) % remaining.length];
      const a = points[previousIndex];
      const b = points[currentIndex];
      const c = points[nextIndex];
      if (orientation(a, b, c) <= 1e-10) continue;
      if (
        remaining.some(
          (candidate) =>
            candidate !== previousIndex &&
            candidate !== currentIndex &&
            candidate !== nextIndex &&
            pointInTriangle(points[candidate], a, b, c),
        )
      ) {
        continue;
      }
      triangles.push([a, b, c]);
      remaining.splice(index, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (remaining.length === 3) {
    triangles.push(remaining.map((index) => points[index]));
  }
  return triangles;
}

function polygonIntersectionArea(first: Point[], second: Point[]) {
  const a = cleanPolygon(first);
  const b = cleanPolygon(second);
  if (a.length < 3 || b.length < 3) return 0;
  if (isConvexPolygon(a) && isConvexPolygon(b)) {
    return polygonArea(clipByConvexPolygon(a, b));
  }
  const firstTriangles = triangulatePolygon(a);
  const secondTriangles = triangulatePolygon(b);
  return firstTriangles.reduce(
    (sum, firstTriangle) =>
      sum +
      secondTriangles.reduce(
        (innerSum, secondTriangle) =>
          innerSum +
          polygonArea(
            clipByConvexPolygon(firstTriangle, secondTriangle),
          ),
        0,
      ),
    0,
  );
}

function geometryAreaPolygon(
  geometry: GeometryKind,
  points: Point[],
  arc: ArcMode,
  sampleCount: number,
) {
  return cleanPolygon(
    geometry === "polygon"
      ? points
      : sampleGeometryBoundary(geometry, points, arc, sampleCount),
  );
}

export function geometryIntersectionArea(
  firstGeometry: GeometryKind,
  firstPoints: Point[],
  secondGeometry: GeometryKind,
  secondPoints: Point[],
  firstArc: ArcMode = "minor",
  secondArc: ArcMode = "minor",
  sampleCount = 64,
) {
  if (
    firstGeometry === "circle" &&
    secondGeometry === "circle" &&
    firstPoints.length >= 2 &&
    secondPoints.length >= 2
  ) {
    const firstRadius = distance(firstPoints[0], firstPoints[1]);
    const secondRadius = distance(secondPoints[0], secondPoints[1]);
    const centers = distance(firstPoints[0], secondPoints[0]);
    if (centers >= firstRadius + secondRadius) return 0;
    if (centers <= Math.abs(firstRadius - secondRadius)) {
      const radius = Math.min(firstRadius, secondRadius);
      return Math.PI * radius * radius;
    }
    const firstAngle = 2 * Math.acos(
      Math.max(
        -1,
        Math.min(
          1,
          (centers * centers + firstRadius * firstRadius - secondRadius * secondRadius) /
            (2 * centers * firstRadius),
        ),
      ),
    );
    const secondAngle = 2 * Math.acos(
      Math.max(
        -1,
        Math.min(
          1,
          (centers * centers + secondRadius * secondRadius - firstRadius * firstRadius) /
            (2 * centers * secondRadius),
        ),
      ),
    );
    return (
      (firstRadius * firstRadius * (firstAngle - Math.sin(firstAngle)) +
        secondRadius * secondRadius *
          (secondAngle - Math.sin(secondAngle))) /
      2
    );
  }
  const firstPolygon = geometryAreaPolygon(
    firstGeometry,
    firstPoints,
    firstArc,
    sampleCount,
  );
  const secondPolygon = geometryAreaPolygon(
    secondGeometry,
    secondPoints,
    secondArc,
    sampleCount,
  );
  const overlap = polygonIntersectionArea(firstPolygon, secondPolygon);
  return Math.max(
    0,
    Math.min(overlap, polygonArea(firstPolygon), polygonArea(secondPolygon)),
  );
}

export function geometryContainmentResidual(
  innerGeometry: GeometryKind,
  innerPoints: Point[],
  outerGeometry: GeometryKind,
  outerPoints: Point[],
  innerArc: ArcMode = "minor",
  outerArc: ArcMode = "minor",
) {
  const innerArea =
    innerGeometry === "circle" && outerGeometry === "circle"
      ? geometryMetric("area", innerGeometry, innerPoints, innerArc)
      : polygonArea(
          geometryAreaPolygon(
            innerGeometry,
            innerPoints,
            innerArc,
            48,
          ),
        );
  if (!Number.isFinite(innerArea)) return 10;
  const intersectionArea = geometryIntersectionArea(
    innerGeometry,
    innerPoints,
    outerGeometry,
    outerPoints,
    innerArc,
    outerArc,
    48,
  );
  return Math.abs(innerArea - intersectionArea) / Math.max(innerArea, 1);
}
