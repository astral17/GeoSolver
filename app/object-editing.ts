import { useCallback, type Dispatch, type SetStateAction } from "react";
import type {
  ExpressionRow,
  Measurement,
  Point,
  Shape,
} from "./domain";
import { renamePointInExpression } from "./expressions";
import { nextPointId } from "./geometry";
import { COLORS } from "./project-state";

type Setter<T> = Dispatch<SetStateAction<T>>;
type Translate = (russian: string, english: string) => string;

type ObjectEditingOptions = {
  points: Point[];
  selectedPoint: string | null;
  setPoints: Setter<Point[]>;
  setShapes: Setter<Shape[]>;
  setMeasurements: Setter<Measurement[]>;
  setKnown: Setter<ExpressionRow[]>;
  setUnknown: Setter<ExpressionRow[]>;
  setSelectedPoint: Setter<string | null>;
  setSelectedPoints: Setter<string[]>;
  setPendingPoints: Setter<string[]>;
  setRenameValue: Setter<string>;
  setCanvasNotice: Setter<string | null>;
  markDirty: () => void;
  t: Translate;
};

function moveItem<T extends { id: string }>(
  items: T[],
  id: string,
  direction: -1 | 1,
) {
  const index = items.findIndex((item) => item.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function reorderItem<T extends { id: string; groupId?: string }>(
  items: T[],
  sourceId: string,
  targetId: string,
) {
  if (sourceId === targetId) return items;
  const sourceIndex = items.findIndex((item) => item.id === sourceId);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return items;
  const next = [...items];
  const targetGroupId = items[targetIndex]?.groupId;
  const [source] = next.splice(sourceIndex, 1);
  const moved = { ...source, groupId: targetGroupId };
  const targetAfterRemoval = next.findIndex((item) => item.id === targetId);
  next.splice(
    sourceIndex < targetIndex
      ? targetAfterRemoval + 1
      : targetAfterRemoval,
    0,
    moved,
  );
  return next;
}

export function useObjectEditing({
  points,
  selectedPoint,
  setPoints,
  setShapes,
  setMeasurements,
  setKnown,
  setUnknown,
  setSelectedPoint,
  setSelectedPoints,
  setPendingPoints,
  setRenameValue,
  setCanvasNotice,
  markDirty,
  t,
}: ObjectEditingOptions) {
  const renamePoint = useCallback(
    (previousId: string, value: string) => {
      const nextId = value.trim().toUpperCase();
      if (!/^[A-Z]$/.test(nextId)) {
        setCanvasNotice(
          t(
            "Имя точки должно быть одной латинской буквой A–Z",
            "A point name must be one Latin letter A–Z",
          ),
        );
        window.setTimeout(() => setCanvasNotice(null), 2000);
        return false;
      }
      if (
        nextId !== previousId &&
        points.some((point) => point.id === nextId)
      ) {
        setCanvasNotice(
          t(
            `Точка ${nextId} уже существует`,
            `Point ${nextId} already exists`,
          ),
        );
        window.setTimeout(() => setCanvasNotice(null), 2000);
        return false;
      }
      if (nextId === previousId) return true;

      setPoints((current) =>
        current.map((point) =>
          point.id === previousId ? { ...point, id: nextId } : point,
        ),
      );
      setShapes((current) =>
        current.map((shape) => ({
          ...shape,
          points: shape.points.map((id) =>
            id === previousId ? nextId : id,
          ),
        })),
      );
      setMeasurements((current) =>
        current.map((measurement) => ({
          ...measurement,
          points: measurement.points.map((id) =>
            id === previousId ? nextId : id,
          ),
        })),
      );
      const renameRows = (current: ExpressionRow[]) =>
        current.map((row) => ({
          ...row,
          expression: renamePointInExpression(
            row.expression,
            previousId,
            nextId,
          ),
        }));
      setKnown(renameRows);
      setUnknown(renameRows);
      setSelectedPoint((current) =>
        current === previousId ? nextId : current,
      );
      setSelectedPoints((current) =>
        current.map((id) => (id === previousId ? nextId : id)),
      );
      setRenameValue((current) =>
        selectedPoint === previousId ? nextId : current,
      );
      setCanvasNotice(
        t(
          `${previousId} переименована в ${nextId}`,
          `${previousId} was renamed to ${nextId}`,
        ),
      );
      window.setTimeout(() => setCanvasNotice(null), 1800);
      markDirty();
      return true;
    },
    [
      markDirty,
      points,
      selectedPoint,
      setCanvasNotice,
      setKnown,
      setMeasurements,
      setPoints,
      setRenameValue,
      setSelectedPoint,
      setSelectedPoints,
      setShapes,
      setUnknown,
      t,
    ],
  );

  const updatePointObject = useCallback(
    (
      id: string,
      patch: Partial<Pick<Point, "x" | "y" | "visible" | "groupId">>,
    ) => {
      setPoints((current) =>
        current.map((point) =>
          point.id === id ? { ...point, ...patch } : point,
        ),
      );
      markDirty();
    },
    [markDirty, setPoints],
  );

  const updateShapeObject = useCallback(
    (id: string, patch: Partial<Shape>) => {
      setShapes((current) =>
        current.map((shape) =>
          shape.id === id ? { ...shape, ...patch } : shape,
        ),
      );
      setMeasurements((current) =>
        current.map((measurement) =>
          measurement.shapeId === id && patch.points
            ? { ...measurement, points: [...patch.points] }
            : measurement,
        ),
      );
      markDirty();
    },
    [markDirty, setMeasurements, setShapes],
  );

  const addPointObject = useCallback(() => {
    const id = nextPointId(points);
    const last = points.at(-1);
    setPoints((current) => [
      ...current,
      {
        id,
        x: last ? last.x + 0.8 : 0,
        y: last ? last.y + 0.8 : 0,
      },
    ]);
    setSelectedPoint(id);
    setSelectedPoints([id]);
    setRenameValue(id);
    markDirty();
    return id;
  }, [
    markDirty,
    points,
    setPoints,
    setRenameValue,
    setSelectedPoint,
    setSelectedPoints,
  ]);

  const addShapeObject = useCallback((type: Shape["type"]) => {
    const pointCount =
      type === "ellipse" ||
      type === "sector" ||
      type === "circularSegment" ||
      type === "polygon"
        ? 3
        : type === "polyline"
          ? 2
        : 2;
    if (points.length < pointCount) {
      setCanvasNotice(
        t(
          `Для этого объекта нужны минимум ${pointCount} точки`,
          `This object needs at least ${pointCount} points`,
        ),
      );
      window.setTimeout(() => setCanvasNotice(null), 1800);
      return null;
    }
    const id = `shape-manual-${Date.now()}`;
    setShapes((current) => [
      ...current,
      {
        id,
        type,
        points: points.slice(0, pointCount).map((point) => point.id),
        color: COLORS[current.length % COLORS.length],
        arc:
          type === "sector" || type === "circularSegment"
            ? "minor"
            : undefined,
      },
    ]);
    markDirty();
    return id;
  }, [markDirty, points, setCanvasNotice, setShapes, t]);

  const deletePointObject = useCallback(
    (id: string) => {
      setPoints((current) => current.filter((point) => point.id !== id));
      setShapes((current) =>
        current.filter((shape) => !shape.points.includes(id)),
      );
      setMeasurements((current) =>
        current.filter(
          (measurement) => !measurement.points.includes(id),
        ),
      );
      setSelectedPoint((current) => (current === id ? null : current));
      setSelectedPoints((current) =>
        current.filter((pointId) => pointId !== id),
      );
      setPendingPoints((current) =>
        current.filter((pointId) => pointId !== id),
      );
      if (selectedPoint === id) setRenameValue("");
      markDirty();
    },
    [
      markDirty,
      setMeasurements,
      setPoints,
      setPendingPoints,
      setRenameValue,
      setSelectedPoint,
      setSelectedPoints,
      setShapes,
      selectedPoint,
    ],
  );

  const deleteShapeObject = useCallback(
    (id: string) => {
      setShapes((current) => current.filter((shape) => shape.id !== id));
      setMeasurements((current) =>
        current.filter((measurement) => measurement.shapeId !== id),
      );
      markDirty();
    },
    [markDirty, setMeasurements, setShapes],
  );

  const movePointObject = useCallback(
    (id: string, direction: -1 | 1) => {
      setPoints((current) => moveItem(current, id, direction));
      markDirty();
    },
    [markDirty, setPoints],
  );

  const moveShapeObject = useCallback(
    (id: string, direction: -1 | 1) => {
      setShapes((current) => moveItem(current, id, direction));
      markDirty();
    },
    [markDirty, setShapes],
  );

  const reorderPointObject = useCallback(
    (sourceId: string, targetId: string) => {
      setPoints((current) => reorderItem(current, sourceId, targetId));
      markDirty();
    },
    [markDirty, setPoints],
  );

  const reorderShapeObject = useCallback(
    (sourceId: string, targetId: string) => {
      setShapes((current) => reorderItem(current, sourceId, targetId));
      markDirty();
    },
    [markDirty, setShapes],
  );

  return {
    renamePoint,
    updatePointObject,
    updateShapeObject,
    addPointObject,
    addShapeObject,
    deletePointObject,
    deleteShapeObject,
    movePointObject,
    moveShapeObject,
    reorderPointObject,
    reorderShapeObject,
  };
}
