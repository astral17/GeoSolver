"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type React from "react";
import type { EditorGroup, ExpressionRow } from "./domain";
import { buildGroupedEntries } from "./editor-groups";

type RowSetter = Dispatch<SetStateAction<ExpressionRow[]>>;

function repositionSectionGroups(
  groups: EditorGroup[],
  section: EditorGroup["section"],
  sourceId: string,
  targetId: string,
  placeAfter: boolean,
) {
  const sectionGroups = groups.filter((group) => group.section === section);
  const sourceIndex = sectionGroups.findIndex((group) => group.id === sourceId);
  const targetIndex = sectionGroups.findIndex((group) => group.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return groups;
  }

  const reordered = [...sectionGroups];
  const [source] = reordered.splice(sourceIndex, 1);
  const targetAfterRemoval = reordered.findIndex(
    (group) => group.id === targetId,
  );
  reordered.splice(targetAfterRemoval + (placeAfter ? 1 : 0), 0, source);

  let sectionIndex = 0;
  return groups.map((group) =>
    group.section === section ? reordered[sectionIndex++] : group,
  );
}

function repositionExpressionGroup(
  rows: ExpressionRow[],
  sourceId: string,
  targetId: string,
  placeAfter: boolean,
) {
  const sourceRows = rows.filter((row) => row.groupId === sourceId);
  if (!sourceRows.length) return rows;

  const next = rows.filter((row) => row.groupId !== sourceId);
  const targetIndices = next.flatMap((row, index) =>
    row.groupId === targetId ? [index] : [],
  );
  const insertIndex = targetIndices.length
    ? placeAfter
      ? targetIndices[targetIndices.length - 1] + 1
      : targetIndices[0]
    : next.length;
  next.splice(insertIndex, 0, ...sourceRows);
  return next;
}

function repositionExpressionGroupNearRow(
  rows: ExpressionRow[],
  sourceId: string,
  targetRowId: number,
  placeAfter: boolean,
) {
  const sourceRows = rows.filter((row) => row.groupId === sourceId);
  if (!sourceRows.length) return rows;
  const next = rows.filter((row) => row.groupId !== sourceId);
  const targetIndex = next.findIndex((row) => row.id === targetRowId);
  if (targetIndex < 0) return rows;
  next.splice(targetIndex + (placeAfter ? 1 : 0), 0, ...sourceRows);
  return next;
}

export function useEditorGroupReordering({
  groups,
  known,
  unknown,
  setGroups,
  setKnown,
  setUnknown,
}: {
  groups: EditorGroup[];
  known: ExpressionRow[];
  unknown: ExpressionRow[];
  setGroups: Dispatch<SetStateAction<EditorGroup[]>>;
  setKnown: RowSetter;
  setUnknown: RowSetter;
}) {
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const draggedGroupRef = useRef<EditorGroup | null>(null);
  const lastTargetRef = useRef<{
    key: string;
    clientY: number;
  } | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const visibleGroupIds = (section: EditorGroup["section"]) => {
    const sectionGroups = groups.filter((group) => group.section === section);
    if (section === "objects") {
      return sectionGroups.map((group) => group.id);
    }
    const rows = section === "known" ? known : unknown;
    return buildGroupedEntries(rows, sectionGroups).flatMap((entry) =>
      entry.kind === "group" ? [entry.group.id] : [],
    );
  };

  const reorderEditorGroup = (
    source: EditorGroup,
    targetId: string,
    placeAfter: boolean,
  ) => {
    if (source.id === targetId) return;
    setGroups((current) =>
      repositionSectionGroups(
        current,
        source.section,
        source.id,
        targetId,
        placeAfter,
      ).map((group) =>
        group.id === source.id
          ? {
              ...group,
              anchorId: undefined,
              anchorSide: undefined,
            }
          : group,
      ),
    );
    if (source.section === "known") {
      setKnown((current) =>
        repositionExpressionGroup(
          current,
          source.id,
          targetId,
          placeAfter,
        ),
      );
    } else if (source.section === "unknown") {
      setUnknown((current) =>
        repositionExpressionGroup(
          current,
          source.id,
          targetId,
          placeAfter,
        ),
      );
    }
  };

  const moveEditorGroup = (
    group: EditorGroup,
    direction: -1 | 1,
  ) => {
    const order = visibleGroupIds(group.section);
    const sourceIndex = order.indexOf(group.id);
    const targetId = order[sourceIndex + direction];
    if (!targetId) return;
    reorderEditorGroup(group, targetId, direction === 1);
  };

  const placeExpressionGroupNearRow = (
    source: EditorGroup,
    targetRowId: number,
    placeAfter: boolean,
  ) => {
    const setter = source.section === "known" ? setKnown : setUnknown;
    setGroups((current) =>
      current.map((group) =>
        group.id === source.id
          ? {
              ...group,
              anchorId: String(targetRowId),
              anchorSide: placeAfter ? "after" : "before",
            }
          : group,
      ),
    );
    setter((current) =>
      repositionExpressionGroupNearRow(
        current,
        source.id,
        targetRowId,
        placeAfter,
      ),
    );
  };

  const shouldSkipTarget = (
    key: string,
    clientY: number,
  ) => {
    const previous = lastTargetRef.current;
    if (
      previous?.key === key &&
      Math.abs(previous.clientY - clientY) < 10
    ) {
      return true;
    }
    lastTargetRef.current = { key, clientY };
    return false;
  };

  const groupDragHandleProps = (group: EditorGroup) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      draggedGroupRef.current = group;
      lastTargetRef.current = null;
      setDraggedGroupId(group.id);

      dragCleanupRef.current?.();
      const move = (moveEvent: PointerEvent) => {
        const source = draggedGroupRef.current;
        if (!source || source.id !== group.id) return;
        moveEvent.preventDefault();
        const hit = document.elementFromPoint(
          moveEvent.clientX,
          moveEvent.clientY,
        );
        const scrollRegion = hit?.closest<HTMLElement>(".expressions");
        if (scrollRegion) {
          const bounds = scrollRegion.getBoundingClientRect();
          if (moveEvent.clientY < bounds.top + 54) {
            scrollRegion.scrollBy({ top: -14 });
          } else if (moveEvent.clientY > bounds.bottom - 54) {
            scrollRegion.scrollBy({ top: 14 });
          }
        }
        const groupTarget = hit?.closest<HTMLElement>(
          ".editor-group-header[data-editor-group-id]",
        );
        const targetGroupId = groupTarget?.dataset.editorGroupId;
        if (
          groupTarget?.dataset.editorGroupSection === source.section &&
          targetGroupId &&
          targetGroupId !== source.id
        ) {
          const targetBounds = groupTarget.getBoundingClientRect();
          const placeAfter =
            moveEvent.clientY >= targetBounds.top + targetBounds.height / 2;
          const targetKey = `group:${targetGroupId}:${placeAfter}`;
          if (shouldSkipTarget(targetKey, moveEvent.clientY)) return;
          reorderEditorGroup(source, targetGroupId, placeAfter);
          return;
        }

        const expressionTarget = hit?.closest<HTMLElement>(
          "[data-expression-row]",
        );
        if (
          (source.section === "known" || source.section === "unknown") &&
          expressionTarget?.dataset.expressionGroup === source.section &&
          expressionTarget.dataset.expressionRow
        ) {
          const rowGroupId =
            expressionTarget.dataset.expressionGroupId || undefined;
          if (rowGroupId === source.id) return;
          const rowId = Number(expressionTarget.dataset.expressionRow);
          if (!Number.isSafeInteger(rowId)) return;
          const bounds = expressionTarget.getBoundingClientRect();
          const placeAfter = moveEvent.clientY >= bounds.top + bounds.height / 2;
          if (rowGroupId) {
            const targetKey = `group:${rowGroupId}:${placeAfter}`;
            if (shouldSkipTarget(targetKey, moveEvent.clientY)) return;
            reorderEditorGroup(source, rowGroupId, placeAfter);
          } else {
            const targetKey = `row:${rowId}:${placeAfter}`;
            if (shouldSkipTarget(targetKey, moveEvent.clientY)) return;
            placeExpressionGroupNearRow(source, rowId, placeAfter);
          }
          return;
        }

        const objectTarget = hit?.closest<HTMLElement>(
          "[data-object-row]",
        );
        const objectGroupId = objectTarget?.dataset.objectGroupId;
        if (
          source.section === "objects" &&
          objectGroupId &&
          objectGroupId !== source.id
        ) {
          const bounds = objectTarget.getBoundingClientRect();
          const placeAfter =
            moveEvent.clientY >= bounds.top + bounds.height / 2;
          const targetKey = `group:${objectGroupId}:${placeAfter}`;
          if (shouldSkipTarget(targetKey, moveEvent.clientY)) return;
          reorderEditorGroup(source, objectGroupId, placeAfter);
          return;
        }
        lastTargetRef.current = null;
      };
      const finish = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        dragCleanupRef.current = null;
        draggedGroupRef.current = null;
        lastTargetRef.current = null;
        setDraggedGroupId(null);
      };
      dragCleanupRef.current = finish;
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (
        event.altKey &&
        (event.key === "ArrowUp" || event.key === "ArrowDown")
      ) {
        event.preventDefault();
        moveEditorGroup(group, event.key === "ArrowUp" ? -1 : 1);
      }
    },
  });

  return {
    draggedGroupId,
    groupDragHandleProps,
    moveEditorGroup,
  };
}
