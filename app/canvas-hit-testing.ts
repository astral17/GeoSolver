import { useCallback } from "react";

import type { IntersectionObject, Point, Shape } from "./domain";
import {
  ellipseGeometry,
  isAngleOnArc,
  pointMap,
  projectPointToArc,
  projectPointToCircle,
  projectPointToEllipse,
  resolveArcEnd,
} from "./geometry";

type CanvasHitTestingOptions = {
  points: Point[];
  shapes: Shape[];
  screenToWorld: (x: number, y: number) => { x: number; y: number };
  worldToScreen: (point: Point) => { x: number; y: number };
};

export type CanvasObjectHit = {
  startId: string;
  endId: string;
  thirdId?: string;
  shapeId: string;
  point: Point;
  distance: number;
  constraintKind:
    | "onSegment"
    | "onLine"
    | "onRay"
    | "onCircle"
    | "onArc"
    | "onEllipse";
  objectName: string;
} | null;

export type CanvasLinearObjectHit = {
  shapeId: string;
  startId: string;
  endId: string;
  kind: "segment" | "line" | "ray";
  objectName: string;
  distance: number;
};

export type CanvasIntersectionObjectHit = {
  shapeId: string;
  startId: string;
  endId: string;
  thirdId?: string;
  kind: Exclude<IntersectionObject["kind"], "auto" | "polygon">;
  objectName: string;
  distance: number;
};

function linearEdges(shape: Shape) {
  if (
    shape.type === "segment" ||
    shape.type === "line" ||
    shape.type === "ray"
  ) {
    return [
      {
        startId: shape.points[0],
        endId: shape.points[1],
        kind: shape.type,
      },
    ];
  }
  if (shape.type === "polyline" || shape.type === "polygon") {
    return [
      ...shape.points.slice(0, -1).map((startId, index) => ({
        startId,
        endId: shape.points[index + 1],
        kind: "segment" as const,
      })),
      ...(shape.type === "polygon"
        ? [
            {
              startId: shape.points.at(-1)!,
              endId: shape.points[0],
              kind: "segment" as const,
            },
          ]
        : []),
    ];
  }
  if (shape.type === "sector") {
    return [
      {
        startId: shape.points[0],
        endId: shape.points[1],
        kind: "segment" as const,
      },
      {
        startId: shape.points[0],
        endId: shape.points[2],
        kind: "segment" as const,
      },
    ];
  }
  if (shape.type === "circularSegment") {
    return [
      {
        startId: shape.points[1],
        endId: shape.points[2],
        kind: "segment" as const,
      },
    ];
  }
  return [];
}

export function useCanvasHitTesting({
  points,
  shapes,
  screenToWorld,
  worldToScreen,
}: CanvasHitTestingOptions) {
    const findPointsAt = useCallback(
      (x: number, y: number) =>
        points
          .filter((point) => point.visible !== false)
          .map((point) => {
            const screen = worldToScreen(point);
            return {
              id: point.id,
              distance: Math.hypot(screen.x - x, screen.y - y),
            };
          })
          .filter((candidate) => candidate.distance <= 13)
          .sort((first, second) => first.distance - second.distance)
          .map((candidate) => candidate.id),
      [points, worldToScreen],
    );
    const findPointAt = useCallback(
      (x: number, y: number) => findPointsAt(x, y)[0] ?? null,
      [findPointsAt],
    );

    const findLinearObjectsAt = useCallback(
      (x: number, y: number) => {
        const map = pointMap(points);
        return shapes
          .filter((shape) => shape.visible !== false)
          .flatMap((shape) =>
            linearEdges(shape).flatMap((edge) => {
              const start = map.get(edge.startId);
              const end = map.get(edge.endId);
              if (!start || !end) return [];
              const startScreen = worldToScreen(start);
              const endScreen = worldToScreen(end);
              const dx = endScreen.x - startScreen.x;
              const dy = endScreen.y - startScreen.y;
              const lengthSquared = Math.max(dx * dx + dy * dy, 1e-9);
              const rawT =
                ((x - startScreen.x) * dx + (y - startScreen.y) * dy) /
                lengthSquared;
              const t =
                edge.kind === "line"
                  ? rawT
                  : edge.kind === "ray"
                    ? Math.max(0, rawT)
                    : Math.max(0, Math.min(1, rawT));
              const distance = Math.hypot(
                x - (startScreen.x + dx * t),
                y - (startScreen.y + dy * t),
              );
              if (distance > 18) return [];
              return [
                {
                  shapeId: shape.id,
                  startId: edge.startId,
                  endId: edge.endId,
                  kind: edge.kind,
                  objectName: `${edge.kind}(${edge.startId}${edge.endId})`,
                  distance,
                } satisfies CanvasLinearObjectHit,
              ];
            }),
          )
          .sort((first, second) => first.distance - second.distance);
      },
      [points, shapes, worldToScreen],
    );

    const findIntersectionObjectsAt = useCallback(
      (x: number, y: number) => {
        const map = pointMap(points);
        const click = screenToWorld(x, y);
        const curvedHits = shapes.flatMap((shape) => {
          if (
            shape.visible === false ||
            ![
              "circle",
              "ellipse",
              "sector",
              "circularSegment",
            ].includes(shape.type)
          ) {
            return [];
          }
          const center = map.get(shape.points[0]);
          const radiusPoint = map.get(shape.points[1]);
          if (!center || !radiusPoint) return [];
          const thirdPoint = shape.points[2]
            ? map.get(shape.points[2])
            : undefined;
          if (shape.type !== "circle" && !thirdPoint) return [];
          const sourcePoint = { id: "", x: click.x, y: click.y };
          const projected =
            shape.type === "circle"
              ? projectPointToCircle(sourcePoint, center, radiusPoint)
              : shape.type === "ellipse"
                ? projectPointToEllipse(
                    sourcePoint,
                    center,
                    radiusPoint,
                    thirdPoint as Point,
                  )
                : projectPointToArc(
                    sourcePoint,
                    center,
                    radiusPoint,
                    thirdPoint as Point,
                    shape.arc,
                  );
          const screen = worldToScreen(projected);
          const hitDistance = Math.hypot(screen.x - x, screen.y - y);
          if (hitDistance > 18) return [];
          const kind = shape.type as Exclude<
            IntersectionObject["kind"],
            "auto" | "polygon"
          >;
          return [
            {
              shapeId: shape.id,
              startId: center.id,
              endId: radiusPoint.id,
              thirdId: thirdPoint?.id,
              kind,
              objectName: `${kind}(${shape.points.join("")})`,
              distance: hitDistance,
            },
          ];
        });
        return [
          ...findLinearObjectsAt(x, y),
          ...curvedHits,
        ].sort((first, second) => first.distance - second.distance) satisfies
          CanvasIntersectionObjectHit[];
      },
      [
        findLinearObjectsAt,
        points,
        screenToWorld,
        shapes,
        worldToScreen,
      ],
    );

    const findObjectAt = useCallback(
      (x: number, y: number) => {
        const map = pointMap(points);
      let closest: CanvasObjectHit = null;
        shapes.forEach((shape) => {
          if (shape.visible === false) return;
          if (shape.type === "ellipse") {
            const firstFocus = map.get(shape.points[0]);
            const secondFocus = map.get(shape.points[1]);
            const boundaryPoint = map.get(shape.points[2]);
            if (!firstFocus || !secondFocus || !boundaryPoint) return;
            const geometry = ellipseGeometry(
              firstFocus,
              secondFocus,
              boundaryPoint,
            );
            if (geometry.radiusY <= 1e-8) return;
            const projected = projectPointToEllipse(
              { id: "", ...screenToWorld(x, y) },
              firstFocus,
              secondFocus,
              boundaryPoint,
            );
            const projectedScreen = worldToScreen(projected);
            const hitDistance = Math.hypot(
              x - projectedScreen.x,
              y - projectedScreen.y,
            );
            if (
              hitDistance <= 18 &&
              (!closest || hitDistance < closest.distance)
            ) {
              closest = {
                startId: firstFocus.id,
                endId: secondFocus.id,
                thirdId: boundaryPoint.id,
                shapeId: shape.id,
                point: projected,
                distance: hitDistance,
                constraintKind: "onEllipse",
                objectName: `ellipse(${firstFocus.id}${secondFocus.id}${boundaryPoint.id})`,
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
            const arcEndPoint =
              shape.type === "circle"
                ? null
                : map.get(shape.points[2]) ?? null;
            const arcHit =
              shape.type === "circle" ||
              (() => {
                if (!arcEndPoint) return false;
                const secondRadiusScreen = worldToScreen(arcEndPoint);
                const start = Math.atan2(
                  radiusScreen.y - centerScreen.y,
                  radiusScreen.x - centerScreen.x,
                );
                const rawEnd = Math.atan2(
                  secondRadiusScreen.y - centerScreen.y,
                  secondRadiusScreen.x - centerScreen.x,
                );
                const end = resolveArcEnd(start, rawEnd, shape.arc, true);
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
                thirdId: arcEndPoint?.id,
                shapeId: shape.id,
                point: arcEndPoint
                  ? projectPointToArc(
                      { id: "", ...screenToWorld(x, y) },
                      center,
                      radiusPoint,
                      arcEndPoint,
                      shape.arc,
                    )
                  : projectPointToCircle(
                      { id: "", ...screenToWorld(x, y) },
                      center,
                      radiusPoint,
                    ),
                distance: hitDistance,
                constraintKind: arcEndPoint ? "onArc" : "onCircle",
                objectName: arcEndPoint
                  ? `arc(${center.id}${radiusPoint.id}${arcEndPoint.id})`
                  : `circle(${center.id}${radiusPoint.id})`,
              };
            }
            if (shape.type === "circle") return;
          }
          if (
            shape.type !== "segment" &&
            shape.type !== "polyline" &&
            shape.type !== "polygon" &&
            shape.type !== "line" &&
            shape.type !== "ray" &&
            shape.type !== "sector" &&
            shape.type !== "circularSegment"
          ) {
            return;
          }
          const edges: [string, string][] =
            shape.type === "polygon" || shape.type === "polyline"
              ? [
                  ...shape.points
                    .slice(0, -1)
                    .map(
                      (id, index) =>
                        [id, shape.points[index + 1]] as [string, string],
                    ),
                  ...(shape.type === "polygon"
                    ? [
                        [
                          shape.points.at(-1)!,
                          shape.points[0],
                        ] as [string, string],
                      ]
                    : []),
                ]
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
                shapeId: shape.id,
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
              shapeId: string;
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

  return {
    findPointAt,
    findPointsAt,
    findObjectAt,
    findLinearObjectsAt,
    findIntersectionObjectsAt,
  };
}
