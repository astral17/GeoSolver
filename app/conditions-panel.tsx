"use client";

import { useEffect, useState } from "react";
import type React from "react";
import type {
  AngleUnit,
  EditorGroup,
  ExpressionRow,
  Point,
  Shape,
} from "./domain";
import {
  buildGroupedEntries,
  EditorGroupAddGlyph,
  EditorGroupBoundaryDropZone,
  EditorGroupDropZone,
  EditorGroupHeader,
  focusAdjacentEditorEntry,
  focusEditorSectionEdge,
} from "./editor-groups";
import {
  deletedReferenceMessage,
  normalizeUnknownExpression,
  parseConstraint,
  parseUnknown,
} from "./expressions";
import type { Locale } from "./i18n";
import { useEditorGroupReordering } from "./group-reordering";
import {
  ObjectAddActions,
  ObjectsSection,
} from "./objects-section";

type Group = "known" | "unknown";
type RowSetter = React.Dispatch<React.SetStateAction<ExpressionRow[]>>;
type Translate = (russian: string, english: string) => string;

type ConditionsPanelProps = {
  known: ExpressionRow[];
  unknown: ExpressionRow[];
  setKnown: RowSetter;
  setUnknown: RowSetter;
  addMenu: Group | null;
  setAddMenu: React.Dispatch<React.SetStateAction<Group | null>>;
  bareAngleUnit: AngleUnit;
  points: Point[];
  shapes: Shape[];
  groups: EditorGroup[];
  setGroups: React.Dispatch<React.SetStateAction<EditorGroup[]>>;
  locale: Locale;
  draggedExpression: { group: Group; id: number } | null;
  t: Translate;
  insertExpressionAfter: (group: Group, afterId: number) => void;
  addKnownExpression: (expression: string) => void;
  addUnknownExpression: (expression: string) => void;
  expressionDragHandleProps: (
    group: Group,
    id: number,
  ) => React.ButtonHTMLAttributes<HTMLButtonElement>;
  updateRow: (
    setter: RowSetter,
    id: number,
    patch: Partial<ExpressionRow>,
  ) => void;
  updateExpressionInput: (
    setter: RowSetter,
    id: number,
    event: React.ChangeEvent<HTMLInputElement>,
  ) => void;
  moveExpressionRow: (group: Group, id: number, direction: -1 | 1) => void;
  focusAdjacentExpression: (
    group: Group,
    id: number,
    direction: -1 | 1,
  ) => boolean;
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
};

export function ConditionsPanel({
  known,
  unknown,
  setKnown,
  setUnknown,
  addMenu,
  setAddMenu,
  bareAngleUnit,
  points,
  shapes,
  groups,
  setGroups,
  locale,
  draggedExpression,
  t,
  insertExpressionAfter,
  addKnownExpression,
  addUnknownExpression,
  expressionDragHandleProps,
  updateRow,
  updateExpressionInput,
  moveExpressionRow,
  focusAdjacentExpression,
  onRenamePoint,
  onUpdatePoint,
  onUpdateShape,
  onSelectPoint,
  onSelectPoints,
  onAddPoint,
  onAddShape,
  onDeletePoint,
  onDeleteShape,
  onMovePoint,
  onMoveShape,
  onReorderPoint,
  onReorderShape,
}: ConditionsPanelProps) {
  const [expanded, setExpanded] = useState({
    objects: true,
    known: true,
    unknown: true,
  });
  const toggleSection = (section: keyof typeof expanded) => {
    setExpanded((current) => ({
      ...current,
      [section]: !current[section],
    }));
  };

  const groupsFor = (section: EditorGroup["section"]) =>
    groups.filter((group) => group.section === section);
  const objectGroups = groupsFor("objects");
  const knownGroups = groupsFor("known");
  const unknownGroups = groupsFor("unknown");
  const knownEntries = buildGroupedEntries(known, knownGroups);
  const unknownEntries = buildGroupedEntries(unknown, unknownGroups);
  const knownNumbers = new Map(
    buildGroupedEntries(
      known,
      knownGroups.map((group) => ({ ...group, collapsed: false })),
    )
      .flatMap((entry) => (entry.kind === "item" ? [entry.item.id] : []))
      .map((id, index) => [id, index + 1]),
  );
  const unknownNumbers = new Map(
    buildGroupedEntries(
      unknown,
      unknownGroups.map((group) => ({ ...group, collapsed: false })),
    )
      .flatMap((entry) => (entry.kind === "item" ? [entry.item.id] : []))
      .map((id, index) => [id, index + 1]),
  );
  const {
    draggedGroupId,
    groupDragHandleProps,
    moveEditorGroup,
  } = useEditorGroupReordering({
    groups,
    known,
    unknown,
    setGroups,
    setKnown,
    setUnknown,
  });

  const addEditorGroup = (section: EditorGroup["section"]) => {
    const id = `group-${section}-${Date.now()}`;
    setGroups((current) => [
      ...current,
      {
        id,
        section,
        name: t("Новая группа", "New group"),
      },
    ]);
    setExpanded((current) => ({ ...current, [section]: true }));
    window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(
        `[data-editor-group-id="${id}"] input`,
      );
      input?.focus();
      input?.select();
    });
  };

  const updateEditorGroup = (
    id: string,
    patch: Partial<Pick<EditorGroup, "name" | "collapsed">>,
  ) => {
    setGroups((current) =>
      current.map((group) =>
        group.id === id ? { ...group, ...patch } : group,
      ),
    );
  };

  const deleteEditorGroup = (group: EditorGroup) => {
    setGroups((current) =>
      current.filter((item) => item.id !== group.id),
    );
    if (group.section === "objects") {
      points
        .filter((point) => point.groupId === group.id)
        .forEach((point) =>
          onUpdatePoint(point.id, { groupId: undefined }),
        );
      shapes
        .filter((shape) => shape.groupId === group.id)
        .forEach((shape) =>
          onUpdateShape(shape.id, { groupId: undefined }),
        );
    } else {
      const setRows = group.section === "known" ? setKnown : setUnknown;
      setRows((current) =>
        current.map((row) =>
          row.groupId === group.id
            ? { ...row, groupId: undefined }
            : row,
        ),
      );
    }
  };

  const selectEditorGroup = (group: EditorGroup) => {
    let ids: string[] = [];
    if (group.section === "objects") {
      ids = [
        ...points
          .filter((point) => point.groupId === group.id)
          .map((point) => point.id),
        ...shapes
          .filter((shape) => shape.groupId === group.id)
          .flatMap((shape) => shape.points),
      ];
    } else {
      const rows = group.section === "known" ? known : unknown;
      ids = rows
        .filter((row) => row.groupId === group.id)
        .flatMap((row) => {
          const parsed =
            group.section === "known"
              ? parseConstraint(row.expression, bareAngleUnit)
              : parseUnknown(row.expression);
          return parsed?.ids ?? [];
        });
    }
    const existing = new Set(points.map((point) => point.id));
    onSelectPoints([...new Set(ids)].filter((id) => existing.has(id)));
  };

  const groupHeader = (group: EditorGroup, count: number) => (
    <EditorGroupHeader
      key={`header-${group.id}`}
      group={group}
      count={count}
      t={t}
      onToggle={() =>
        updateEditorGroup(group.id, { collapsed: !group.collapsed })
      }
      onRename={(name) => updateEditorGroup(group.id, { name })}
      onDelete={() => deleteEditorGroup(group)}
      onSelect={() => selectEditorGroup(group)}
      dragging={draggedGroupId === group.id}
      dragHandleProps={groupDragHandleProps(group)}
      onMove={(direction) => moveEditorGroup(group, direction)}
      onNavigate={(current, direction) =>
        navigateFromGroup(group, current, direction)
      }
    />
  );

  const focusExpression = (
    group: Group,
    id: number,
  ) => {
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLInputElement>(
          `[data-expression-input="${group}-${id}"]`,
        )
        ?.focus();
    });
  };

  useEffect(() => {
    const handleFocusRequest = (event: Event) => {
      const detail = (
        event as CustomEvent<{ group?: Group; id?: number }>
      ).detail;
      if (
        detail?.group !== "known" ||
        !Number.isSafeInteger(detail.id)
      ) {
        return;
      }
      setExpanded((current) => ({ ...current, known: true }));
      window.requestAnimationFrame(() =>
        focusExpression("known", detail.id as number),
      );
    };
    window.addEventListener(
      "geosolver:focus-expression",
      handleFocusRequest,
    );
    return () =>
      window.removeEventListener(
        "geosolver:focus-expression",
        handleFocusRequest,
      );
  });

  const focusExpressionSectionEdge = (
    group: Group,
    edge: "first" | "last",
  ) => {
    setExpanded((current) => ({ ...current, [group]: true }));
    window.requestAnimationFrame(() => {
      if (!focusEditorSectionEdge(group, edge)) {
        insertExpressionAfter(group, -1);
      }
    });
    return true;
  };

  const navigateFromObjects = () => {
    focusExpressionSectionEdge("known", "first");
  };

  const focusLastObject = () => {
    if (!points.length && !shapes.length && !objectGroups.length) {
      return false;
    }
    setExpanded((current) => ({ ...current, objects: true }));
    window.requestAnimationFrame(() =>
      focusEditorSectionEdge("objects", "last"),
    );
    return true;
  };

  const focusExpressionAcrossSections = (
    group: Group,
    id: number,
    direction: -1 | 1,
  ) => {
    if (focusAdjacentExpression(group, id, direction)) return true;
    if (group === "known" && direction === -1) {
      return focusLastObject();
    }
    if (group === "known" && direction === 1) {
      return focusExpressionSectionEdge("unknown", "first");
    }
    if (group === "unknown" && direction === -1) {
      return focusExpressionSectionEdge("known", "last");
    }
    return false;
  };

  const navigateFromGroup = (
    group: EditorGroup,
    current: HTMLInputElement,
    direction: -1 | 1,
  ) => {
    if (focusAdjacentEditorEntry(current, direction)) return true;
    if (group.section === "objects" && direction === 1) {
      return focusExpressionSectionEdge("known", "first");
    }
    if (group.section === "known" && direction === -1) {
      return focusLastObject();
    }
    if (group.section === "known" && direction === 1) {
      return focusExpressionSectionEdge("unknown", "first");
    }
    if (group.section === "unknown" && direction === -1) {
      return focusExpressionSectionEdge("known", "last");
    }
    return false;
  };

  return (
          <div
            className={`expressions ${
              draggedGroupId ? "is-group-dragging" : ""
            }`}
            role="region"
            aria-label={t("Условия и цели", "Conditions and targets")}
            tabIndex={0}
          >
            <section
              className={`conditions-section ${
                expanded.objects ? "" : "is-collapsed"
              }`}
            >
              <div className="panel-heading object-heading">
                <button
                  className="section-heading-button"
                  type="button"
                  aria-expanded={expanded.objects}
                  onClick={() => toggleSection("objects")}
                >
                  <span className="section-chevron" aria-hidden="true">
                    {expanded.objects ? "⌄" : "›"}
                  </span>
                  <span>
                    <span className="eyebrow">
                      {t("ОБЪЕКТЫ", "OBJECTS")}
                    </span>
                    <span className="section-heading-title-row">
                      <h1>{t("Описание чертежа", "Drawing objects")}</h1>
                      <em>{points.length + shapes.length}</em>
                    </span>
                  </span>
                </button>
                <div className="heading-actions">
                  <button
                    type="button"
                    className="round-add group-add"
                    onClick={() => addEditorGroup("objects")}
                    title={t("Добавить группу объектов", "Add object group")}
                    aria-label={t(
                      "Добавить группу объектов",
                      "Add object group",
                    )}
                  >
                    <EditorGroupAddGlyph />
                  </button>
                  <ObjectAddActions
                    points={points}
                    t={t}
                    onAddPoint={onAddPoint}
                    onAddShape={onAddShape}
                  />
                </div>
              </div>
              {expanded.objects && (
                <ObjectsSection
                  points={points}
                  shapes={shapes}
                  groups={objectGroups}
                  t={t}
                  onRenamePoint={onRenamePoint}
                  onUpdatePoint={onUpdatePoint}
                  onUpdateShape={onUpdateShape}
                  onSelectPoint={onSelectPoint}
                  onSelectPoints={onSelectPoints}
                  onAddPoint={onAddPoint}
                  onAddShape={onAddShape}
                  onDeletePoint={onDeletePoint}
                  onDeleteShape={onDeleteShape}
                  onMovePoint={onMovePoint}
                  onMoveShape={onMoveShape}
                  onReorderPoint={onReorderPoint}
                  onReorderShape={onReorderShape}
                  onNavigateNextSection={navigateFromObjects}
                  onAssignPointGroup={(id, groupId) =>
                    onUpdatePoint(id, { groupId })
                  }
                  onAssignShapeGroup={(id, groupId) =>
                    onUpdateShape(id, { groupId })
                  }
                  renderGroupHeader={groupHeader}
                />
              )}
            </section>

            <section
              className={`conditions-section ${
                expanded.known ? "" : "is-collapsed"
              }`}
            >
            <div className="panel-heading">
              <button
                className="section-heading-button"
                type="button"
                aria-expanded={expanded.known}
                onClick={() => toggleSection("known")}
              >
                <span className="section-chevron" aria-hidden="true">
                  {expanded.known ? "⌄" : "›"}
                </span>
                <span>
                  <span className="eyebrow">
                    {t("УСЛОВИЯ", "CONDITIONS")}
                  </span>
                  <span className="section-heading-title-row">
                    <h1>{t("Что известно", "Known facts")}</h1>
                    <em>{known.length}</em>
                  </span>
                </span>
              </button>
              <div className="heading-actions">
                <button
                  type="button"
                  className="round-add group-add"
                  onClick={() => addEditorGroup("known")}
                  title={t("Добавить группу условий", "Add condition group")}
                  aria-label={t(
                    "Добавить группу условий",
                    "Add condition group",
                  )}
                >
                  <EditorGroupAddGlyph />
                </button>
                <button
                  className="round-add"
                  onClick={() => {
                    setExpanded((current) => ({
                      ...current,
                      known: true,
                    }));
                    insertExpressionAfter(
                      "known",
                      known.at(-1)?.id ?? -1,
                    );
                  }}
                  aria-label={t(
                    "Добавить пустое условие",
                    "Add empty condition",
                  )}
                  title={t("Пустое условие", "Empty condition")}
                >
                  +
                </button>
                <button
                  className={`round-add examples-trigger ${
                    addMenu === "known" ? "active" : ""
                  }`}
                  onClick={() => {
                    setExpanded((current) => ({
                      ...current,
                      known: true,
                    }));
                    setAddMenu((menu) =>
                      menu === "known" ? null : "known",
                    );
                  }}
                  aria-label={t(
                    "Выбрать пример условия",
                    "Choose a condition example",
                  )}
                  title={t("Примеры условий", "Condition examples")}
                  aria-haspopup="menu"
                  aria-expanded={addMenu === "known"}
                >
                  ▾
                </button>
              </div>
            </div>

            {expanded.known && (
              <div className="conditions-section-body">
            {addMenu === "known" && (
              <div
                className="add-popover"
                role="menu"
                aria-label={t("Примеры условий", "Condition examples")}
              >
                <button onClick={() => addKnownExpression("AB = 5")}>
                  <b>AB = 5</b>
                  <span>{t("длина", "length")}</span>
                </button>
                <button onClick={() => addKnownExpression("∠ABC = 60°")}>
                  <b>∠ABC = 60°</b>
                  <span>{t("угол", "angle")}</span>
                </button>
                <button onClick={() => addKnownExpression("S(ABC) = 10")}>
                  <b>S(ABC) = 10</b>
                  <span>
                    {t(
                      "площадь треугольника или многоугольника",
                      "triangle or polygon area",
                    )}
                  </span>
                </button>
                <button onClick={() => addKnownExpression("x(A) = 0")}>
                  <b>x(A) = 0</b>
                  <span>{t("координата x точки", "point x-coordinate")}</span>
                </button>
                <button onClick={() => addKnownExpression("y(A) = 0")}>
                  <b>y(A) = 0</b>
                  <span>{t("координата y точки", "point y-coordinate")}</span>
                </button>
                <button onClick={() => addKnownExpression("A = (0, 0)")}>
                  <b>A = (0, 0)</b>
                  <span>{t("обе координаты точки", "both point coordinates")}</span>
                </button>
                <button onClick={() => addKnownExpression("AB ⟂ AC")}>
                  <b>AB ⟂ AC</b>
                  <span>{t("отношение", "relation")}</span>
                </button>
                <button onClick={() => addKnownExpression("A ≠ B")}>
                  <b>A ≠ B</b>
                  <span>{t("различные точки", "distinct points")}</span>
                </button>
                <button
                  onClick={() =>
                    addKnownExpression("AB ∩ CD = ∅")
                  }
                >
                  <b>AB ∩ CD = ∅</b>
                  <span>{t("отрезки не пересекаются", "segments do not intersect")}</span>
                </button>
                <button
                  onClick={() => addKnownExpression("H = EG ∩ DF")}
                >
                  <b>H = EG ∩ DF</b>
                  <span>{t("точка пересечения", "intersection point")}</span>
                </button>
                <button
                  onClick={() => addKnownExpression("∠ABC = ∠BCA")}
                >
                  <b>∠ABC = ∠BCA</b>
                  <span>{t("равенство углов", "equal angles")}</span>
                </button>
                <button
                  onClick={() =>
                    addKnownExpression("∠ABC + ∠BCA = 90°")
                  }
                >
                  <b>∠ABC + ∠BCA = 90°</b>
                  <span>{t("сумма углов", "angle sum")}</span>
                </button>
                <button onClick={() => addKnownExpression("AB + BC = AC")}>
                  <b>AB + BC = AC</b>
                  <span>{t("формула длин", "length formula")}</span>
                </button>
                <button onClick={() => addKnownExpression("AB = BC = AC")}>
                  <b>AB = BC = AC</b>
                  <span>{t("цепочка равенств", "equality chain")}</span>
                </button>
                <button onClick={() => addKnownExpression("a = AB")}>
                  <b>a = AB</b>
                  <span>{t("определение переменной", "variable definition")}</span>
                </button>
              </div>
            )}

            <div className="expression-list">
              <EditorGroupDropZone
                section="known"
                visible={draggedExpression?.group === "known"}
                t={t}
              />
              {knownEntries.map((entry) => {
                if (entry.kind === "group") {
                  return groupHeader(entry.group, entry.count);
                }
                if (entry.kind === "groupEnd") {
                  return (
                    <EditorGroupBoundaryDropZone
                      key={`end-${entry.group.id}`}
                      group={entry.group}
                      visible={draggedExpression?.group === "known"}
                      t={t}
                    />
                  );
                }
                const row = entry.item;
                const number =
                  knownNumbers.get(row.id) ??
                  known.findIndex((item) => item.id === row.id) + 1;
                const parsed = parseConstraint(
                  row.expression,
                  bareAngleUnit,
                );
                const referenceError = parsed
                  ? deletedReferenceMessage(parsed.ids, points, locale)
                  : null;
                return (
                  <div
                    className={`expression-row ${
                      referenceError ? "has-reference-error" : ""
                    } ${
                      draggedExpression?.group === "known" &&
                      draggedExpression.id === row.id
                        ? "is-reordering"
                        : ""
                    } ${
                      row.groupId ? "is-grouped" : ""
                    }`}
                    key={row.id}
                    data-expression-group="known"
                    data-expression-group-id={row.groupId ?? ""}
                    data-expression-row={row.id}
                  >
                    <button
                      className="row-drag-handle"
                      title={t("Перетащить · Alt+↑/↓", "Drag · Alt+↑/↓")}
                      aria-label={t(
                        `Переместить условие ${number}`,
                        `Move condition ${number}`,
                      )}
                      {...expressionDragHandleProps("known", row.id)}
                    >
                      ⠿
                    </button>
                    <span className="row-number">{number}</span>
                    <button
                      className={`color-toggle ${row.enabled ? "" : "off"}`}
                      style={{ "--row-color": row.color } as React.CSSProperties}
                      onClick={() =>
                        updateRow(setKnown, row.id, { enabled: !row.enabled })
                      }
                      aria-label={
                        row.enabled
                          ? t("Отключить ограничение", "Disable constraint")
                          : t("Включить ограничение", "Enable constraint")
                      }
                    />
                    <div className="expression-input-wrap">
                      <input
                        id={`known-expression-${row.id}`}
                        name={`known-expression-${row.id}`}
                        value={row.expression}
                        data-expression-input={`known-${row.id}`}
                        data-editor-navigation-entry=""
                        data-editor-navigation-kind="expression"
                        data-editor-navigation-section="known"
                        autoComplete="off"
                        onChange={(event) =>
                          updateExpressionInput(setKnown, row.id, event)
                        }
                        onKeyDown={(event) => {
                          if (
                            event.altKey &&
                            (event.key === "ArrowUp" ||
                              event.key === "ArrowDown")
                          ) {
                            event.preventDefault();
                            moveExpressionRow(
                              "known",
                              row.id,
                              event.key === "ArrowUp" ? -1 : 1,
                            );
                            return;
                          }
                          if (
                            !event.shiftKey &&
                            !event.ctrlKey &&
                            !event.metaKey &&
                            (event.key === "ArrowUp" ||
                              event.key === "ArrowDown") &&
                            focusExpressionAcrossSections(
                              "known",
                              row.id,
                              event.key === "ArrowUp" ? -1 : 1,
                            )
                          ) {
                            event.preventDefault();
                            return;
                          }
                          if (event.shiftKey && event.key === "Enter") {
                            event.preventDefault();
                            insertExpressionAfter("known", row.id);
                            return;
                          }
                          if (
                            event.key === "Enter" ||
                            event.key === "Escape"
                          ) {
                            event.preventDefault();
                            event.currentTarget.blur();
                          }
                        }}
                        spellCheck={false}
                        title={t(
                          "↑/↓ — соседняя строка · Alt+↑/↓ — переместить · Shift+Enter — добавить",
                          "↑/↓ — adjacent row · Alt+↑/↓ — move · Shift+Enter — add",
                        )}
                        aria-label={t(
                          `Известное ${number}`,
                          `Known fact ${number}`,
                        )}
                      />
                      {(referenceError || !parsed) && (
                        <span className="unrecognized">
                          {referenceError ??
                            t("проверьте запись", "check the expression")}
                        </span>
                      )}
                    </div>
                    <button
                      className="row-delete"
                      onClick={() =>
                        setKnown((current) =>
                          current.filter((item) => item.id !== row.id),
                        )
                      }
                      aria-label={t("Удалить условие", "Delete condition")}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
              </div>
            )}
            </section>

            <section
              className={`conditions-section ${
                expanded.unknown ? "" : "is-collapsed"
              }`}
            >
            <div className="panel-heading find-heading">
              <button
                className="section-heading-button"
                type="button"
                aria-expanded={expanded.unknown}
                onClick={() => toggleSection("unknown")}
              >
                <span className="section-chevron" aria-hidden="true">
                  {expanded.unknown ? "⌄" : "›"}
                </span>
                <span>
                  <span className="eyebrow">{t("ЦЕЛИ", "TARGETS")}</span>
                  <span className="section-heading-title-row">
                    <h2>{t("Что найти", "Find")}</h2>
                    <em>{unknown.length}</em>
                  </span>
                </span>
              </button>
              <div className="heading-actions">
                <button
                  type="button"
                  className="round-add group-add"
                  onClick={() => addEditorGroup("unknown")}
                  title={t("Добавить группу целей", "Add target group")}
                  aria-label={t(
                    "Добавить группу целей",
                    "Add target group",
                  )}
                >
                  <EditorGroupAddGlyph />
                </button>
                <button
                  className="round-add"
                  onClick={() => {
                    setExpanded((current) => ({
                      ...current,
                      unknown: true,
                    }));
                    insertExpressionAfter(
                      "unknown",
                      unknown.at(-1)?.id ?? -1,
                    );
                  }}
                  aria-label={t("Добавить пустую цель", "Add empty target")}
                  title={t("Пустая цель", "Empty target")}
                >
                  +
                </button>
                <button
                  className={`round-add examples-trigger ${
                    addMenu === "unknown" ? "active" : ""
                  }`}
                  onClick={() => {
                    setExpanded((current) => ({
                      ...current,
                      unknown: true,
                    }));
                    setAddMenu((menu) =>
                      menu === "unknown" ? null : "unknown",
                    );
                  }}
                  aria-label={t(
                    "Выбрать пример цели",
                    "Choose a target example",
                  )}
                  title={t("Примеры целей", "Target examples")}
                  aria-haspopup="menu"
                  aria-expanded={addMenu === "unknown"}
                >
                  ▾
                </button>
              </div>
            </div>

            {expanded.unknown && (
              <div className="conditions-section-body">
            {addMenu === "unknown" && (
              <div
                className="add-popover unknown-popover"
                role="menu"
                aria-label={t("Примеры целей", "Target examples")}
              >
                <button onClick={() => addUnknownExpression("BC = ?")}>
                  <b>BC = ?</b>
                  <span>{t("длина", "length")}</span>
                </button>
                <button onClick={() => addUnknownExpression("∠ABC = ?")}>
                  <b>∠ABC = ?</b>
                  <span>{t("угол", "angle")}</span>
                </button>
                <button onClick={() => addUnknownExpression("S(ABC) = ?")}>
                  <b>S(ABC) = ?</b>
                  <span>
                    {t(
                      "площадь треугольника или многоугольника",
                      "triangle or polygon area",
                    )}
                  </span>
                </button>
                <button onClick={() => addUnknownExpression("P(ABCD) = ?")}>
                  <b>P(ABCD) = ?</b>
                  <span>{t("периметр фигуры", "shape perimeter")}</span>
                </button>
                <button
                  onClick={() =>
                    addUnknownExpression("S(circle(AB)) = ?")
                  }
                >
                  <b>S(circle(AB)) = ?</b>
                  <span>
                    {t(
                      "площадь круга, сектора, сегмента или эллипса",
                      "circle, sector, segment or ellipse area",
                    )}
                  </span>
                </button>
                <button
                  onClick={() => addUnknownExpression("AB + BC = ?")}
                >
                  <b>AB + BC = ?</b>
                  <span>{t("значение формулы", "formula value")}</span>
                </button>
              </div>
            )}

            <div className="expression-list unknown-list">
              <EditorGroupDropZone
                section="unknown"
                visible={draggedExpression?.group === "unknown"}
                t={t}
              />
              {unknownEntries.map((entry) => {
                if (entry.kind === "group") {
                  return groupHeader(entry.group, entry.count);
                }
                if (entry.kind === "groupEnd") {
                  return (
                    <EditorGroupBoundaryDropZone
                      key={`end-${entry.group.id}`}
                      group={entry.group}
                      visible={draggedExpression?.group === "unknown"}
                      t={t}
                    />
                  );
                }
                const row = entry.item;
                const number =
                  unknownNumbers.get(row.id) ??
                  unknown.findIndex((item) => item.id === row.id) + 1;
                const target = parseUnknown(row.expression);
                const referenceError = target
                  ? deletedReferenceMessage(target.ids, points, locale)
                  : null;
                return (
                  <div
                    className={`expression-row ${
                      referenceError ? "has-reference-error" : ""
                    } ${
                      draggedExpression?.group === "unknown" &&
                      draggedExpression.id === row.id
                        ? "is-reordering"
                        : ""
                    } ${
                      row.groupId ? "is-grouped" : ""
                    }`}
                    key={row.id}
                    data-expression-group="unknown"
                    data-expression-group-id={row.groupId ?? ""}
                    data-expression-row={row.id}
                  >
                    <button
                      className="row-drag-handle"
                      title={t("Перетащить · Alt+↑/↓", "Drag · Alt+↑/↓")}
                      aria-label={t(
                        `Переместить цель ${number}`,
                        `Move target ${number}`,
                      )}
                      {...expressionDragHandleProps("unknown", row.id)}
                    >
                      ⠿
                    </button>
                    <span className="row-number">{number}</span>
                    <button
                      className={`color-toggle target ${row.enabled ? "" : "off"}`}
                      style={{ "--row-color": row.color } as React.CSSProperties}
                      onClick={() =>
                        updateRow(setUnknown, row.id, { enabled: !row.enabled })
                      }
                      aria-label={t(
                        "Включить или отключить цель",
                        "Enable or disable target",
                      )}
                    />
                    <div className="expression-input-wrap">
                      <input
                        id={`unknown-expression-${row.id}`}
                        name={`unknown-expression-${row.id}`}
                        value={row.expression}
                        data-expression-input={`unknown-${row.id}`}
                        data-editor-navigation-entry=""
                        data-editor-navigation-kind="expression"
                        data-editor-navigation-section="unknown"
                        autoComplete="off"
                        onChange={(event) =>
                          updateExpressionInput(setUnknown, row.id, event)
                        }
                        onBlur={() => {
                          const normalized = normalizeUnknownExpression(
                            row.expression,
                          );
                          if (normalized !== row.expression) {
                            updateRow(setUnknown, row.id, {
                              expression: normalized,
                            });
                          }
                        }}
                        onKeyDown={(event) => {
                          if (
                            event.altKey &&
                            (event.key === "ArrowUp" ||
                              event.key === "ArrowDown")
                          ) {
                            event.preventDefault();
                            moveExpressionRow(
                              "unknown",
                              row.id,
                              event.key === "ArrowUp" ? -1 : 1,
                            );
                            return;
                          }
                          if (
                            !event.shiftKey &&
                            !event.ctrlKey &&
                            !event.metaKey &&
                            (event.key === "ArrowUp" ||
                              event.key === "ArrowDown") &&
                            focusExpressionAcrossSections(
                              "unknown",
                              row.id,
                              event.key === "ArrowUp" ? -1 : 1,
                            )
                          ) {
                            event.preventDefault();
                            return;
                          }
                          if (event.shiftKey && event.key === "Enter") {
                            event.preventDefault();
                            insertExpressionAfter("unknown", row.id);
                            return;
                          }
                          if (
                            event.key === "Enter" ||
                            event.key === "Escape"
                          ) {
                            event.preventDefault();
                            event.currentTarget.blur();
                          }
                        }}
                        spellCheck={false}
                        title={t(
                          "↑/↓ — соседняя строка · Alt+↑/↓ — переместить · Shift+Enter — добавить",
                          "↑/↓ — adjacent row · Alt+↑/↓ — move · Shift+Enter — add",
                        )}
                        aria-label={t(
                          `Неизвестное ${number}`,
                          `Target ${number}`,
                        )}
                      />
                      {(referenceError || !target) && (
                        <span className="unrecognized">
                          {referenceError ??
                            t("проверьте запись", "check the expression")}
                        </span>
                      )}
                    </div>
                    <button
                      className="row-delete"
                      onClick={() =>
                        setUnknown((current) =>
                          current.filter((item) => item.id !== row.id),
                        )
                      }
                      aria-label={t("Удалить цель", "Delete target")}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
              </div>
            )}
            </section>

            <div className="syntax-note">
              <span>i</span>
              {locale === "ru" ? (
                <p>
                  <b>Shift+Enter</b> сохраняет строку и создаёт следующую.{" "}
                  Символы сворачиваются автоматически: <b>\angle</b> → ∠,{" "}
                  <b>\perp</b> → ⟂, <b>\in</b> → ∈. Формулы:{" "}
                  <b>AB + BC = AC</b>, <b>∠ABC = ∠BCA + 10°</b> или цепочка{" "}
                  <b>AB = BC = CD</b>. Площадь: <b>S(ABCD) = ?</b>,
                  периметр: <b>P(ABCD) = ?</b>. Для круглых фигур:
                  <b> S(circle(AB))</b>, <b>S(sector(ABC))</b>.
                  Координаты: <b>x(A) = 2</b>, <b>y(A) = -1</b> или{" "}
                  <b>A = (2, -1)</b>. Переменные задаются
                  отдельными строками: <b>a = AB</b>, <b>b = 2*a</b>.
                  Неравенства: <b>0 &lt; AB &lt;= 10</b>. Топология:{" "}
                  <b>distinct(ABCD)</b> и <b>AB ∩ CD = ∅</b>. Пересечение:{" "}
                  <b>H = EG ∩ DF</b> или{" "}
                  <b>H = line(EG) ∩ circle(OA)</b>.
                </p>
              ) : (
                <p>
                  <b>Shift+Enter</b> saves a row and creates the next one.
                  Commands expand automatically: <b>\angle</b> → ∠,{" "}
                  <b>\perp</b> → ⟂, <b>\in</b> → ∈. Formulas:{" "}
                  <b>AB + BC = AC</b>, <b>∠ABC = ∠BCA + 10°</b>, or{" "}
                  <b>AB = BC = CD</b>. Area: <b>S(ABCD) = ?</b>,
                  perimeter: <b>P(ABCD) = ?</b>. Circular shapes:
                  <b> S(circle(AB))</b>, <b>S(sector(ABC))</b>.
                  Coordinates: <b>x(A) = 2</b>, <b>y(A) = -1</b>, or{" "}
                  <b>A = (2, -1)</b>. Define variables on
                  separate rows: <b>a = AB</b>, <b>b = 2*a</b>.
                  Comparisons: <b>0 &lt; AB &lt;= 10</b>.
                  Intersection: <b>H = EG ∩ DF</b> or{" "}
                  <b>H = line(EG) ∩ circle(OA)</b>.
                </p>
              )}
            </div>
          </div>
  );
}
