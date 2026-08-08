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
  focusAdjacentEditorEntry,
  materializeEditorOrder,
  moveEditorRow,
  moveEditorRowOneStep,
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
  const lastPointerYRef = useRef<number | null>(null);
  const dragAnchorRef = useRef<{
    pointerY: number;
    offsetY: number;
    scrollRegion: HTMLElement;
  } | null>(null);
  const knownRef = useRef(known);
  const unknownRef = useRef(unknown);
  const groupsRef = useRef(groups);

  useEffect(() => {
    knownRef.current = known;
    unknownRef.current = unknown;
    groupsRef.current = groups;
  }, [groups, known, unknown]);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const rowsFor = (group: ExpressionGroup) =>
    group === "known" ? knownRef.current : unknownRef.current;
  const setterFor = (group: ExpressionGroup) =>
    group === "known" ? setKnown : setUnknown;

  const commitOrderedMove = (
    section: ExpressionGroup,
    sourceId: number,
    parentGroupId: string | undefined,
    target: { kind: "item" | "group"; id: string } | null,
    placement: "before" | "after" | "first" | "last",
  ) => {
    const rows = section === "known" ? knownRef.current : unknownRef.current;
    const sectionGroups = groupsRef.current.filter(
      (group) => group.section === section,
    );
    const moved = moveEditorRow(
      rows,
      sectionGroups,
      sourceId,
      parentGroupId,
      target,
      placement,
    );
    if (section === "known") {
      knownRef.current = moved.items;
      setKnown(moved.items);
    } else {
      unknownRef.current = moved.items;
      setUnknown(moved.items);
    }
    const movedGroups = new Map(moved.groups.map((group) => [group.id, group]));
    groupsRef.current = groupsRef.current.map(
      (group) => movedGroups.get(group.id) ?? group,
    );
    setGroups(groupsRef.current);
    draggedMembershipRef.current = parentGroupId;
    markDirty();
  };
  const descendantGroupIds = (groupId: string) => {
    const ids = new Set<string>([groupId]);
    let changed = true;
    while (changed) {
      changed = false;
      groups.forEach((candidate) => {
        if (
          candidate.parentGroupId &&
          ids.has(candidate.parentGroupId) &&
          !ids.has(candidate.id)
        ) {
          ids.add(candidate.id);
          changed = true;
        }
      });
    }
    return ids;
  };

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
    const parentGroupId = groups.find(
      (item) => item.id === targetGroupId,
    )?.parentGroupId;
    const descendantIds = descendantGroupIds(targetGroupId);
    setterFor(group)((current) => {
      const sourceIndex = current.findIndex((row) => row.id === sourceId);
      const source = current.find((row) => row.id === sourceId);
      if (!source) return current;
      const currentFirstMember = current.findIndex(
        (row) =>
          Boolean(row.groupId && descendantIds.has(row.groupId)) &&
          row.id !== sourceId,
      );
      const firstUngroupedAfterGroup = current.findIndex(
        (row, index) =>
          index > currentFirstMember &&
          (!row.groupId || !descendantIds.has(row.groupId)),
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
        row.groupId && descendantIds.has(row.groupId) ? [index] : [],
      );
      const insertIndex = memberIndices.length
        ? memberIndices[memberIndices.length - 1] + 1
        : next.length;
      next.splice(insertIndex, 0, { ...source, groupId: parentGroupId });
      return next;
    });
    markDirty();
  };

  const placeExpressionBeforeGroup = (
    group: ExpressionGroup,
    sourceId: number,
    targetGroupId: string,
  ) => {
    const parentGroupId = groups.find(
      (item) => item.id === targetGroupId,
    )?.parentGroupId;
    const descendantIds = descendantGroupIds(targetGroupId);
    setterFor(group)((current) => {
      const source = current.find((row) => row.id === sourceId);
      if (!source) return current;
      const next = current.filter((row) => row.id !== sourceId);
      const firstMemberIndex = next.findIndex(
        (row) => Boolean(row.groupId && descendantIds.has(row.groupId)),
      );
      const insertIndex =
        firstMemberIndex >= 0 ? firstMemberIndex : next.length;
      next.splice(insertIndex, 0, { ...source, groupId: parentGroupId });
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

  const placeExpressionAcrossEmptyGroup = (
    group: ExpressionGroup,
    sourceId: number,
    targetGroupId: string,
    direction: -1 | 1,
  ) => {
    if (direction === 1) {
      placeExpressionAfterGroup(group, sourceId, targetGroupId);
    } else {
      placeExpressionBeforeGroup(group, sourceId, targetGroupId);
    }
  };

  const moveExpressionRow = (
    group: ExpressionGroup,
    id: number,
    direction: -1 | 1,
  ) => {
    const rows = rowsFor(group);
    const sectionGroups = groupsRef.current.filter(
      (item) => item.section === group,
    );
    const moved = moveEditorRowOneStep(
      rows,
      sectionGroups,
      id,
      direction,
    );
    if (group === "known") {
      knownRef.current = moved.items;
      setKnown(moved.items);
    } else {
      unknownRef.current = moved.items;
      setUnknown(moved.items);
    }
    const movedGroups = new Map(
      moved.groups.map((editorGroup) => [editorGroup.id, editorGroup]),
    );
    groupsRef.current = groupsRef.current.map(
      (editorGroup) => movedGroups.get(editorGroup.id) ?? editorGroup,
    );
    setGroups(groupsRef.current);
    markDirty();
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
      const materialized = materializeEditorOrder(
        rowsFor(group),
        groupsRef.current.filter((item) => item.section === group),
      );
      if (group === "known") {
        knownRef.current = materialized.items;
        setKnown(materialized.items);
      } else {
        unknownRef.current = materialized.items;
        setUnknown(materialized.items);
      }
      const materializedGroups = new Map(
        materialized.groups.map((item) => [item.id, item]),
      );
      groupsRef.current = groupsRef.current.map(
        (item) => materializedGroups.get(item.id) ?? item,
      );
      setGroups(groupsRef.current);
      const next = { group, id };
      draggedExpressionRef.current = next;
      draggedMembershipRef.current = rowsFor(group).find(
        (row) => row.id === id,
      )?.groupId;
      const sourceRow = event.currentTarget.closest<HTMLElement>(
        "[data-expression-row]",
      );
      const sourceBounds = sourceRow?.getBoundingClientRect();
      const scrollRegion = event.currentTarget.closest<HTMLElement>(
        ".expressions",
      );
      dragAnchorRef.current =
        sourceBounds && scrollRegion
          ? {
              pointerY: event.clientY,
              offsetY: Math.max(
                0,
                Math.min(sourceBounds.height, event.clientY - sourceBounds.top),
              ),
              scrollRegion,
            }
          : null;
      lastDragZoneRef.current = null;
      lastPointerYRef.current = event.clientY;
      setDraggedExpression(next);

      dragCleanupRef.current?.();
      const move = (moveEvent: PointerEvent) => {
        const current = draggedExpressionRef.current;
        if (!current || current.group !== group || current.id !== id) return;
        moveEvent.preventDefault();
        const pointerDirection =
          lastPointerYRef.current === null
            ? 0
            : Math.sign(moveEvent.clientY - lastPointerYRef.current);
        if (dragAnchorRef.current) {
          dragAnchorRef.current.pointerY = moveEvent.clientY;
          if (moveEvent.clientY < 0) {
            dragAnchorRef.current.scrollRegion.scrollBy({
              top: -Math.max(8, -moveEvent.clientY),
            });
          } else if (moveEvent.clientY > window.innerHeight) {
            dragAnchorRef.current.scrollRegion.scrollBy({
              top: Math.max(8, moveEvent.clientY - window.innerHeight),
            });
          }
        }
        if (
          lastPointerYRef.current !== null &&
          Math.abs(moveEvent.clientY - lastPointerYRef.current) < 6
        ) {
          return;
        }
        lastPointerYRef.current = moveEvent.clientY;
        const hitBounds = dragAnchorRef.current?.scrollRegion.getBoundingClientRect();
        const hit = document.elementFromPoint(
          hitBounds ? hitBounds.left + hitBounds.width / 2 : moveEvent.clientX,
          moveEvent.clientY,
        );
        {
          const orderedBoundary = hit?.closest<HTMLElement>(
            "[data-editor-group-boundary]",
          );
          if (
            orderedBoundary?.dataset.editorGroupSection === group &&
            orderedBoundary.dataset.editorGroupId
          ) {
            const targetGroupId = orderedBoundary.dataset.editorGroupId;
            const targetGroup = groupsRef.current.find(
              (item) => item.id === targetGroupId,
            );
            const zoneKey = `ordered-boundary:${targetGroupId}:${draggedMembershipRef.current}`;
            if (lastDragZoneRef.current === zoneKey) return;
            lastDragZoneRef.current = zoneKey;
            if (draggedMembershipRef.current === targetGroupId) {
              commitOrderedMove(
                group,
                id,
                targetGroup?.parentGroupId,
                { kind: "group", id: targetGroupId },
                "after",
              );
            } else {
              commitOrderedMove(group, id, targetGroupId, null, "last");
            }
            return;
          }
          const orderedGroup = hit?.closest<HTMLElement>(
            ".editor-group-header[data-editor-group-id]",
          );
          if (
            orderedGroup?.dataset.editorGroupSection === group &&
            orderedGroup.dataset.editorGroupId
          ) {
            const targetGroupId = orderedGroup.dataset.editorGroupId;
            const targetGroup = groupsRef.current.find(
              (item) => item.id === targetGroupId,
            );
            if (!targetGroup) return;
            const bounds = orderedGroup.getBoundingClientRect();
            const relativeY = (moveEvent.clientY - bounds.top) / bounds.height;
            const collapsed = orderedGroup.dataset.editorGroupCollapsed === "true";
            const action = pointerDirection < 0
              ? "before"
              : !collapsed && relativeY >= 0.58
              ? "inside"
              : relativeY < 0.58
                ? "before"
                : "after";
            const zoneKey = `ordered-group:${targetGroupId}:${action}`;
            if (lastDragZoneRef.current === zoneKey) return;
            lastDragZoneRef.current = zoneKey;
            if (action === "inside") {
              commitOrderedMove(group, id, targetGroupId, null, "first");
            } else {
              commitOrderedMove(
                group,
                id,
                targetGroup.parentGroupId,
                { kind: "group", id: targetGroupId },
                action,
              );
            }
            return;
          }
          const orderedRow = hit?.closest<HTMLElement>(
            `[data-expression-group="${group}"][data-expression-row]`,
          );
          const targetId = Number(orderedRow?.dataset.expressionRow);
          if (orderedRow && Number.isSafeInteger(targetId) && targetId !== id) {
            const bounds = orderedRow.getBoundingClientRect();
            const placement = moveEvent.clientY < bounds.top + bounds.height / 2
              ? "before"
              : "after";
            const parentGroupId = orderedRow.dataset.expressionGroupId || undefined;
            const zoneKey = `ordered-row:${targetId}:${placement}`;
            if (lastDragZoneRef.current === zoneKey) return;
            lastDragZoneRef.current = zoneKey;
            commitOrderedMove(
              group,
              id,
              parentGroupId,
              { kind: "item", id: String(targetId) },
              placement,
            );
            return;
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
            draggedMembershipRef.current = groups.find(
              (item) => item.id === targetGroupId,
            )?.parentGroupId;
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
          const sourceGroupId = draggedMembershipRef.current;
          const isCollapsed =
            groupTarget.dataset.editorGroupCollapsed === "true";
          const targetCount = Number(
            groupTarget.dataset.editorGroupCount ?? 0,
          );
          const targetBounds = groupTarget.getBoundingClientRect();
          const relativeY =
            (moveEvent.clientY - targetBounds.top) / targetBounds.height;
          const direction: -1 | 1 = relativeY < 0.58 ? -1 : 1;
          const action =
            groupId && !isCollapsed && relativeY >= 0.58
              ? "inside"
              : direction === -1
                ? "before"
                : "after";
          const zoneKey = `group:${groupId}:${action}`;
          if (lastDragZoneRef.current === zoneKey) return;
          lastDragZoneRef.current = zoneKey;
          if (groupId && targetCount === 0 && isCollapsed) {
            placeExpressionAcrossEmptyGroup(group, id, groupId, direction);
            draggedMembershipRef.current = groups.find(
              (item) => item.id === groupId,
            )?.parentGroupId;
          } else if (groupId && isCollapsed) {
            if (direction === 1) {
              placeExpressionAfterGroup(group, id, groupId);
            } else {
              placeExpressionBeforeGroup(group, id, groupId);
            }
            draggedMembershipRef.current = groups.find(
              (item) => item.id === groupId,
            )?.parentGroupId;
          } else if (groupId && sourceGroupId === groupId) {
            placeExpressionBeforeGroup(group, id, groupId);
            draggedMembershipRef.current = groups.find(
              (item) => item.id === groupId,
            )?.parentGroupId;
          } else if (
            groupId &&
            sourceGroupId !== groupId &&
            action === "inside"
          ) {
            enterExpressionGroup(group, id, groupId, "first");
            draggedMembershipRef.current = groupId;
          } else if (groupId && sourceGroupId !== groupId) {
            if (direction === -1) {
              placeExpressionBeforeGroup(group, id, groupId);
            } else {
              placeExpressionAfterGroup(group, id, groupId);
            }
            draggedMembershipRef.current = groups.find(
              (item) => item.id === groupId,
            )?.parentGroupId;
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
              draggedMembershipRef.current = groups.find(
                (item) => item.id === sourceGroupId,
              )?.parentGroupId;
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
                  group,
                  id,
                  crossedGroupId,
                  direction,
                );
                draggedMembershipRef.current = groups.find(
                  (item) => item.id === crossedGroupId,
                )?.parentGroupId;
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
                draggedMembershipRef.current = groups.find(
                  (item) => item.id === crossedGroupId,
                )?.parentGroupId;
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
        dragAnchorRef.current = null;
        lastDragZoneRef.current = null;
        lastPointerYRef.current = null;
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
