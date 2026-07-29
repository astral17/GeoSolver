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
import {
  buildGroupedEntries,
  focusAdjacentEditorEntry,
} from "./editor-groups";

type ExpressionGroup = "known" | "unknown";
type RowSetter = Dispatch<SetStateAction<ExpressionRow[]>>;

export function useExpressionReordering({
  known,
  unknown,
  groups,
  setGroups,
  setKnown,
  setUnknown,
  markDirty,
}: {
  known: ExpressionRow[];
  unknown: ExpressionRow[];
  groups: EditorGroup[];
  setGroups: Dispatch<SetStateAction<EditorGroup[]>>;
  setKnown: RowSetter;
  setUnknown: RowSetter;
  markDirty: () => void;
}) {
  const [draggedExpression, setDraggedExpression] = useState<{
    group: ExpressionGroup;
    id: number;
  } | null>(null);
  const draggedExpressionRef = useRef<typeof draggedExpression>(null);
  const draggedMembershipRef = useRef<string | undefined>(undefined);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const lastDragZoneRef = useRef<string | null>(null);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const rowsFor = (group: ExpressionGroup) =>
    group === "known" ? known : unknown;
  const setterFor = (group: ExpressionGroup) =>
    group === "known" ? setKnown : setUnknown;

  const reorderExpressionRows = (
    group: ExpressionGroup,
    sourceId: number,
    targetId: number,
  ) => {
    if (sourceId === targetId) return;
    setterFor(group)((current) => {
      const sourceIndex = current.findIndex((row) => row.id === sourceId);
      const targetIndex = current.findIndex((row) => row.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [source] = next.splice(sourceIndex, 1);
      const targetAfterRemoval = next.findIndex((row) => row.id === targetId);
      next.splice(
        sourceIndex < targetIndex ? targetAfterRemoval + 1 : targetAfterRemoval,
        0,
        { ...source, groupId: current[targetIndex]?.groupId },
      );
      return next;
    });
    markDirty();
  };

  const placeExpressionAfterGroup = (
    group: ExpressionGroup,
    sourceId: number,
    targetGroupId: string,
  ) => {
    setGroups((current) =>
      current.map((item) =>
        item.id === targetGroupId
          ? {
              ...item,
              anchorId: String(sourceId),
              anchorSide: "before",
            }
          : item,
      ),
    );
    setterFor(group)((current) => {
      const sourceIndex = current.findIndex((row) => row.id === sourceId);
      const source = current.find((row) => row.id === sourceId);
      if (!source) return current;
      const currentFirstMember = current.findIndex(
        (row) => row.groupId === targetGroupId && row.id !== sourceId,
      );
      const firstUngroupedAfterGroup = current.findIndex(
        (row, index) =>
          index > currentFirstMember && row.groupId !== targetGroupId,
      );
      if (
        source.groupId === undefined &&
        currentFirstMember >= 0 &&
        firstUngroupedAfterGroup === sourceIndex
      ) {
        return current;
      }
      const next = current.filter((row) => row.id !== sourceId);
      const memberIndices = next.flatMap((row, index) =>
        row.groupId === targetGroupId ? [index] : [],
      );
      const insertIndex = memberIndices.length
        ? memberIndices[memberIndices.length - 1] + 1
        : next.length;
      next.splice(insertIndex, 0, { ...source, groupId: undefined });
      return next;
    });
    markDirty();
  };

  const placeExpressionBeforeGroup = (
    group: ExpressionGroup,
    sourceId: number,
    targetGroupId: string,
  ) => {
    setGroups((current) =>
      current.map((item) =>
        item.id === targetGroupId
          ? {
              ...item,
              anchorId: String(sourceId),
              anchorSide: "after",
            }
          : item,
      ),
    );
    setterFor(group)((current) => {
      const source = current.find((row) => row.id === sourceId);
      if (!source) return current;
      const next = current.filter((row) => row.id !== sourceId);
      const firstMemberIndex = next.findIndex(
        (row) => row.groupId === targetGroupId,
      );
      const insertIndex =
        firstMemberIndex >= 0 ? firstMemberIndex : next.length;
      next.splice(insertIndex, 0, { ...source, groupId: undefined });
      return next;
    });
    markDirty();
  };

  const enterExpressionGroup = (
    group: ExpressionGroup,
    sourceId: number,
    targetGroupId: string,
    position: "first" | "last",
  ) => {
    setterFor(group)((current) => {
      const source = current.find((row) => row.id === sourceId);
      if (!source) return current;
      const next = current.filter((row) => row.id !== sourceId);
      const memberIndices = next.flatMap((row, index) =>
        row.groupId === targetGroupId ? [index] : [],
      );
      const insertIndex =
        position === "first"
          ? (memberIndices[0] ?? next.length)
          : memberIndices.length
            ? memberIndices[memberIndices.length - 1] + 1
            : next.length;
      next.splice(insertIndex, 0, { ...source, groupId: targetGroupId });
      return next;
    });
    markDirty();
  };

  const isExpandedGroup = (
    section: ExpressionGroup,
    groupId: string | undefined,
  ) =>
    Boolean(
      groupId &&
        groups.some(
          (item) =>
            item.section === section &&
            item.id === groupId &&
            !item.collapsed,
        ),
    );

  const placeExpressionAcrossEmptyGroup = (
    sourceId: number,
    targetGroupId: string,
    direction: -1 | 1,
  ) => {
    setGroups((current) =>
      current.map((item) =>
        item.id === targetGroupId
          ? {
              ...item,
              anchorId: String(sourceId),
              anchorSide: direction === 1 ? "before" : "after",
            }
          : item,
      ),
    );
    markDirty();
  };

  const moveExpressionRow = (
    group: ExpressionGroup,
    id: number,
    direction: -1 | 1,
  ) => {
    const rows = rowsFor(group);
    const sectionGroups = groups.filter((item) => item.section === group);
    const entries = buildGroupedEntries(rows, sectionGroups);
    const index = entries.findIndex(
      (entry) => entry.kind === "item" && entry.item.id === id,
    );
    if (index < 0) return;
    const source = rows.find((row) => row.id === id);
    if (!source) return;
    const sourceGroupId = isExpandedGroup(group, source.groupId)
      ? source.groupId
      : undefined;
    const targetEntry = entries[index + direction];
    if (!targetEntry) return;
    if (targetEntry.kind === "group") {
      if (targetEntry.group.id === sourceGroupId) {
        placeExpressionBeforeGroup(group, id, targetEntry.group.id);
      } else if (targetEntry.count === 0 && targetEntry.group.collapsed) {
        placeExpressionAcrossEmptyGroup(
          id,
          targetEntry.group.id,
          direction,
        );
      } else if (targetEntry.group.collapsed) {
        if (direction === 1) {
          placeExpressionAfterGroup(group, id, targetEntry.group.id);
        } else {
          placeExpressionBeforeGroup(group, id, targetEntry.group.id);
        }
      } else {
        enterExpressionGroup(
          group,
          id,
          targetEntry.group.id,
          direction === 1 ? "first" : "last",
        );
      }
      return;
    }
    if (targetEntry.kind === "groupEnd") {
      if (targetEntry.group.id === sourceGroupId) {
        placeExpressionAfterGroup(group, id, targetEntry.group.id);
      } else {
        enterExpressionGroup(group, id, targetEntry.group.id, "last");
      }
      return;
    }

    const target = targetEntry.item;
    const targetGroupId = isExpandedGroup(group, target.groupId)
      ? target.groupId
      : undefined;
    if (!sourceGroupId && targetGroupId) {
      enterExpressionGroup(
        group,
        id,
        targetGroupId,
        direction === 1 ? "first" : "last",
      );
      return;
    }
    reorderExpressionRows(group, id, target.id);
  };

  const focusAdjacentExpression = (
    group: ExpressionGroup,
    id: number,
    direction: -1 | 1,
  ) => {
    const current = document.querySelector<HTMLInputElement>(
      `[data-expression-input="${group}-${id}"]`,
    );
    return current
      ? focusAdjacentEditorEntry(current, direction)
      : false;
  };

  const expressionDragHandleProps = (
    group: ExpressionGroup,
    id: number,
  ) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      const next = { group, id };
      draggedExpressionRef.current = next;
      draggedMembershipRef.current = rowsFor(group).find(
        (row) => row.id === id,
      )?.groupId;
      lastDragZoneRef.current = null;
      setDraggedExpression(next);

      dragCleanupRef.current?.();
      const move = (moveEvent: PointerEvent) => {
        const current = draggedExpressionRef.current;
        if (!current || current.group !== group || current.id !== id) return;
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
        const boundary = hit?.closest<HTMLElement>(
          "[data-editor-group-boundary]",
        );
        if (
          boundary?.dataset.editorGroupSection === group &&
          boundary.dataset.editorGroupId &&
          boundary.dataset.editorGroupBoundary === "after"
        ) {
          const targetGroupId = boundary.dataset.editorGroupId;
          const zoneKey = `boundary:${targetGroupId}`;
          if (lastDragZoneRef.current === zoneKey) return;
          lastDragZoneRef.current = zoneKey;
          if (draggedMembershipRef.current === targetGroupId) {
            placeExpressionAfterGroup(group, id, targetGroupId);
            draggedMembershipRef.current = undefined;
          } else {
            enterExpressionGroup(group, id, targetGroupId, "last");
            draggedMembershipRef.current = targetGroupId;
          }
          return;
        }
        const groupTarget = hit?.closest<HTMLElement>(
          "[data-editor-group-id]",
        );
        if (
          groupTarget?.dataset.editorGroupSection === group &&
          groupTarget.dataset.editorGroupId !== undefined
        ) {
          const groupId = groupTarget.dataset.editorGroupId || undefined;
          const zoneKey = `group:${groupId}`;
          if (lastDragZoneRef.current === zoneKey) return;
          lastDragZoneRef.current = zoneKey;
          const sourceGroupId = draggedMembershipRef.current;
          const isCollapsed =
            groupTarget.dataset.editorGroupCollapsed === "true";
          const targetCount = Number(
            groupTarget.dataset.editorGroupCount ?? 0,
          );
          const sourceElement = document.querySelector<HTMLElement>(
            `[data-expression-group="${group}"][data-expression-row="${id}"]`,
          );
          const sourceCenter =
            (sourceElement?.getBoundingClientRect().top ??
              moveEvent.clientY) +
            (sourceElement?.getBoundingClientRect().height ?? 0) / 2;
          const targetBounds = groupTarget.getBoundingClientRect();
          const direction: -1 | 1 =
            targetBounds.top + targetBounds.height / 2 < sourceCenter
              ? -1
              : 1;
          if (groupId && targetCount === 0 && isCollapsed) {
            placeExpressionAcrossEmptyGroup(id, groupId, direction);
            draggedMembershipRef.current = undefined;
          } else if (groupId && isCollapsed) {
            if (direction === 1) {
              placeExpressionAfterGroup(group, id, groupId);
            } else {
              placeExpressionBeforeGroup(group, id, groupId);
            }
            draggedMembershipRef.current = undefined;
          } else if (groupId && sourceGroupId === groupId) {
            placeExpressionBeforeGroup(group, id, groupId);
            draggedMembershipRef.current = undefined;
          } else if (groupId && sourceGroupId !== groupId) {
            enterExpressionGroup(group, id, groupId, "first");
            draggedMembershipRef.current = groupId;
          } else if (!groupId && sourceGroupId) {
            setterFor(group)((currentRows) =>
              currentRows.map((row) =>
                row.id === id ? { ...row, groupId: undefined } : row,
              ),
            );
            draggedMembershipRef.current = undefined;
            markDirty();
          }
          return;
        }
        const target = hit?.closest<HTMLElement>("[data-expression-row]");
        if (
          target?.dataset.expressionGroup !== group ||
          !target.dataset.expressionRow
        ) {
          if (!boundary && !groupTarget) lastDragZoneRef.current = null;
          return;
        }
        const targetId = Number(target.dataset.expressionRow);
        const zoneKey = `row:${targetId}`;
        if (lastDragZoneRef.current === zoneKey) return;
        lastDragZoneRef.current = zoneKey;
        if (Number.isSafeInteger(targetId) && targetId !== id) {
          const sourceGroupId = draggedMembershipRef.current;
          const targetGroupId =
            target.dataset.expressionGroupId || undefined;
          if (sourceGroupId !== targetGroupId) {
            const sourceElement = document.querySelector<HTMLElement>(
              `[data-expression-group="${group}"][data-expression-row="${id}"]`,
            );
            const sourceTop =
              sourceElement?.getBoundingClientRect().top ??
              moveEvent.clientY;
            const targetTop = target.getBoundingClientRect().top;
            const direction: -1 | 1 = targetTop < sourceTop ? -1 : 1;

            if (sourceGroupId) {
              if (direction === -1) {
                placeExpressionBeforeGroup(group, id, sourceGroupId);
              } else {
                placeExpressionAfterGroup(group, id, sourceGroupId);
              }
              draggedMembershipRef.current = undefined;
              return;
            }
            const sourceCenter =
              sourceElement?.getBoundingClientRect().top ??
              moveEvent.clientY;
            const targetCenter =
              targetTop + target.getBoundingClientRect().height / 2;
            const interveningGroups = Array.from(
              document.querySelectorAll<HTMLElement>(
                `.editor-group-header[data-editor-group-section="${group}"]`,
              ),
            )
              .filter((header) => {
                const headerBounds = header.getBoundingClientRect();
                const center =
                  headerBounds.top + headerBounds.height / 2;
                return direction === 1
                  ? center > sourceCenter && center < targetCenter
                  : center < sourceCenter && center > targetCenter;
              })
              .sort((left, right) => {
                const leftTop = left.getBoundingClientRect().top;
                const rightTop = right.getBoundingClientRect().top;
                return direction === 1
                  ? leftTop - rightTop
                  : rightTop - leftTop;
              });
            const crossedGroup = interveningGroups[0];
            const crossedGroupId =
              crossedGroup?.dataset.editorGroupId;
            if (crossedGroupId) {
              const crossedCount = Number(
                crossedGroup.dataset.editorGroupCount ?? 0,
              );
              if (
                crossedCount === 0 &&
                crossedGroup.dataset.editorGroupCollapsed === "true"
              ) {
                placeExpressionAcrossEmptyGroup(
                  id,
                  crossedGroupId,
                  direction,
                );
                draggedMembershipRef.current = undefined;
              } else if (
                crossedGroup.dataset.editorGroupCollapsed === "true"
              ) {
                if (direction === 1) {
                  placeExpressionAfterGroup(
                    group,
                    id,
                    crossedGroupId,
                  );
                } else {
                  placeExpressionBeforeGroup(
                    group,
                    id,
                    crossedGroupId,
                  );
                }
                draggedMembershipRef.current = undefined;
              } else {
                enterExpressionGroup(
                  group,
                  id,
                  crossedGroupId,
                  direction === 1 ? "first" : "last",
                );
                draggedMembershipRef.current = crossedGroupId;
              }
              return;
            }
            if (targetGroupId) {
              enterExpressionGroup(
                group,
                id,
                targetGroupId,
                direction === 1 ? "first" : "last",
              );
              draggedMembershipRef.current = targetGroupId;
              return;
            }
          }
          reorderExpressionRows(group, id, targetId);
        }
      };
      const finish = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        dragCleanupRef.current = null;
        draggedExpressionRef.current = null;
        draggedMembershipRef.current = undefined;
        lastDragZoneRef.current = null;
        setDraggedExpression(null);
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
        moveExpressionRow(group, id, event.key === "ArrowUp" ? -1 : 1);
      }
    },
  });

  return {
    draggedExpression,
    expressionDragHandleProps,
    moveExpressionRow,
    focusAdjacentExpression,
  };
}
