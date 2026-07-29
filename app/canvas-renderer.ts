import { useEffect, type RefObject } from "react";

import type {
  CanvasDrag,
  CanvasView,
  ExpressionRow,
  Measurement,
  ParsedConstraint,
  Point,
  Shape,
  SolveResult,
} from "./domain";
import {
  angleDegrees,
  distance,
  pointMap,
  polygonArea,
  resolveArcEnd,
  traceRightAngleMarker,
} from "./geometry";
import { parseUnknown } from "./expressions";
import type { ToolId } from "./tools";

type CanvasRendererOptions = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  canvasSize: { width: number; height: number };
  theme: "light" | "dark";
  view: CanvasView;
  activeTool: ToolId;
  drag: CanvasDrag;
  equalSideMarks: { ids: [string, string]; count: number }[];
  formatNumber: (value: number) => string;
  measurements: Measurement[];
  parsedKnown: (ExpressionRow & { parsed: ParsedConstraint | null })[];
  pendingPoints: string[];
  points: Point[];
  result: SolveResult;
  selectedPoint: string | null;
  selectedPoints: string[];
  shapes: Shape[];
  showAngles: boolean;
  showAreaConstraints: boolean;
  showCongruenceMarks: boolean;
  unknown: ExpressionRow[];
  worldToScreen: (point: Point) => {
    x: number;
    y: number;
  };
};

export function useCanvasRenderer(options: CanvasRendererOptions) {
  const {
    activeTool,
    canvasRef,
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
    showAreaConstraints,
    showCongruenceMarks,
    theme,
    unknown,
    view,
    worldToScreen,
  } = options;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvasSize.width * dpr);
    canvas.height = Math.round(canvasSize.height * dpr);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    context.fillStyle = theme === "dark" ? "#14171d" : "#fbfbfc";
    context.fillRect(0, 0, canvasSize.width, canvasSize.height);

    const originX = canvasSize.width / 2 + view.x;
    const originY = canvasSize.height / 2 + view.y;
    let gridStep = view.scale;
    while (gridStep < 38) gridStep *= 2;
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
    const isReferenceVisible = (ids: string[]) => {
      const uniqueIds = [...new Set(ids)];
      if (
        uniqueIds.some((id) => map.get(id)?.visible === false)
      ) {
        return false;
      }
      const relatedShapes = shapes.filter((shape) =>
        uniqueIds.every((id) => shape.points.includes(id)),
      );
      return (
        relatedShapes.length === 0 ||
        relatedShapes.some((shape) => shape.visible !== false)
      );
    };
    shapes.forEach((shape) => {
      if (shape.visible === false) return;
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
      if (shape.type === "polyline" && screens.length >= 2) {
        context.beginPath();
        context.moveTo(screens[0].x, screens[0].y);
        screens.slice(1).forEach((screen) => context.lineTo(screen.x, screen.y));
        context.stroke();
      } else if (shape.type === "polygon" && screens.length >= 3) {
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
      if (!isReferenceVisible(mark.ids)) return;
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
          "polyline",
          "regularPolygon",
          "triangle",
          "rightTriangle",
          "isoscelesTriangle",
          "equilateralTriangle",
          "ellipse",
          "sector",
          "majorSector",
          "circularSegment",
          "quadrilateral",
          "square",
          "rectangle",
          "parallelogram",
          "trapezoid",
          "rhombus",
          "area",
          "setArea",
          "setAngle",
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
      if (!row.parsed || !isReferenceVisible(row.parsed.ids)) return;
      const itemPoints = row.parsed.ids
        .map((id) => map.get(id))
        .filter((point): point is Point => Boolean(point));
      const formulaAreaNode =
        row.parsed.kind === "formula" && row.parsed.formula
          ? [row.parsed.formula.left, row.parsed.formula.right].find(
              (node) =>
                node.kind === "measure" && node.measure === "area",
            )
          : null;
      const areaIds =
        row.parsed.kind === "area"
          ? row.parsed.ids
          : formulaAreaNode?.kind === "measure"
            ? formulaAreaNode.ids
            : [];
      const areaPoints = areaIds
        .map((id) => map.get(id))
        .filter((point): point is Point => Boolean(point));
      if (
        showAreaConstraints &&
        areaIds.length > 0 &&
        areaPoints.length === areaIds.length
      ) {
        const screens = areaPoints.map(worldToScreen);
        const geometry =
          row.parsed.kind === "area"
            ? "polygon"
            : formulaAreaNode?.kind === "measure"
              ? formulaAreaNode.geometry
              : "polygon";
        if (geometry === "polygon" && screens.length >= 3) {
          context.beginPath();
          context.moveTo(screens[0].x, screens[0].y);
          screens
            .slice(1)
            .forEach((screen) => context.lineTo(screen.x, screen.y));
          context.closePath();
          context.fillStyle = `${row.color}12`;
          context.fill();
          context.strokeStyle = `${row.color}88`;
          context.lineWidth = 1.6;
          context.setLineDash([5, 4]);
          context.stroke();
          context.setLineDash([]);
        }
        const center =
          geometry === "polygon"
            ? screens.reduce(
                (sum, screen) => ({
                  x: sum.x + screen.x / screens.length,
                  y: sum.y + screen.y / screens.length,
                }),
                { x: 0, y: 0 },
              )
            : { x: screens[0].x, y: screens[0].y + 20 };
        const label = row.expression.replace(/\s+/g, " ").trim();
        context.font =
          "700 11px ui-monospace, SFMono-Regular, monospace";
        const width = context.measureText(label).width + 16;
        context.fillStyle = canvasPalette.labelBackground;
        context.beginPath();
        context.roundRect(
          center.x - width / 2,
          center.y - 11,
          width,
          22,
          6,
        );
        context.fill();
        context.strokeStyle = `${row.color}66`;
        context.stroke();
        context.fillStyle = row.color;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(label, center.x, center.y + 0.5);
      }
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
          row.parsed.kind === "onArc" ||
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
      if (
        !isReferenceVisible(measurement.points) ||
        (measurement.shapeId &&
          shapes.find((shape) => shape.id === measurement.shapeId)
            ?.visible === false)
      ) {
        return;
      }
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
      if (point.visible === false) return;
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
        if (!isReferenceVisible(firstTarget.ids)) return;
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
    canvasRef,
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
    showAreaConstraints,
    showCongruenceMarks,
    theme,
    unknown,
    view,
    worldToScreen,
  ]);
}
