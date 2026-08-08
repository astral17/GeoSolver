"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { EditorGroup, Point, Shape } from "./domain";
import { compileImplicitEquation } from "./expressions";
import { expandSymbolCommands } from "./symbol-input";
import {
  buildGroupedEntries,
  EditorGroupBoundaryDropZone,
  focusAdjacentEditorEntry,
  moveEditorRow,
  moveEditorRowOneStep,
} from "./editor-groups";

type Translate = (russian: string, english: string) => string;

type ObjectSectionProps = {
  points: Point[];
  shapes: Shape[];
  groups: EditorGroup[];
  t: Translate;
  onRenamePoint: (previousId: string, nextId: string) => boolean;
  onUpdatePoint: (
    id: string,
    patch: Partial<
      Pick<Point, "x" | "y" | "visible" | "groupId" | "editorOrder">
    >,
  ) => void;
  onUpdateShape: (id: string, patch: Partial<Shape>) => void;
  onSelectPoint: (id: string) => void;
  onSelectPoints: (ids: string[]) => void;
  onAddPoint: () => string;
  onAddShape: (type: Shape["type"]) => string | null;
  onDeletePoint: (id: string) => void;
  onDeleteShape: (id: string) => void;
  onMovePoint: (id: string, direction: -1 | 1) => void;
  onMoveShape: (id: string, direction: -1 | 1) => void;
  onReorderPoint: (sourceId: string, targetId: string) => void;
  onReorderShape: (sourceId: string, targetId: string) => void;
  onReorderObject: (
    sourceKind: "point" | "shape",
    sourceId: string,
    targetKind: "point" | "shape",
    targetId: string,
  ) => void;
  onMoveObject: (
    kind: "point" | "shape",
    id: string,
    direction: -1 | 1,
  ) => void;
  onNavigateNextSection: () => void;
  onAssignPointGroup: (id: string, groupId: string | undefined) => void;
  onAssignShapeGroup: (id: string, groupId: string | undefined) => void;
  renderGroupHeader: (
    group: EditorGroup,
    count: number,
    depth?: number,
  ) => ReactNode;
  draggedGroupId: string | null;
  onApplyObjectOrdering: (
    items: Array<{
      id: string;
      groupId?: string;
      editorOrder?: number;
    }>,
    groups: EditorGroup[],
  ) => void;
  shadowedEquationVariables: string[];
};

const SHAPE_TYPES: {
  type: Shape["type"];
  ru: string;
  en: string;
  pointCounts: number[] | "polygon";
}[] = [
  { type: "segment", ru: "Отрезок", en: "Segment", pointCounts: [2] },
  { type: "line", ru: "Прямая", en: "Line", pointCounts: [2] },
  { type: "ray", ru: "Луч", en: "Ray", pointCounts: [2] },
  {
    type: "polyline",
    ru: "Ломаная",
    en: "Polyline",
    pointCounts: "polygon",
  },
  { type: "circle", ru: "Окружность", en: "Circle", pointCounts: [2] },
  { type: "ellipse", ru: "Эллипс", en: "Ellipse", pointCounts: [3] },
  { type: "sector", ru: "Сектор", en: "Sector", pointCounts: [3] },
  {
    type: "circularSegment",
    ru: "Сегмент круга",
    en: "Circular segment",
    pointCounts: [3],
  },
  {
    type: "polygon",
    ru: "Многоугольник",
    en: "Polygon",
    pointCounts: "polygon",
  },
  {
    type: "equation",
    ru: "Уравнение",
    en: "Equation",
    pointCounts: [0],
  },
];

function shapePointRequirement(type: Shape["type"]) {
  return type === "equation"
    ? { minimum: 0, maximum: 0 }
    : type === "polygon" || type === "polyline"
    ? {
        minimum: type === "polygon" ? 3 : 2,
        maximum: Number.POSITIVE_INFINITY,
      }
    : type === "ellipse" ||
        type === "sector" ||
        type === "circularSegment"
      ? { minimum: 3, maximum: 3 }
      : { minimum: 2, maximum: 2 };
}

function isValidShapePointCount(type: Shape["type"], count: number) {
  const requirement = shapePointRequirement(type);
  return count >= requirement.minimum && count <= requirement.maximum;
}

function EditableValue({
  value,
  ...props
}: {
  value: string;
  label: string;
  className?: string;
  inputMode?: "decimal" | "text";
  maxLength?: number;
  onCommit: (value: string) => boolean | void;
  dataObjectPrimary?: string;
  dataObjectKey?: string;
  dataObjectColumn?: string;
  validate?: (value: string) => string | null;
  onValidationChange?: (error: string | null | undefined) => void;
  onObjectKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  expandSymbols?: boolean;
}) {
  return <EditableValueState key={value} value={value} {...props} />;
}

function EditableValueState({
  value,
  label,
  className,
  inputMode,
  maxLength,
  onCommit,
  dataObjectPrimary,
  dataObjectKey,
  dataObjectColumn,
  validate,
  onValidationChange,
  onObjectKeyDown,
  expandSymbols,
}: {
  value: string;
  label: string;
  className?: string;
  inputMode?: "decimal" | "text";
  maxLength?: number;
  onCommit: (value: string) => boolean | void;
  dataObjectPrimary?: string;
  dataObjectKey?: string;
  dataObjectColumn?: string;
  validate?: (value: string) => string | null;
  onValidationChange?: (error: string | null | undefined) => void;
  onObjectKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  expandSymbols?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const skipBlurCommitRef = useRef(false);
  const validationError = validate?.(draft) ?? null;

  const commit = () => {
    onValidationChange?.(validationError);
    if (validationError) return;
    if (onCommit(draft) !== false) onValidationChange?.(undefined);
  };

  return (
    <input
      className={`${className ?? ""} ${
        validationError ? "is-invalid" : ""
      }`}
      value={draft}
      aria-invalid={Boolean(validationError)}
      aria-label={label}
      name={label.toLowerCase().replace(/\s+/g, "-")}
      autoComplete="off"
      inputMode={inputMode}
      maxLength={maxLength}
      data-object-primary={dataObjectPrimary}
      data-object-key={dataObjectKey}
      data-object-column={dataObjectColumn}
      onChange={(event) => {
        const input = event.currentTarget;
        const expansion = expandSymbols
          ? expandSymbolCommands(
              input.value,
              input.selectionStart ?? input.value.length,
              input.selectionEnd ?? input.value.length,
            )
          : null;
        const next = expansion?.value ?? input.value;
        setDraft(next);
        onValidationChange?.(validate?.(next) ?? null);
        if (expansion?.changed) {
          window.requestAnimationFrame(() => {
            input.setSelectionRange(
              expansion.selectionStart,
              expansion.selectionEnd,
            );
          });
        }
      }}
      onBlur={() => {
        if (skipBlurCommitRef.current) {
          skipBlurCommitRef.current = false;
          return;
        }
        commit();
      }}
      onKeyDown={(event) => {
        onObjectKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          skipBlurCommitRef.current = true;
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          skipBlurCommitRef.current = true;
          setDraft(value);
          onValidationChange?.(undefined);
          event.currentTarget.blur();
        }
      }}
      spellCheck={false}
    />
  );
}

function parsePointSequence(value: string, points: Point[]) {
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return null;
  const knownIds = new Set(points.map((point) => point.id));
  let ids = trimmed.split(/[\s,;→-]+/).filter(Boolean);
  if (
    ids.length === 1 &&
    !knownIds.has(ids[0]) &&
    /^(?:[A-Z]\d*)+$/.test(ids[0])
  ) {
    ids = ids[0].match(/[A-Z]\d*/g) ?? [];
  }
  return ids.length >= 2 && ids.every((id) => knownIds.has(id))
    ? ids
    : null;
}

function ObjectVisibilityButton({
  visible,
  showLabel,
  hideLabel,
  onClick,
}: {
  visible: boolean;
  showLabel: string;
  hideLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`object-visibility ${visible ? "" : "is-hidden"}`}
      onClick={onClick}
      title={visible ? hideLabel : showLabel}
      aria-label={visible ? hideLabel : showLabel}
      aria-pressed={visible}
    >
      <span aria-hidden="true">{visible ? "◉" : "○"}</span>
    </button>
  );
}

export function ObjectAddActions({
  points,
  t,
  onAddPoint,
  onAddShape,
}: Pick<
  ObjectSectionProps,
  "points" | "t" | "onAddPoint" | "onAddShape"
>) {
  const [shapeAddOpen, setShapeAddOpen] = useState(false);
  const focusCreated = (key: string | null) => {
    if (!key) return;
    window.requestAnimationFrame(() => {
      const target = Array.from(
        document.querySelectorAll<HTMLElement>("[data-object-primary]"),
      ).find((element) => element.dataset.objectPrimary === key);
      target?.focus();
    });
  };

  return (
    <>
      <button
        type="button"
        className="round-add"
        onClick={() => {
          const id = onAddPoint();
          focusCreated(`point-${id}`);
        }}
        title={t("Добавить точку", "Add point")}
        aria-label={t("Добавить точку", "Add point")}
      >
        +
      </button>
      <div className="object-shape-add object-shape-add-compact">
        <button
          type="button"
          className={`round-add examples-trigger ${
            shapeAddOpen ? "active" : ""
          }`}
          aria-haspopup="menu"
          aria-expanded={shapeAddOpen}
          onClick={() => setShapeAddOpen((current) => !current)}
          title={t("Добавить фигуру", "Add shape")}
          aria-label={t("Добавить фигуру", "Add shape")}
        >
          ▾
        </button>
        {shapeAddOpen && (
          <div
            className="object-shape-menu"
            role="menu"
            aria-label={t(
              "Выберите тип фигуры",
              "Choose a shape type",
            )}
          >
            {SHAPE_TYPES.map((option) => {
              const requiredPoints =
                option.pointCounts === "polygon"
                  ? option.type === "polyline"
                    ? 2
                    : 3
                  : option.pointCounts[0];
              return (
                <button
                  type="button"
                  role="menuitem"
                  key={option.type}
                  title={
                    points.length < requiredPoints
                      ? t(
                          `Нужно точек: ${requiredPoints}`,
                          `Points required: ${requiredPoints}`,
                        )
                      : undefined
                  }
                  onClick={() => {
                    const id = onAddShape(option.type);
                    if (id) {
                      setShapeAddOpen(false);
                      focusCreated(`shape-${id}`);
                    }
                  }}
                >
                  <b>{t(option.ru, option.en)}</b>
                  <small>
                    {requiredPoints === 0
                      ? t("Без опорных точек", "No anchor points")
                      : t(
                          `${requiredPoints} точки`,
                          `${requiredPoints} points`,
                        )}
                  </small>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

export function ObjectsSection({
  points,
  shapes,
  groups,
  t,
  onRenamePoint,
  onUpdatePoint,
  onUpdateShape,
  onSelectPoint,
  onSelectPoints,
  onDeletePoint,
  onDeleteShape,
  onNavigateNextSection,
  renderGroupHeader,
  draggedGroupId,
  onApplyObjectOrdering,
  shadowedEquationVariables,
}: ObjectSectionProps) {
  const [draggedObject, setDraggedObject] = useState<{
    kind: "point" | "shape";
    id: string;
  } | null>(null);
  const draggedObjectRef = useRef<typeof draggedObject>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const lastPointerYRef = useRef<number | null>(null);
  const dragStepRef = useRef({ pointerY: 0, distance: 16 });
  const lastDragZoneRef = useRef<string | null>(null);
  const dragAnchorRef = useRef<{
    pointerY: number;
    offsetY: number;
    scrollRegion: HTMLElement;
  } | null>(null);
  const pointsRef = useRef(points);
  const shapesRef = useRef(shapes);
  const groupsRef = useRef(groups);
  const [draftErrors, setDraftErrors] = useState<
    Record<string, string | null>
  >({});

  useEffect(() => {
    pointsRef.current = points;
    shapesRef.current = shapes;
    groupsRef.current = groups;
  }, [groups, points, shapes]);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const orderedObjectItems = () => [
    ...pointsRef.current.map((point) => ({
      id: `point:${point.id}`,
      groupId: point.groupId,
      editorOrder: point.editorOrder,
    })),
    ...shapesRef.current.map((shape) => ({
      id: `shape:${shape.id}`,
      groupId: shape.groupId,
      editorOrder: shape.editorOrder,
    })),
  ];

  const commitObjectMove = (
    kind: "point" | "shape",
    id: string,
    parentGroupId: string | undefined,
    target: { kind: "item" | "group"; id: string } | null,
    placement: "before" | "after" | "first" | "last",
  ) => {
    const moved = moveEditorRow(
      orderedObjectItems(),
      groupsRef.current,
      `${kind}:${id}`,
      parentGroupId,
      target,
      placement,
    );
    const byId = new Map(moved.items.map((item) => [item.id, item]));
    pointsRef.current = pointsRef.current.map((point) => ({
      ...point,
      groupId: byId.get(`point:${point.id}`)?.groupId,
      editorOrder: byId.get(`point:${point.id}`)?.editorOrder,
    }));
    shapesRef.current = shapesRef.current.map((shape) => ({
      ...shape,
      groupId: byId.get(`shape:${shape.id}`)?.groupId,
      editorOrder: byId.get(`shape:${shape.id}`)?.editorOrder,
    }));
    const movedGroups = new Map(
      moved.groups.map((group) => [group.id, group]),
    );
    groupsRef.current = groupsRef.current.map(
      (group) => movedGroups.get(group.id) ?? group,
    );
    onApplyObjectOrdering(moved.items, groupsRef.current);
  };

  const moveObjectStep = (
    kind: "point" | "shape",
    id: string,
    direction: -1 | 1,
  ) => {
    const sourceId = `${kind}:${id}`;
    const sectionGroups = groupsRef.current.filter(
      (group) => group.section === "objects",
    );
    const moved = moveEditorRowOneStep(
      orderedObjectItems(),
      sectionGroups,
      sourceId,
      direction,
    );
    const byId = new Map(moved.items.map((item) => [item.id, item]));
    pointsRef.current = pointsRef.current.map((point) => ({
      ...point,
      groupId: byId.get(`point:${point.id}`)?.groupId,
      editorOrder: byId.get(`point:${point.id}`)?.editorOrder,
    }));
    shapesRef.current = shapesRef.current.map((shape) => ({
      ...shape,
      groupId: byId.get(`shape:${shape.id}`)?.groupId,
      editorOrder: byId.get(`shape:${shape.id}`)?.editorOrder,
    }));
    const movedGroups = new Map(
      moved.groups.map((group) => [group.id, group]),
    );
    groupsRef.current = groupsRef.current.map(
      (group) => movedGroups.get(group.id) ?? group,
    );
    onApplyObjectOrdering(moved.items, groupsRef.current);
  };

  const focusPrimary = (key: string) => {
    const target = Array.from(
      document.querySelectorAll<HTMLElement>("[data-object-primary]"),
    ).find((element) => element.dataset.objectPrimary === key);
    target?.focus();
  };

  const focusField = (key: string, column: string) => {
    const fields = Array.from(
      document.querySelectorAll<HTMLElement>("[data-object-key]"),
    );
    const sameColumn = fields.find(
      (element) =>
        element.dataset.objectKey === key &&
        element.dataset.objectColumn === column,
    );
    if (sameColumn) {
      sameColumn.focus();
      if (
        sameColumn instanceof HTMLInputElement &&
        sameColumn.type === "text"
      ) {
        sameColumn.setSelectionRange(
          sameColumn.value.length,
          sameColumn.value.length,
        );
      }
      return;
    }
    focusPrimary(key);
  };

  const handleObjectKeyDown = (
    kind: "point" | "shape",
    id: string,
    column: string,
    event: KeyboardEvent<HTMLElement>,
  ) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const direction = event.key === "ArrowUp" ? -1 : 1;
    if (event.altKey) {
      event.preventDefault();
      moveObjectStep(kind, id, direction);
      window.requestAnimationFrame(() =>
        focusField(`${kind}-${id}`, column),
      );
      return;
    }
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (
      !focusAdjacentEditorEntry(
        event.currentTarget,
        direction,
        column,
      )
    ) {
      if (direction === 1) {
        event.preventDefault();
        onNavigateNextSection();
      }
      return;
    }
    event.preventDefault();
  };

  const objectDragHandleProps = (
    kind: "point" | "shape",
    id: string,
  ) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      const next = { kind, id };
      draggedObjectRef.current = next;
      setDraggedObject(next);
      lastPointerYRef.current = event.clientY;
      const sourceRow = event.currentTarget.closest<HTMLElement>(
        "[data-object-row]",
      );
      const sourceBounds = sourceRow?.getBoundingClientRect();
      const scrollRegion = event.currentTarget.closest<HTMLElement>(
        ".expressions",
      );
      dragAnchorRef.current =
        sourceBounds && scrollRegion
          ? {
              pointerY: event.clientY,
              offsetY: Math.max(0, Math.min(sourceBounds.height, event.clientY - sourceBounds.top)),
              scrollRegion,
            }
          : null;
      dragStepRef.current = {
        pointerY: event.clientY,
        distance: Math.max(12, (sourceBounds?.height ?? 40) * 0.42),
      };
      lastDragZoneRef.current = null;
      const syncDraggedRowToPointer = (pointerY: number) => {
        const row = Array.from(
          document.querySelectorAll<HTMLElement>("[data-object-row]"),
        ).find(
          (candidate) =>
            candidate.dataset.objectKind === kind &&
            candidate.dataset.objectRow === id,
        );
        if (!row || !dragAnchorRef.current) return;
        row.style.removeProperty("--object-drag-y");
        const bounds = row.getBoundingClientRect();
        const desiredTop = pointerY - dragAnchorRef.current.offsetY;
        row.style.setProperty(
          "--object-drag-y",
          `${desiredTop - bounds.top}px`,
        );
      };

      dragCleanupRef.current?.();
      const move = (moveEvent: PointerEvent) => {
        const current = draggedObjectRef.current;
        if (!current || current.kind !== kind || current.id !== id) return;
        moveEvent.preventDefault();
        const pointerDirection =
          lastPointerYRef.current === null
            ? 0
            : Math.sign(moveEvent.clientY - lastPointerYRef.current);
        if (dragAnchorRef.current) {
          dragAnchorRef.current.pointerY = moveEvent.clientY;
          if (moveEvent.clientY < 0) {
            dragAnchorRef.current.scrollRegion.scrollBy({ top: -Math.max(8, -moveEvent.clientY) });
          } else if (moveEvent.clientY > window.innerHeight) {
            dragAnchorRef.current.scrollRegion.scrollBy({ top: Math.max(8, moveEvent.clientY - window.innerHeight) });
          }
        }
        syncDraggedRowToPointer(moveEvent.clientY);
        const stepDelta = moveEvent.clientY - dragStepRef.current.pointerY;
        if (Math.abs(stepDelta) < dragStepRef.current.distance) {
          return;
        }
        lastPointerYRef.current = moveEvent.clientY;
        const hitBounds = dragAnchorRef.current?.scrollRegion.getBoundingClientRect();
        const hit = document.elementFromPoint(
          hitBounds ? hitBounds.left + hitBounds.width / 2 : moveEvent.clientX,
          moveEvent.clientY,
        );
        const sourceItem = orderedObjectItems().find(
          (item) => item.id === `${kind}:${id}`,
        );
        const boundary = hit?.closest<HTMLElement>(
          "[data-editor-group-boundary]",
        );
        const boundaryGroupId = boundary?.dataset.editorGroupId;
        if (
          boundary?.dataset.editorGroupSection === "objects" &&
          boundaryGroupId
        ) {
          const zoneKey = `boundary:${boundaryGroupId}:${sourceItem?.groupId}`;
          if (lastDragZoneRef.current === zoneKey) return;
          lastDragZoneRef.current = zoneKey;
          if (sourceItem?.groupId === boundaryGroupId) {
            const parent = groupsRef.current.find(
              (group) => group.id === boundaryGroupId,
            );
            commitObjectMove(
              kind,
              id,
              parent?.parentGroupId,
              { kind: "group", id: boundaryGroupId },
              "after",
            );
          } else {
            commitObjectMove(kind, id, boundaryGroupId, null, "last");
          }
          dragStepRef.current = {
            pointerY: moveEvent.clientY,
            distance: 10,
          };
          window.requestAnimationFrame(() =>
            syncDraggedRowToPointer(moveEvent.clientY),
          );
          return;
        }
        const groupTarget = hit?.closest<HTMLElement>(
          ".editor-group-header[data-editor-group-id]",
        );
        if (
          groupTarget?.dataset.editorGroupSection === "objects" &&
          groupTarget.dataset.editorGroupId
        ) {
          const groupId = groupTarget.dataset.editorGroupId;
          const targetGroup = groupsRef.current.find(
            (group) => group.id === groupId,
          );
          if (!targetGroup) return;
          const bounds = groupTarget.getBoundingClientRect();
          const relativeY = (moveEvent.clientY - bounds.top) / bounds.height;
          const collapsed = targetGroup.collapsed === true;
          const action = pointerDirection < 0
            ? "before"
            : !collapsed && relativeY >= 0.58
              ? "inside"
              : relativeY < 0.58
                ? "before"
                : "after";
          const zoneKey = `group:${groupId}:${action}`;
          if (lastDragZoneRef.current === zoneKey) return;
          lastDragZoneRef.current = zoneKey;
          if (action === "inside") {
            commitObjectMove(kind, id, groupId, null, "first");
          } else {
            commitObjectMove(
              kind,
              id,
              targetGroup.parentGroupId,
              { kind: "group", id: groupId },
              action,
            );
          }
          dragStepRef.current = {
            pointerY: moveEvent.clientY,
            distance: Math.max(12, bounds.height * 0.42),
          };
          window.requestAnimationFrame(() =>
            syncDraggedRowToPointer(moveEvent.clientY),
          );
          return;
        }
        const target = hit?.closest<HTMLElement>("[data-object-row]");
        if (
          (target?.dataset.objectKind !== "point" &&
            target?.dataset.objectKind !== "shape") ||
          !target.dataset.objectRow ||
          target.dataset.objectRow === id
        ) {
          return;
        }
        const targetKind = target.dataset.objectKind;
        const targetId = target.dataset.objectRow;
        const targetItem = orderedObjectItems().find(
          (item) => item.id === `${targetKind}:${targetId}`,
        );
        const bounds = target.getBoundingClientRect();
        const placement =
          moveEvent.clientY < bounds.top + bounds.height / 2
            ? "before"
            : "after";
        const zoneKey = `row:${targetKind}:${targetId}:${placement}`;
        if (lastDragZoneRef.current === zoneKey) return;
        lastDragZoneRef.current = zoneKey;
        commitObjectMove(
          kind,
          id,
          targetItem?.groupId,
          { kind: "item", id: `${targetKind}:${targetId}` },
          placement,
        );
        dragStepRef.current = {
          pointerY: moveEvent.clientY,
          distance: Math.max(12, bounds.height * 0.42),
        };
        window.requestAnimationFrame(() =>
          syncDraggedRowToPointer(moveEvent.clientY),
        );
      };
      const finish = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        dragCleanupRef.current = null;
        draggedObjectRef.current = null;
        dragAnchorRef.current = null;
        lastPointerYRef.current = null;
        lastDragZoneRef.current = null;
        dragStepRef.current = { pointerY: 0, distance: 16 };
        document
          .querySelectorAll<HTMLElement>("[data-object-row]")
          .forEach((row) => row.style.removeProperty("--object-drag-y"));
        setDraggedObject(null);
      };
      dragCleanupRef.current = finish;
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (
        event.altKey &&
        (event.key === "ArrowUp" || event.key === "ArrowDown")
      ) {
        event.preventDefault();
        moveObjectStep(kind, id, event.key === "ArrowUp" ? -1 : 1);
      }
    },
  });

  const pointCountError = (
    type: Shape["type"],
    count: number,
  ) => {
    const option = SHAPE_TYPES.find((item) => item.type === type);
    const label = option ? t(option.ru, option.en) : type;
    const requirement = shapePointRequirement(type);
    return requirement.maximum === Number.POSITIVE_INFINITY
      ? t(
          `Для «${label}» нужно минимум ${requirement.minimum} точки; сейчас ${count}`,
          `“${label}” needs at least ${requirement.minimum} points; currently ${count}`,
        )
      : t(
          `Для «${label}» нужно ровно ${requirement.minimum} точки; сейчас ${count}`,
          `“${label}” needs exactly ${requirement.minimum} points; currently ${count}`,
        );
  };

  const updateDraftError = (
    key: string,
    error: string | null | undefined,
  ) => {
    setDraftErrors((current) => {
      if (error === undefined) {
        if (!(key in current)) return current;
        const next = { ...current };
        delete next[key];
        return next;
      }
      if (current[key] === error && key in current) return current;
      return { ...current, [key]: error };
    });
  };

  const pointNameError = (point: Point, value: string) => {
    const nextId = value.trim().toUpperCase();
    if (!/^[A-Z]\d*$/.test(nextId)) {
      return t(
        "Имя точки: латинская буква A–Z и необязательные цифры",
        "Use a Latin letter A–Z followed by optional digits",
      );
    }
    if (
      nextId !== point.id &&
      points.some((candidate) => candidate.id === nextId)
    ) {
      return t(
        `Точка ${nextId} уже существует`,
        `Point ${nextId} already exists`,
      );
    }
    return null;
  };

  const coordinateError = (value: string) =>
    value.trim() && Number.isFinite(Number(value.replace(",", ".")))
      ? null
      : t("Введите конечное число", "Enter a finite number");

  const shapePointsError = (shape: Shape, value: string) => {
    if (shape.type === "equation") {
      return null;
    }
    const nextPoints = parsePointSequence(value, points);
    if (!nextPoints) {
      return t(
        "Укажите минимум две существующие точки",
        "Enter at least two existing points",
      );
    }
    return isValidShapePointCount(shape.type, nextPoints.length)
      ? null
      : pointCountError(shape.type, nextPoints.length);
  };

  const equationNameError = (shape: Shape, value: string) => {
    const name = value.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      return t(
        "Имя уравнения должно начинаться с латинской буквы или _",
        "Equation name must start with a Latin letter or _",
      );
    }
    if (
      shapes.some(
        (candidate) =>
          candidate.id !== shape.id &&
          candidate.name?.toLowerCase() === name.toLowerCase(),
      )
    ) {
      return t(
        `Имя ${name} уже используется`,
        `The name ${name} is already in use`,
      );
    }
    return null;
  };

  const equationSourceError = (shape: Shape, value: string) => {
    const equation = compileImplicitEquation(value);
    if (!equation) {
      return t(
        "Введите уравнение с =, <, >, ≤ или ≥",
        "Enter an equation using =, <, >, ≤ or ≥",
      );
    }
    return null;
  };

  const pointFallbackOrder = new Map(
    points.map((point, index) => [point.id, index]),
  );
  const shapeFallbackOrder = new Map(
    shapes.map((shape, index) => [shape.id, points.length + index]),
  );
  const catalogItems = [
    ...points.map((point, index) => ({
      id: `point:${point.id}`,
      kind: "point" as const,
      point,
      groupId: point.groupId,
      editorOrder: point.editorOrder ?? index,
    })),
    ...shapes.map((shape, index) => ({
      id: `shape:${shape.id}`,
      kind: "shape" as const,
      shape,
      groupId: shape.groupId,
      editorOrder: shape.editorOrder ?? points.length + index,
    })),
  ];
  const catalogBuckets: Array<{
    id: string;
    kind: "item" | "group" | "groupEnd";
    group: EditorGroup | undefined;
    depth: number;
    count: number;
    points: Point[];
    shapes: Shape[];
  }> = buildGroupedEntries(catalogItems, groups).map((entry) => {
    if (entry.kind === "group" || entry.kind === "groupEnd") {
      return {
        id: `${entry.kind}:${entry.group.id}`,
        kind: entry.kind,
        group: entry.group,
        depth: entry.depth,
        count: entry.kind === "group" ? entry.count : 0,
        points: [],
        shapes: [],
      };
    }
    return {
      id: entry.item.id,
      kind: "item",
      group: undefined,
      depth: entry.depth,
      count: 0,
      points: entry.item.kind === "point" ? [entry.item.point] : [],
      shapes: entry.item.kind === "shape" ? [entry.item.shape] : [],
    };
  });

  return (
    <div className="object-catalog">
      {!points.length && !shapes.length && (
        <p className="object-catalog-empty">
          {t(
            "Пока нет точек и фигур. Создайте их на чертеже.",
            "There are no points or shapes yet. Create them on the canvas.",
          )}
        </p>
      )}

      {catalogBuckets.map((bucket) =>
        bucket.kind === "groupEnd" && bucket.group ? (
          <EditorGroupBoundaryDropZone
            key={bucket.id}
            group={bucket.group}
            visible={Boolean(draggedObject || draggedGroupId)}
            t={t}
            depth={bucket.depth}
          />
        ) : (
        <div
          className={`object-catalog-bucket ${
            bucket.group ? "is-custom-group" : "is-ungrouped"
          }`}
          style={{ marginLeft: bucket.depth * 8 }}
          key={bucket.id}
        >
          {bucket.group &&
            renderGroupHeader(
              bucket.group,
              bucket.count,
              bucket.depth,
            )}
          {!bucket.group?.collapsed && (
            <div className="object-list unified-object-list">
      {bucket.points.length > 0 && (
        <>
            {bucket.points.map((point) => {
              const nameErrorKey = `point-${point.id}-name`;
              const xErrorKey = `point-${point.id}-x`;
              const yErrorKey = `point-${point.id}-y`;
              const pointError =
                draftErrors[nameErrorKey] ||
                draftErrors[xErrorKey] ||
                draftErrors[yErrorKey];
              return (
              <div
                className="object-list-entry"
                key={point.id}
                style={{
                  order:
                    point.editorOrder ??
                    pointFallbackOrder.get(point.id) ??
                    0,
                }}
              >
              <div
                className={`object-row point-object-row ${
                  point.visible === false ? "is-object-hidden" : ""
                } ${
                  pointError ? "has-object-error" : ""
                } ${
                  draggedObject?.kind === "point" &&
                  draggedObject.id === point.id
                    ? "is-reordering"
                    : ""
                }`}
                data-editor-navigation-entry=""
                data-editor-navigation-kind="object"
                data-editor-navigation-section="objects"
                data-object-kind="point"
                data-object-group-id={point.groupId ?? ""}
                data-object-row={point.id}
              >
                <button
                  className="object-drag-handle"
                  type="button"
                  title={t(
                    "Перетащить · Alt+↑/↓",
                    "Drag · Alt+↑/↓",
                  )}
                  aria-label={t(
                    `Переместить точку ${point.id}`,
                    `Move point ${point.id}`,
                  )}
                  {...objectDragHandleProps("point", point.id)}
                >
                  ⠿
                </button>
                <ObjectVisibilityButton
                  visible={point.visible !== false}
                  showLabel={t(
                    `Показать точку ${point.id}`,
                    `Show point ${point.id}`,
                  )}
                  hideLabel={t(
                    `Скрыть точку ${point.id}`,
                    `Hide point ${point.id}`,
                  )}
                  onClick={() =>
                    onUpdatePoint(point.id, {
                      visible: point.visible === false,
                    })
                  }
                />
                <button
                  className="object-select"
                  onClick={() => onSelectPoint(point.id)}
                  title={t("Показать точку на чертеже", "Select on canvas")}
                  aria-label={t(
                    `Выбрать точку ${point.id}`,
                    `Select point ${point.id}`,
                  )}
                >
                  ●
                </button>
                <EditableValue
                  className="object-name-input"
                  value={point.id}
                  maxLength={16}
                  dataObjectPrimary={`point-${point.id}`}
                  dataObjectKey={`point-${point.id}`}
                  dataObjectColumn="name"
                  label={t(
                    `Имя точки ${point.id}`,
                    `Point ${point.id} name`,
                  )}
                  validate={(value) => pointNameError(point, value)}
                  onValidationChange={(error) =>
                    updateDraftError(nameErrorKey, error)
                  }
                  onCommit={(value) => onRenamePoint(point.id, value)}
                  onObjectKeyDown={(event) =>
                    handleObjectKeyDown(
                      "point",
                      point.id,
                      "name",
                      event,
                    )
                  }
                />
                <label>
                  <span>x</span>
                  <EditableValue
                    value={String(point.x)}
                    dataObjectKey={`point-${point.id}`}
                    dataObjectColumn="x"
                    label={`x(${point.id})`}
                    inputMode="decimal"
                    validate={coordinateError}
                    onValidationChange={(error) =>
                      updateDraftError(xErrorKey, error)
                    }
                    onObjectKeyDown={(event) =>
                      handleObjectKeyDown(
                        "point",
                        point.id,
                        "x",
                        event,
                      )
                    }
                    onCommit={(value) => {
                      const parsed = Number(value.replace(",", "."));
                      if (!Number.isFinite(parsed)) return false;
                      onUpdatePoint(point.id, { x: parsed });
                    }}
                  />
                </label>
                <label>
                  <span>y</span>
                  <EditableValue
                    value={String(point.y)}
                    dataObjectKey={`point-${point.id}`}
                    dataObjectColumn="y"
                    label={`y(${point.id})`}
                    inputMode="decimal"
                    validate={coordinateError}
                    onValidationChange={(error) =>
                      updateDraftError(yErrorKey, error)
                    }
                    onObjectKeyDown={(event) =>
                      handleObjectKeyDown(
                        "point",
                        point.id,
                        "y",
                        event,
                      )
                    }
                    onCommit={(value) => {
                      const parsed = Number(value.replace(",", "."));
                      if (!Number.isFinite(parsed)) return false;
                      onUpdatePoint(point.id, { y: parsed });
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="object-delete"
                  onClick={() => onDeletePoint(point.id)}
                  title={t(
                    `Удалить точку ${point.id}`,
                    `Delete point ${point.id}`,
                  )}
                  aria-label={t(
                    `Удалить точку ${point.id}`,
                    `Delete point ${point.id}`,
                  )}
                >
                  ×
                </button>
              </div>
              {pointError && (
                <div className="object-inline-error" role="alert">
                  {pointError}
                </div>
              )}
              </div>
              );
            })}
        </>
      )}

      {bucket.shapes.length > 0 && (
        <>
            {bucket.shapes.map((shape) => {
              const index = shapes.findIndex(
                (item) => item.id === shape.id,
              );
              const isEquationShape = shape.type === "equation";
              const pointsErrorKey = `shape-${shape.id}-points`;
              const nameErrorKey = `shape-${shape.id}-name`;
              const equationErrorKey = `shape-${shape.id}-equation`;
              const committedShapeError = isEquationShape
                ? equationNameError(shape, shape.name ?? "") ??
                  equationSourceError(shape, shape.equation ?? "")
                : isValidShapePointCount(shape.type, shape.points.length)
                  ? null
                  : pointCountError(shape.type, shape.points.length);
              const shapeError =
                (nameErrorKey in draftErrors
                  ? draftErrors[nameErrorKey]
                  : null) ??
                (equationErrorKey in draftErrors
                  ? draftErrors[equationErrorKey]
                  : null) ??
                (pointsErrorKey in draftErrors
                  ? draftErrors[pointsErrorKey]
                  : committedShapeError);
              return (
              <div
                className="object-list-entry"
                key={shape.id}
                style={{
                  order:
                    shape.editorOrder ??
                    shapeFallbackOrder.get(shape.id) ??
                    0,
                }}
              >
              <div
                className={`object-row shape-object-row ${
                  isEquationShape ? "is-equation" : ""
                } ${
                  shape.visible === false ? "is-object-hidden" : ""
                } ${
                  shapeError ? "has-object-error" : ""
                } ${
                  draggedObject?.kind === "shape" &&
                  draggedObject.id === shape.id
                    ? "is-reordering"
                    : ""
                }`}
                data-editor-navigation-entry=""
                data-editor-navigation-kind="object"
                data-editor-navigation-section="objects"
                data-object-kind="shape"
                data-object-group-id={shape.groupId ?? ""}
                data-object-row={shape.id}
              >
                <button
                  className="object-drag-handle"
                  type="button"
                  title={t(
                    "Перетащить · Alt+↑/↓",
                    "Drag · Alt+↑/↓",
                  )}
                  aria-label={t(
                    `Переместить объект ${index + 1}`,
                    `Move object ${index + 1}`,
                  )}
                  {...objectDragHandleProps("shape", shape.id)}
                >
                  ⠿
                </button>
                <ObjectVisibilityButton
                  visible={shape.visible !== false}
                  showLabel={t(
                    `Показать объект ${index + 1}`,
                    `Show object ${index + 1}`,
                  )}
                  hideLabel={t(
                    `Скрыть объект ${index + 1}`,
                    `Hide object ${index + 1}`,
                  )}
                  onClick={() =>
                    onUpdateShape(shape.id, {
                      visible: shape.visible === false,
                    })
                  }
                />
                {isEquationShape ? (
                  <EditableValue
                    className="object-name-input equation-object-name"
                    value={shape.name ?? ""}
                    maxLength={40}
                    dataObjectKey={`shape-${shape.id}`}
                    dataObjectColumn="name"
                    label={t("Имя уравнения", "Equation name")}
                    validate={(value) => equationNameError(shape, value)}
                    onValidationChange={(error) =>
                      updateDraftError(nameErrorKey, error)
                    }
                    onObjectKeyDown={(event) =>
                      handleObjectKeyDown("shape", shape.id, "name", event)
                    }
                    onCommit={(value) => {
                      if (equationNameError(shape, value)) return false;
                      onUpdateShape(shape.id, { name: value.trim() });
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="object-select"
                    onClick={() => onSelectPoints(shape.points)}
                    title={t(
                      "Выделить все точки объекта на чертеже",
                      "Select all object points on canvas",
                    )}
                    aria-label={t(
                      `Выделить точки объекта ${index + 1}`,
                      `Select object ${index + 1} points`,
                    )}
                  >
                    <span aria-hidden="true">◎</span>
                  </button>
                )}
                <input
                  className="object-color"
                  type="color"
                  name={`shape-color-${shape.id}`}
                  data-object-key={`shape-${shape.id}`}
                  data-object-column="color"
                  value={shape.color}
                  aria-label={t(
                    `Цвет объекта ${index + 1}`,
                    `Object ${index + 1} color`,
                  )}
                  onKeyDown={(event) =>
                    handleObjectKeyDown(
                      "shape",
                      shape.id,
                      "color",
                      event,
                    )
                  }
                  onChange={(event) =>
                    onUpdateShape(shape.id, {
                      color: event.currentTarget.value,
                    })
                  }
                />
                <select
                  data-object-primary={`shape-${shape.id}`}
                  data-object-key={`shape-${shape.id}`}
                  data-object-column="type"
                  name={`shape-type-${shape.id}`}
                  value={shape.type}
                  aria-invalid={Boolean(committedShapeError)}
                  aria-label={t(
                    `Тип объекта ${index + 1}`,
                    `Object ${index + 1} type`,
                  )}
                  onKeyDown={(event) =>
                    handleObjectKeyDown(
                      "shape",
                      shape.id,
                      "type",
                      event,
                    )
                  }
                  onChange={(event) => {
                    const nextType = event.currentTarget
                      .value as Shape["type"];
                    const nextIsEquation = nextType === "equation";
                    if (nextIsEquation) {
                      updateDraftError(pointsErrorKey, undefined);
                    } else if (
                      !isValidShapePointCount(nextType, shape.points.length)
                    ) {
                      updateDraftError(
                        pointsErrorKey,
                        pointCountError(nextType, shape.points.length),
                      );
                    } else {
                      updateDraftError(pointsErrorKey, undefined);
                    }
                    onUpdateShape(shape.id, {
                      type: nextType,
                      points: nextIsEquation ? [] : shape.points,
                      name: nextIsEquation ? shape.name ?? `f${index + 1}` : undefined,
                      equation: nextIsEquation
                        ? shape.equation ?? "y = 0"
                        : undefined,
                      arc:
                        nextType === "sector"
                          ? "clockwise"
                          : nextType === "circularSegment"
                            ? shape.arc === "major"
                              ? "major"
                              : "minor"
                          : undefined,
                    });
                  }}
                >
                  {SHAPE_TYPES.map((option) => (
                    <option value={option.type} key={option.type}>
                      {t(option.ru, option.en)}
                    </option>
                  ))}
                </select>
                {isEquationShape ? (
                  <EditableValue
                    className="object-equation-input"
                    value={shape.equation ?? ""}
                    maxLength={2000}
                    dataObjectKey={`shape-${shape.id}`}
                    dataObjectColumn="equation"
                    label={t("Уравнение объекта", "Object equation")}
                    expandSymbols
                    validate={(value) => equationSourceError(shape, value)}
                    onValidationChange={(error) =>
                      updateDraftError(equationErrorKey, error)
                    }
                    onObjectKeyDown={(event) =>
                      handleObjectKeyDown(
                        "shape",
                        shape.id,
                        "equation",
                        event,
                      )
                    }
                    onCommit={(value) => {
                      if (equationSourceError(shape, value)) return false;
                      onUpdateShape(shape.id, { equation: value.trim() });
                    }}
                  />
                ) : (
                  <EditableValue
                    className="object-points-input"
                    value={shape.points.join(", ")}
                    dataObjectKey={`shape-${shape.id}`}
                    dataObjectColumn="points"
                    label={t(
                      `Точки объекта ${index + 1}`,
                      `Object ${index + 1} points`,
                    )}
                    validate={(value) => shapePointsError(shape, value)}
                    onValidationChange={(error) =>
                      updateDraftError(pointsErrorKey, error)
                    }
                    onObjectKeyDown={(event) =>
                      handleObjectKeyDown(
                        "shape",
                        shape.id,
                        "points",
                        event,
                      )
                    }
                    onCommit={(value) => {
                      const nextPoints = parsePointSequence(value, points);
                      if (!nextPoints) return false;
                      if (
                        !isValidShapePointCount(
                          shape.type,
                          nextPoints.length,
                        )
                      ) {
                        return false;
                      }
                      onUpdateShape(shape.id, {
                        points: nextPoints,
                      });
                    }}
                  />
                )}
                <button
                  type="button"
                  className="object-delete"
                  onClick={() => onDeleteShape(shape.id)}
                  title={t(
                    `Удалить объект ${index + 1}`,
                    `Delete object ${index + 1}`,
                  )}
                  aria-label={t(
                    `Удалить объект ${index + 1}`,
                    `Delete object ${index + 1}`,
                  )}
                >
                  ×
                </button>
                {shape.type === "sector" && (
                  <button
                    type="button"
                    className="object-arc-direction"
                    name={`shape-arc-${shape.id}`}
                    data-object-key={`shape-${shape.id}`}
                    data-object-column="arc"
                    aria-label={t(
                      "Поменять начало и конец сектора",
                      "Swap the sector start and end",
                    )}
                    title={t(
                      "По часовой стрелке; нажмите для дополнительного сектора",
                      "Clockwise; click for the complementary sector",
                    )}
                    onKeyDown={(event) =>
                      handleObjectKeyDown(
                        "shape",
                        shape.id,
                        "arc",
                        event,
                      )
                    }
                    onClick={() =>
                      onUpdateShape(shape.id, {
                        points: [
                          shape.points[0],
                          shape.points[2],
                          shape.points[1],
                        ],
                        arc: "clockwise",
                      })
                    }
                  >
                    ↻
                  </button>
                )}
                {shape.type === "circularSegment" && (
                  <select
                    className="object-arc-select"
                    name={`shape-arc-${shape.id}`}
                    data-object-key={`shape-${shape.id}`}
                    data-object-column="arc"
                    value={shape.arc === "major" ? "major" : "minor"}
                    aria-label={t("Тип дуги", "Arc type")}
                    onKeyDown={(event) =>
                      handleObjectKeyDown(
                        "shape",
                        shape.id,
                        "arc",
                        event,
                      )
                    }
                    onChange={(event) =>
                      onUpdateShape(shape.id, {
                        arc: event.currentTarget.value as "minor" | "major",
                      })
                    }
                  >
                    <option value="minor">{t("малая", "minor")}</option>
                    <option value="major">{t("большая", "major")}</option>
                  </select>
                )}
              </div>
              {shapeError && (
                <div className="object-inline-error" role="alert">
                  {shapeError}
                </div>
              )}
              {!shapeError &&
                isEquationShape &&
                shadowedEquationVariables.length > 0 && (
                  <div className="object-inline-warning" role="status">
                    {t(
                      `Локальные координаты ${shadowedEquationVariables.join(
                        ", ",
                      )} скрывают одноимённые внешние переменные`,
                      `Local coordinates ${shadowedEquationVariables.join(
                        ", ",
                      )} shadow external variables with the same names`,
                    )}
                  </div>
                )}
              </div>
              );
            })}
        </>
      )}
            </div>
          )}
        </div>
        ),
      )}
    </div>
  );
}
