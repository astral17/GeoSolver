"use client";

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { EditorGroup, Point, Shape } from "./domain";
import {
  EditorGroupDropZone,
  focusAdjacentEditorEntry,
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
    patch: Partial<Pick<Point, "x" | "y" | "visible" | "groupId">>,
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
  onNavigateNextSection: () => void;
  onAssignPointGroup: (id: string, groupId: string | undefined) => void;
  onAssignShapeGroup: (id: string, groupId: string | undefined) => void;
  renderGroupHeader: (group: EditorGroup, count: number) => ReactNode;
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
];

function shapePointRequirement(type: Shape["type"]) {
  return type === "polygon" || type === "polyline"
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
  onCommit: (value: string) => boolean | void;
  dataObjectPrimary?: string;
  dataObjectKey?: string;
  dataObjectColumn?: string;
  validate?: (value: string) => string | null;
  onValidationChange?: (error: string | null | undefined) => void;
  onObjectKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  return <EditableValueState key={value} value={value} {...props} />;
}

function EditableValueState({
  value,
  label,
  className,
  inputMode,
  onCommit,
  dataObjectPrimary,
  dataObjectKey,
  dataObjectColumn,
  validate,
  onValidationChange,
  onObjectKeyDown,
}: {
  value: string;
  label: string;
  className?: string;
  inputMode?: "decimal" | "text";
  onCommit: (value: string) => boolean | void;
  dataObjectPrimary?: string;
  dataObjectKey?: string;
  dataObjectColumn?: string;
  validate?: (value: string) => string | null;
  onValidationChange?: (error: string | null | undefined) => void;
  onObjectKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
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
      data-object-primary={dataObjectPrimary}
      data-object-key={dataObjectKey}
      data-object-column={dataObjectColumn}
      onChange={(event) => {
        const next = event.currentTarget.value;
        setDraft(next);
        onValidationChange?.(validate?.(next) ?? null);
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
    /^[A-Z]+$/.test(ids[0])
  ) {
    ids = [...ids[0]];
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
                    {t(
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
  onMovePoint,
  onMoveShape,
  onReorderPoint,
  onReorderShape,
  onNavigateNextSection,
  onAssignPointGroup,
  onAssignShapeGroup,
  renderGroupHeader,
}: ObjectSectionProps) {
  const [draggedObject, setDraggedObject] = useState<{
    kind: "point" | "shape";
    id: string;
  } | null>(null);
  const draggedObjectRef = useRef<typeof draggedObject>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const [draftErrors, setDraftErrors] = useState<
    Record<string, string | null>
  >({});

  useEffect(() => () => dragCleanupRef.current?.(), []);

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
      if (kind === "point") onMovePoint(id, direction);
      else onMoveShape(id, direction);
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

  const reorderObject = (
    kind: "point" | "shape",
    sourceId: string,
    targetId: string,
  ) => {
    if (kind === "point") onReorderPoint(sourceId, targetId);
    else onReorderShape(sourceId, targetId);
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

      dragCleanupRef.current?.();
      const move = (moveEvent: PointerEvent) => {
        const current = draggedObjectRef.current;
        if (!current || current.kind !== kind || current.id !== id) return;
        moveEvent.preventDefault();
        const scrollRegion = document
          .elementFromPoint(moveEvent.clientX, moveEvent.clientY)
          ?.closest<HTMLElement>(".expressions");
        if (scrollRegion) {
          const bounds = scrollRegion.getBoundingClientRect();
          const edge = 54;
          if (moveEvent.clientY < bounds.top + edge) {
            scrollRegion.scrollBy({ top: -14 });
          } else if (moveEvent.clientY > bounds.bottom - edge) {
            scrollRegion.scrollBy({ top: 14 });
          }
        }
        const hit = document.elementFromPoint(
          moveEvent.clientX,
          moveEvent.clientY,
        );
        const groupTarget = hit?.closest<HTMLElement>(
          "[data-editor-group-id]",
        );
        if (
          groupTarget?.dataset.editorGroupSection === "objects" &&
          groupTarget.dataset.editorGroupId !== undefined &&
          groupTarget.dataset.editorGroupCollapsed !== "true"
        ) {
          const groupId =
            groupTarget.dataset.editorGroupId || undefined;
          if (kind === "point") onAssignPointGroup(id, groupId);
          else onAssignShapeGroup(id, groupId);
          return;
        }
        const target = hit?.closest<HTMLElement>("[data-object-row]");
        if (
          target?.dataset.objectKind !== kind ||
          !target.dataset.objectRow ||
          target.dataset.objectRow === id
        ) {
          return;
        }
        reorderObject(kind, id, target.dataset.objectRow);
      };
      const finish = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        dragCleanupRef.current = null;
        draggedObjectRef.current = null;
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
        if (kind === "point") {
          onMovePoint(id, event.key === "ArrowUp" ? -1 : 1);
        } else {
          onMoveShape(id, event.key === "ArrowUp" ? -1 : 1);
        }
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
    if (!/^[A-Z]$/.test(nextId)) {
      return t(
        "Имя точки должно быть одной латинской буквой A–Z",
        "A point name must be one Latin letter A–Z",
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

  const knownGroupIds = new Set(groups.map((group) => group.id));
  const catalogBuckets = [
    {
      id: "ungrouped",
      group: undefined,
      points: points.filter(
        (point) => !point.groupId || !knownGroupIds.has(point.groupId),
      ),
      shapes: shapes.filter(
        (shape) => !shape.groupId || !knownGroupIds.has(shape.groupId),
      ),
    },
    ...groups.map((group) => ({
      id: group.id,
      group,
      points: points.filter((point) => point.groupId === group.id),
      shapes: shapes.filter((shape) => shape.groupId === group.id),
    })),
  ];

  return (
    <div className="object-catalog">
      <EditorGroupDropZone
        section="objects"
        visible={Boolean(draggedObject)}
        t={t}
      />

      {!points.length && !shapes.length && (
        <p className="object-catalog-empty">
          {t(
            "Пока нет точек и фигур. Создайте их на чертеже.",
            "There are no points or shapes yet. Create them on the canvas.",
          )}
        </p>
      )}

      {catalogBuckets.map((bucket) => (
        <div
          className={`object-catalog-bucket ${
            bucket.group ? "is-custom-group" : "is-ungrouped"
          }`}
          key={bucket.id}
        >
          {bucket.group &&
            renderGroupHeader(
              bucket.group,
              bucket.points.length + bucket.shapes.length,
            )}
          {!bucket.group?.collapsed && (
            <>
      {bucket.points.length > 0 && (
        <div className="object-group">
          <h3>
            {t("Точки", "Points")} <span>{bucket.points.length}</span>
          </h3>
          <div className="object-list point-object-list">
            {bucket.points.map((point) => {
              const nameErrorKey = `point-${point.id}-name`;
              const xErrorKey = `point-${point.id}-x`;
              const yErrorKey = `point-${point.id}-y`;
              const pointError =
                draftErrors[nameErrorKey] ||
                draftErrors[xErrorKey] ||
                draftErrors[yErrorKey];
              return (
              <Fragment key={point.id}>
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
              </Fragment>
              );
            })}
          </div>
        </div>
      )}

      {bucket.shapes.length > 0 && (
        <div className="object-group">
          <h3>
            {t("Фигуры и линии", "Shapes and lines")}{" "}
            <span>{bucket.shapes.length}</span>
          </h3>
          <div className="object-list">
            {bucket.shapes.map((shape) => {
              const index = shapes.findIndex(
                (item) => item.id === shape.id,
              );
              const pointsErrorKey = `shape-${shape.id}-points`;
              const hasDraftPointsError = pointsErrorKey in draftErrors;
              const committedShapeError = isValidShapePointCount(
                shape.type,
                shape.points.length,
              )
                ? null
                : pointCountError(shape.type, shape.points.length);
              const shapeError = hasDraftPointsError
                ? draftErrors[pointsErrorKey]
                : committedShapeError;
              return (
              <Fragment key={shape.id}>
              <div
                className={`object-row shape-object-row ${
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
                    if (
                      !isValidShapePointCount(
                        nextType,
                        shape.points.length,
                      )
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
                      arc:
                        nextType === "sector" ||
                        nextType === "circularSegment"
                          ? shape.arc ?? "minor"
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
                {(shape.type === "sector" ||
                  shape.type === "circularSegment") && (
                  <select
                    className="object-arc-select"
                    name={`shape-arc-${shape.id}`}
                    data-object-key={`shape-${shape.id}`}
                    data-object-column="arc"
                    value={shape.arc ?? "minor"}
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
              </Fragment>
              );
            })}
          </div>
        </div>
      )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
