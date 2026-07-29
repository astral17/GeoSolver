import { useCallback } from "react";

import type { Point, Shape } from "./domain";
import {
  isAngleOnArc,
  pointMap,
  projectPointToArc,
  projectPointToCircle,
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

    const findObjectAt = useCallback(
      (x: number, y: number) => {
        const map = pointMap(points);
      let closest: CanvasObjectHit = null;
        shapes.forEach((shape) => {
          if (shape.visible === false) return;
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
                shapeId: shape.id,
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

  return { findPointAt, findPointsAt, findObjectAt };
}
