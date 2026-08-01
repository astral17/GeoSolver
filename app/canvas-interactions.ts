import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type React from "react";

import type {
  CanvasIntersectionObjectHit,
  CanvasObjectHit,
} from "./canvas-hit-testing";
import type {
  CanvasDrag,
  CanvasView,
  DrawingSnapshot,
  EditorGroup,
  ExpressionRow,
  Measurement,
  IntersectionObject,
  ParsedConstraint,
  Point,
  Shape,
  SolveResult,
} from "./domain";
import {
  distance,
  nextPointId,
  pointMap,
  pointOnEllipse,
  projectPointToArc,
  projectPointToCircle,
  projectPointToEllipse,
  projectPointToSegment,
} from "./geometry";
import { locateObjectIntersections } from "./expressions";
import { cloneSnapshot, COLORS } from "./project-state";
import {
  polygonConstraintExpressions,
  quadrilateralConstraintExpressions,
  type ToolId,
} from "./tools";

type Setter<T> = Dispatch<SetStateAction<T>>;
type Translate = (russian: string, english: string) => string;

type CanvasInteractionsOptions = {
  canvasSize: { width: number; height: number };
  activeTool: ToolId;
  drag: CanvasDrag;
  points: Point[];
  shapes: Shape[];
  measurements: Measurement[];
  known: ExpressionRow[];
  unknown: ExpressionRow[];
  groups: EditorGroup[];
  view: CanvasView;
  selectedPoint: string | null;
  selectedPoints: string[];
  pendingPoints: string[];
  result: SolveResult;
  objectMemberships: ParsedConstraint[];
  setPoints: Setter<Point[]>;
  setShapes: Setter<Shape[]>;
  setMeasurements: Setter<Measurement[]>;
  setKnown: Setter<ExpressionRow[]>;
  setUnknown: Setter<ExpressionRow[]>;
  setView: Setter<CanvasView>;
  setSelectedPoint: Setter<string | null>;
  setSelectedPoints: Setter<string[]>;
  setPendingPoints: Setter<string[]>;
  setResult: Setter<SolveResult>;
  setDrag: Setter<CanvasDrag>;
  setCanvasNotice: Setter<string | null>;
  activeCanvasPointersRef: MutableRefObject<
    Map<number, { x: number; y: number }>
  >;
  pinchGestureRef: MutableRefObject<{
    distance: number;
    center: { x: number; y: number };
    view: CanvasView;
  } | null>;
  touchGestureStartRef: MutableRefObject<{
    snapshot: DrawingSnapshot;
    view: CanvasView;
    selectedPoint: string | null;
    selectedPoints: string[];
    pendingPoints: string[];
    result: SolveResult;
  } | null>;
  historyTimerRef: MutableRefObject<number | null>;
  findPointAt: (x: number, y: number) => string | null;
  findPointsAt: (x: number, y: number) => string[];
  findObjectAt: (x: number, y: number) => CanvasObjectHit;
  findIntersectionObjectsAt: (
    x: number,
    y: number,
  ) => CanvasIntersectionObjectHit[];
  screenToWorld: (x: number, y: number) => { x: number; y: number };
  worldToScreen: (point: Point) => { x: number; y: number };
  markDirty: () => void;
  onAddFocusedKnown: (expression: string) => void;
  t: Translate;
  minViewScale: number;
  maxViewScale: number;
};

export function useCanvasInteractions(options: CanvasInteractionsOptions) {
  const {
    canvasSize,
    activeTool,
    drag,
    points,
    shapes,
    measurements,
    known,
    unknown,
    groups,
    view,
    selectedPoint,
    selectedPoints,
    pendingPoints,
    result,
    objectMemberships,
    setPoints,
    setShapes,
    setMeasurements,
    setKnown,
    setUnknown,
    setView,
    setSelectedPoint,
    setSelectedPoints,
    setPendingPoints,
    setResult,
    setDrag,
    setCanvasNotice,
    activeCanvasPointersRef,
    pinchGestureRef,
    touchGestureStartRef,
    historyTimerRef,
    findPointAt,
    findPointsAt,
    findObjectAt,
    findIntersectionObjectsAt,
    screenToWorld,
    worldToScreen,
    markDirty,
    onAddFocusedKnown,
    t,
    minViewScale,
    maxViewScale,
  } = options;
    const pendingIntersectionRef = useRef<CanvasIntersectionObjectHit | null>(
      null,
    );

    const resetPendingIntersection = useCallback(() => {
      pendingIntersectionRef.current = null;
      setCanvasNotice(null);
    }, [setCanvasNotice]);

    useEffect(() => {
      if (activeTool !== "intersectionPoint") {
        resetPendingIntersection();
      }
    }, [activeTool, resetPendingIntersection]);
    const getOrCreatePoint = useCallback(
      (screenX: number, screenY: number) => {
        const hit = findPointAt(screenX, screenY);
        if (hit) return hit;
        const world = screenToWorld(screenX, screenY);
        const id = nextPointId(points);
        setPoints((current) => [...current, { id, x: world.x, y: world.y }]);
        return id;
      },
      [findPointAt, points, screenToWorld, setPoints],
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
                    activeTool === "sector" ? "clockwise" : "minor",
                },
              ]);
              addConstraints(
                activeTool === "ellipse"
                  ? [`distinct(${selection.join("")})`]
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
        } else if (activeTool === "polyline") {
          if (id === pendingPoints.at(-1)) {
            if (pendingPoints.length >= 2) {
              setShapes((current) => [
                ...current,
                {
                  id: `shape-${Date.now()}`,
                  type: "polyline",
                  points: pendingPoints,
                  color: COLORS[current.length % COLORS.length],
                },
              ]);
              setPendingPoints([]);
            } else {
              setCanvasNotice(
                t(
                  "Для ломаной нужны минимум две вершины",
                  "A polyline needs at least two vertices",
                ),
              );
              window.setTimeout(() => setCanvasNotice(null), 1800);
            }
          } else {
            setPendingPoints(selection);
          }
        } else if (
          activeTool === "polygon" ||
          activeTool === "crossedPolygon" ||
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
                  activeTool === "crossedPolygon",
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
          activeTool === "quadrilateral" ||
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
        } else if (activeTool === "setArea") {
          if (id === pendingPoints.at(-1)) {
            if (pendingPoints.length >= 3) {
              onAddFocusedKnown(`S(${pendingPoints.join("")}) = `);
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
        } else if (activeTool === "setAngle") {
          if (selection.length === 3) {
            if (new Set(selection).size < 3) {
              setCanvasNotice(
                t(
                  "Выберите три различные точки",
                  "Select three distinct points",
                ),
              );
              window.setTimeout(() => setCanvasNotice(null), 1800);
              setPendingPoints([...new Set(selection)]);
            } else {
              onAddFocusedKnown(`∠${selection.join("")} = `);
              setPendingPoints([]);
            }
          } else setPendingPoints(selection);
        } else if (activeTool === "setLength") {
          if (selection.length === 2) {
            if (selection[0] === selection[1]) {
              setCanvasNotice(
                t(
                  "Выберите две различные точки",
                  "Select two distinct points",
                ),
              );
              window.setTimeout(() => setCanvasNotice(null), 1800);
              setPendingPoints([selection[0]]);
            } else {
              onAddFocusedKnown(`${selection.join("")} = `);
              setPendingPoints([]);
            }
          } else setPendingPoints(selection);
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
      [
        activeTool,
        markDirty,
        onAddFocusedKnown,
        pendingPoints,
        setCanvasNotice,
        setKnown,
        setMeasurements,
        setPendingPoints,
        setShapes,
        t,
      ],
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
      if (event.pointerType === "touch") {
        activeCanvasPointersRef.current.set(event.pointerId, position);
        if (activeCanvasPointersRef.current.size === 1) {
          touchGestureStartRef.current = {
            snapshot: cloneSnapshot({
              points,
              shapes,
              measurements,
              known,
              unknown,
              groups,
            }),
            view: { ...view },
            selectedPoint,
            selectedPoints: [...selectedPoints],
            pendingPoints: [...pendingPoints],
            result,
          };
        }
        if (activeCanvasPointersRef.current.size >= 2) {
          const [first, second] = Array.from(
            activeCanvasPointersRef.current.values(),
          );
          const gestureStart = touchGestureStartRef.current;
          if (gestureStart) {
            setPoints(gestureStart.snapshot.points);
            setShapes(gestureStart.snapshot.shapes);
            setMeasurements(gestureStart.snapshot.measurements);
            setKnown(gestureStart.snapshot.known);
            setUnknown(gestureStart.snapshot.unknown);
            setSelectedPoint(gestureStart.selectedPoint);
            setSelectedPoints(gestureStart.selectedPoints);
            setPendingPoints(gestureStart.pendingPoints);
            setResult(gestureStart.result);
            setView(gestureStart.view);
            if (historyTimerRef.current !== null) {
              window.clearTimeout(historyTimerRef.current);
              historyTimerRef.current = null;
            }
          }
          pinchGestureRef.current = {
            distance: Math.max(
              Math.hypot(second.x - first.x, second.y - first.y),
              1,
            ),
            center: {
              x: (first.x + second.x) / 2,
              y: (first.y + second.y) / 2,
            },
            view: { ...(gestureStart?.view ?? view) },
          };
          setDrag(null);
          event.preventDefault();
          return;
        }
      }
      const beginSelectionDrag = (
        hit: string,
        cycleCandidates: string[],
      ) => {
        const ids =
          selectedPoints.includes(hit) && selectedPoints.length > 1
            ? selectedPoints
            : [hit];
        setSelectedPoints(ids);
        setSelectedPoint(ids.length === 1 ? hit : null);
        if (ids.length === 1) {
          setDrag({
            type: "point",
            id: hit,
            startX: position.x,
            startY: position.y,
            moved: false,
            cycleOnClick: selectedPoint === hit,
            cycleCandidates,
          });
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
        const candidates = findPointsAt(position.x, position.y);
        const hit =
          (selectedPoint && candidates.includes(selectedPoint)
            ? selectedPoint
            : candidates[0]) ?? null;
        if (hit) {
          beginSelectionDrag(hit, candidates);
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
        const candidates = findPointsAt(position.x, position.y);
        const hit =
          (selectedPoint && candidates.includes(selectedPoint)
            ? selectedPoint
            : candidates[0]) ?? null;
        if (hit) {
          beginSelectionDrag(hit, candidates);
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
      if (activeTool === "intersectionPoint") {
        const hits = findIntersectionObjectsAt(position.x, position.y);
        const pending = pendingIntersectionRef.current;
        const differentFrom = (
          candidate: CanvasIntersectionObjectHit,
          first: CanvasIntersectionObjectHit,
        ) =>
          candidate.shapeId !== first.shapeId ||
          candidate.startId !== first.startId ||
          candidate.endId !== first.endId;
        const first = pending ?? hits[0];
        const second = first
          ? hits.find((candidate) => differentFrom(candidate, first))
          : undefined;
        if (!first) {
          setCanvasNotice(
            t("Кликните ближе к объекту", "Click closer to an object"),
          );
          window.setTimeout(() => setCanvasNotice(null), 1800);
          return;
        }
        if (!second) {
          pendingIntersectionRef.current = first;
          setCanvasNotice(
            t("Выберите второй объект", "Select the second object"),
          );
          return;
        }
        const map = pointMap(points);
        const toIntersectionObject = (
          hit: CanvasIntersectionObjectHit,
        ): IntersectionObject => ({
          kind: hit.kind,
          ids: [hit.startId, hit.endId, hit.thirdId].filter(
            (id): id is string => Boolean(id),
          ),
        });
        const located = locateObjectIntersections(
          toIntersectionObject(first),
          toIntersectionObject(second),
          map,
          shapes,
        );
        const intersections = located.continuous ? [] : located.points;
        const clickWorld = screenToWorld(position.x, position.y);
        const intersection = intersections
          .slice()
          .sort(
            (firstPoint, secondPoint) =>
              Math.hypot(
                firstPoint.x - clickWorld.x,
                firstPoint.y - clickWorld.y,
              ) -
              Math.hypot(
                secondPoint.x - clickWorld.x,
                secondPoint.y - clickWorld.y,
              ),
          )[0];
        if (!intersection) {
          pendingIntersectionRef.current = null;
          setCanvasNotice(
            t(
              "У выбранных объектов нет единственной точки пересечения",
              "The selected objects have no single intersection point",
            ),
          );
          window.setTimeout(() => setCanvasNotice(null), 2200);
          return;
        }
        const id = nextPointId(points);
        setPoints((current) => [
          ...current,
          { id, x: intersection.x, y: intersection.y },
        ]);
        setKnown((current) => [
          ...current,
          {
            id: Date.now(),
            expression: `${id} ${intersections.length === 1 ? "=" : "∈"} ${first.objectName} ∩ ${second.objectName}`,
            enabled: true,
            color: COLORS[current.length % COLORS.length],
          },
        ]);
        pendingIntersectionRef.current = null;
        setSelectedPoint(id);
        setSelectedPoints([id]);
        setCanvasNotice(
          t(`Создана точка ${id}`, `Point ${id} created`),
        );
        window.setTimeout(() => setCanvasNotice(null), 1600);
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
        activeTool === "area" ||
        activeTool === "setLength" ||
        activeTool === "setAngle" ||
        activeTool === "setArea"
      ) {
        const hit = findPointAt(position.x, position.y);
        if (
          activeTool === "area" &&
          !hit &&
          pendingPoints.length === 0
        ) {
          const object = findObjectAt(position.x, position.y);
          const measuredShape = object
            ? shapes.find((shape) => shape.id === object.shapeId)
            : null;
          if (
            measuredShape &&
            (
              [
                "polygon",
                "circle",
                "ellipse",
                "sector",
                "circularSegment",
              ] as Shape["type"][]
            ).includes(measuredShape.type)
          ) {
            setMeasurements((current) => [
              ...current,
              {
                id: Date.now(),
                kind: "area",
                points: [...measuredShape.points],
                shapeId: measuredShape.id,
                color: COLORS[(current.length + 3) % COLORS.length],
              },
            ]);
            setPendingPoints([]);
            return;
          }
        }
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
      const position = pointerPosition(event);
      if (
        event.pointerType === "touch" &&
        activeCanvasPointersRef.current.has(event.pointerId)
      ) {
        activeCanvasPointersRef.current.set(event.pointerId, position);
        const pinch = pinchGestureRef.current;
        if (pinch && activeCanvasPointersRef.current.size >= 2) {
          const [first, second] = Array.from(
            activeCanvasPointersRef.current.values(),
          );
          const distance = Math.max(
            Math.hypot(second.x - first.x, second.y - first.y),
            1,
          );
          const center = {
            x: (first.x + second.x) / 2,
            y: (first.y + second.y) / 2,
          };
          const nextScale = Math.max(
            minViewScale,
            Math.min(
              maxViewScale,
              pinch.view.scale * (distance / pinch.distance),
            ),
          );
          const worldX =
            (pinch.center.x - canvasSize.width / 2 - pinch.view.x) /
            pinch.view.scale;
          const worldY =
            -(pinch.center.y - canvasSize.height / 2 - pinch.view.y) /
            pinch.view.scale;
          setView({
            x: center.x - canvasSize.width / 2 - worldX * nextScale,
            y: center.y - canvasSize.height / 2 + worldY * nextScale,
            scale: nextScale,
          });
          event.preventDefault();
          return;
        }
      }
      if (!drag) return;
      if (drag.type === "point") {
        const dx = position.x - drag.startX;
        const dy = position.y - drag.startY;
        if (!drag.moved && Math.hypot(dx, dy) <= 4) return;
        if (!drag.moved) {
          setDrag((current) =>
            current?.type === "point"
              ? { ...current, moved: true }
              : current,
          );
        }
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
                  : ownMembership.kind === "onArc" &&
                      currentMap.get(ownMembership.ids[3])
                    ? projectPointToArc(
                        { id: drag.id, ...world },
                        start,
                        end,
                        currentMap.get(ownMembership.ids[3]) as Point,
                        shapes.find(
                          (shape) =>
                            (shape.type === "sector" ||
                              shape.type === "circularSegment") &&
                            shape.points[0] === ownMembership.ids[1] &&
                            shape.points[1] === ownMembership.ids[2] &&
                            shape.points[2] === ownMembership.ids[3],
                        )?.arc,
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
                ((constraint.kind === "onEllipse" ||
                  constraint.kind === "onArc") &&
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
              } else if (
                constraint.kind === "onArc" &&
                oldThird &&
                newThird
              ) {
                const matchingArc = shapes.find(
                  (shape) =>
                    (shape.type === "sector" ||
                      shape.type === "circularSegment") &&
                    shape.points[0] === constraint.ids[1] &&
                    shape.points[1] === constraint.ids[2] &&
                    shape.points[2] === constraint.ids[3],
                );
                const { angle } = projectPointToArc(
                  constrained,
                  oldStart,
                  oldEnd,
                  oldThird,
                  matchingArc?.arc,
                );
                const radius = distance(newStart, newEnd);
                nextMap.set(
                  constraint.ids[0],
                  projectPointToArc(
                    {
                      id: constraint.ids[0],
                      x: newStart.x + Math.cos(angle) * radius,
                      y: newStart.y + Math.sin(angle) * radius,
                    },
                    newStart,
                    newEnd,
                    newThird,
                    matchingArc?.arc,
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

    const handlePointerUp = (
      event: React.PointerEvent<HTMLCanvasElement>,
    ) => {
      const wasPinching = pinchGestureRef.current !== null;
      activeCanvasPointersRef.current.delete(event.pointerId);
      if (wasPinching) {
        if (activeCanvasPointersRef.current.size < 2) {
          pinchGestureRef.current = null;
          touchGestureStartRef.current = null;
        }
        setDrag(null);
        event.preventDefault();
        return;
      }
      if (
        drag?.type === "measurementPan" &&
        !drag.moved &&
        drag.hit
      ) {
        completeToolSelection(drag.hit);
      }
      if (
        drag?.type === "point" &&
        !drag.moved &&
        drag.cycleOnClick &&
        drag.cycleCandidates.length > 1
      ) {
        const currentIndex = drag.cycleCandidates.indexOf(drag.id);
        const nextId =
          drag.cycleCandidates[
            (currentIndex + 1) % drag.cycleCandidates.length
          ];
        setSelectedPoint(nextId);
        setSelectedPoints([nextId]);
      }
      if (drag?.type === "marquee") {
        const left = Math.min(drag.startX, drag.currentX);
        const right = Math.max(drag.startX, drag.currentX);
        const top = Math.min(drag.startY, drag.currentY);
        const bottom = Math.max(drag.startY, drag.currentY);
        const ids = points
          .filter((point) => point.visible !== false)
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
      touchGestureStartRef.current = null;
    };

    const handlePointerCancel = (
      event: React.PointerEvent<HTMLCanvasElement>,
    ) => {
      activeCanvasPointersRef.current.delete(event.pointerId);
      if (activeCanvasPointersRef.current.size < 2) {
        pinchGestureRef.current = null;
        touchGestureStartRef.current = null;
      }
      setDrag(null);
    };

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    resetPendingIntersection,
  };
}
