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
  materializeEditorOrder,
  moveEditorGroupByOrder,
} from "./editor-groups";

type RowSetter = Dispatch<SetStateAction<ExpressionRow[]>>;
type ObjectOrderItem = {
  id: string;
  groupId?: string;
  editorOrder?: number;
};

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
  groups: EditorGroup[],
  sourceId: string,
  targetId: string,
  placeAfter: boolean,
) {
  const descendants = new Set<string>([sourceId]);
  let changed = true;
  while (changed) {
    changed = false;
    groups.forEach((group) => {
      if (group.parentGroupId && descendants.has(group.parentGroupId) && !descendants.has(group.id)) {
        descendants.add(group.id);
        changed = true;
      }
    });
  }
  const sourceRows = rows.filter((row) => row.groupId && descendants.has(row.groupId));
  if (!sourceRows.length) return rows;

  const next = rows.filter((row) => !row.groupId || !descendants.has(row.groupId));
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
  groups: EditorGroup[],
  sourceId: string,
  targetRowId: number,
  placeAfter: boolean,
) {
  const descendants = new Set<string>([sourceId]);
  let changed = true;
  while (changed) {
    changed = false;
    groups.forEach((group) => {
      if (group.parentGroupId && descendants.has(group.parentGroupId) && !descendants.has(group.id)) {
        descendants.add(group.id);
        changed = true;
      }
    });
  }
  const sourceRows = rows.filter((row) => row.groupId && descendants.has(row.groupId));
  if (!sourceRows.length) return rows;
  const next = rows.filter((row) => !row.groupId || !descendants.has(row.groupId));
  const targetIndex = next.findIndex((row) => row.id === targetRowId);
  if (targetIndex < 0) return rows;
  next.splice(targetIndex + (placeAfter ? 1 : 0), 0, ...sourceRows);
  return next;
}

export function useEditorGroupReordering({
  groups,
  known,
  unknown,
  objects,
  setGroups,
  setKnown,
  setUnknown,
  setObjects,
}: {
  groups: EditorGroup[];
  known: ExpressionRow[];
  unknown: ExpressionRow[];
  objects: ObjectOrderItem[];
  setGroups: Dispatch<SetStateAction<EditorGroup[]>>;
  setKnown: RowSetter;
  setUnknown: RowSetter;
  setObjects: (items: ObjectOrderItem[]) => void;
}) {
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const draggedGroupRef = useRef<EditorGroup | null>(null);
  const lastTargetRef = useRef<{
    key: string;
    clientY: number;
  } | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const lastPointerYRef = useRef<number | null>(null);
  const dragStepRef = useRef({ pointerY: 0, distance: 20 });
  const dragAnchorRef = useRef<{
    pointerY: number;
    offsetY: number;
    scrollRegion: HTMLElement;
  } | null>(null);
  const groupsRef = useRef(groups);
  const knownRef = useRef(known);
  const unknownRef = useRef(unknown);
  const objectsRef = useRef(objects);

  useEffect(() => {
    groupsRef.current = groups;
    knownRef.current = known;
    unknownRef.current = unknown;
    objectsRef.current = objects;
  }, [groups, known, objects, unknown]);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const commitGroupMove = (
    source: EditorGroup,
    parentGroupId: string | undefined,
    target: { kind: "item" | "group"; id: string } | null,
    placement: "before" | "after" | "first" | "last",
  ) => {
    const sectionGroups = groupsRef.current.filter(
      (group) => group.section === source.section,
    );
    let nextGroups: EditorGroup[];
    if (source.section === "known") {
      const moved = moveEditorGroupByOrder(
        knownRef.current,
        sectionGroups,
        source.id,
        parentGroupId,
        target,
        placement,
      );
      knownRef.current = moved.items;
      setKnown(moved.items);
      nextGroups = moved.groups;
    } else if (source.section === "unknown") {
      const moved = moveEditorGroupByOrder(
        unknownRef.current,
        sectionGroups,
        source.id,
        parentGroupId,
        target,
        placement,
      );
      unknownRef.current = moved.items;
      setUnknown(moved.items);
      nextGroups = moved.groups;
    } else {
      const moved = moveEditorGroupByOrder(
        objectsRef.current,
        sectionGroups,
        source.id,
        parentGroupId,
        target,
        placement,
      );
      objectsRef.current = moved.items;
      setObjects(moved.items);
      nextGroups = moved.groups;
    }
    const movedGroups = new Map(nextGroups.map((group) => [group.id, group]));
    groupsRef.current = groupsRef.current.map(
      (group) => movedGroups.get(group.id) ?? group,
    );
    setGroups(groupsRef.current);
    const updated = groupsRef.current.find((group) => group.id === source.id);
    if (updated) draggedGroupRef.current = updated;
  };

  const isGroupDescendant = (candidateId: string, ancestorId: string) => {
    if (candidateId === ancestorId) return true;
    let current = groupsRef.current.find((group) => group.id === candidateId);
    const visited = new Set<string>();
    while (current?.parentGroupId && !visited.has(current.id)) {
      if (current.parentGroupId === ancestorId) return true;
      visited.add(current.id);
      current = groupsRef.current.find(
        (group) => group.id === current?.parentGroupId,
      );
    }
    return false;
  };

  const groupSiblingTokens = (source: EditorGroup) => {
    const rows =
      source.section === "known"
        ? knownRef.current
        : source.section === "unknown"
          ? unknownRef.current
          : objectsRef.current;
    return [
      ...rows
        .filter((row) => row.groupId === source.parentGroupId)
        .map((row, index) => ({
          kind: "item" as const,
          id: String(row.id),
          order: row.editorOrder ?? index,
        })),
      ...groupsRef.current
        .filter(
          (group) =>
            group.section === source.section &&
            group.parentGroupId === source.parentGroupId,
        )
        .map((group, index) => ({
          kind: "group" as const,
          id: group.id,
          order: group.editorOrder ?? rows.length + index,
        })),
    ].sort((first, second) => first.order - second.order);
  };

  const normalizeGroupSection = (section: EditorGroup["section"]) => {
    const sectionGroups = groupsRef.current.filter(
      (group) => group.section === section,
    );
    let normalizedGroups: EditorGroup[];
    if (section === "known") {
      const normalized = materializeEditorOrder(
        knownRef.current,
        sectionGroups,
      );
      knownRef.current = normalized.items;
      setKnown(knownRef.current);
      normalizedGroups = normalized.groups;
    } else if (section === "unknown") {
      const normalized = materializeEditorOrder(
        unknownRef.current,
        sectionGroups,
      );
      unknownRef.current = normalized.items;
      setUnknown(unknownRef.current);
      normalizedGroups = normalized.groups;
    } else {
      const normalized = materializeEditorOrder(
        objectsRef.current,
        sectionGroups,
      );
      objectsRef.current = normalized.items;
      setObjects(objectsRef.current);
      normalizedGroups = normalized.groups;
    }
    const normalizedGroupMap = new Map(
      normalizedGroups.map((group) => [group.id, group]),
    );
    groupsRef.current = groupsRef.current.map(
      (group) => normalizedGroupMap.get(group.id) ?? group,
    );
    setGroups(groupsRef.current);
  };

  const advanceGroupDown = (source: EditorGroup, clientY: number) => {
    const siblings = groupSiblingTokens(source);
    const sourceIndex = siblings.findIndex(
      (token) => token.kind === "group" && token.id === source.id,
    );
    if (sourceIndex < 0) return false;
    const next = siblings[sourceIndex + 1];
    if (!next) {
      const parent = source.parentGroupId
        ? groupsRef.current.find(
            (group) => group.id === source.parentGroupId,
          )
        : undefined;
      if (!parent) return false;
      const targetKey = `exit-on-content:${parent.id}`;
      if (shouldSkipTarget(targetKey, clientY)) return true;
      commitGroupMove(
        source,
        parent.parentGroupId,
        { kind: "group", id: parent.id },
        "after",
      );
      return true;
    }
    const targetKey = `advance:${next.kind}:${next.id}`;
    if (shouldSkipTarget(targetKey, clientY)) return true;
    if (next.kind === "group") {
      const targetGroup = groupsRef.current.find(
        (group) => group.id === next.id,
      );
      if (targetGroup && !targetGroup.collapsed) {
        commitGroupMove(source, targetGroup.id, null, "first");
      } else {
        commitGroupMove(
          source,
          source.parentGroupId,
          { kind: "group", id: next.id },
          "after",
        );
      }
    } else {
      commitGroupMove(
        source,
        source.parentGroupId,
        { kind: "item", id: next.id },
        "after",
      );
    }
    return true;
  };

  const reorderEditorGroup = (
    source: EditorGroup,
    targetId: string,
    placeAfter: boolean,
  ) => {
    if (source.id === targetId) return;
    const target = groups.find((group) => group.id === targetId);
    if (!target) return;
    const descendants = new Set<string>([source.id]);
    let changed = true;
    while (changed) {
      changed = false;
      groups.forEach((candidate) => {
        if (candidate.parentGroupId && descendants.has(candidate.parentGroupId) && !descendants.has(candidate.id)) {
          descendants.add(candidate.id);
          changed = true;
        }
      });
    }
    if (descendants.has(targetId)) return;
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
              parentGroupId: target.parentGroupId,
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
          groups,
          source.id,
          targetId,
          placeAfter,
        ),
      );
    } else if (source.section === "unknown") {
      setUnknown((current) =>
        repositionExpressionGroup(
          current,
          groups,
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
    normalizeGroupSection(group.section);
    const source =
      groupsRef.current.find((candidate) => candidate.id === group.id) ??
      group;
    const siblings = groupSiblingTokens(source);
    const sourceIndex = siblings.findIndex(
      (token) => token.kind === "group" && token.id === source.id,
    );
    if (sourceIndex < 0) return;
    const target = siblings[sourceIndex + direction];
    if (!target) {
      const parent = source.parentGroupId
        ? groupsRef.current.find(
            (candidate) => candidate.id === source.parentGroupId,
          )
        : undefined;
      if (!parent) return;
      commitGroupMove(
        source,
        parent.parentGroupId,
        { kind: "group", id: parent.id },
        direction < 0 ? "before" : "after",
      );
      return;
    }
    if (target.kind === "item") {
      commitGroupMove(
        source,
        source.parentGroupId,
        target,
        direction < 0 ? "before" : "after",
      );
      return;
    }
    const targetGroup = groupsRef.current.find(
      (candidate) => candidate.id === target.id,
    );
    if (targetGroup && !targetGroup.collapsed) {
      commitGroupMove(
        source,
        targetGroup.id,
        null,
        direction < 0 ? "last" : "first",
      );
      return;
    }
    commitGroupMove(
      source,
      source.parentGroupId,
      target,
      direction < 0 ? "before" : "after",
    );
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
        groups,
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
      const sectionGroups = groupsRef.current.filter(
        (item) => item.section === group.section,
      );
      let nextGroups: EditorGroup[];
      if (group.section === "known") {
        const materialized = materializeEditorOrder(
          knownRef.current,
          sectionGroups,
        );
        knownRef.current = materialized.items;
        setKnown(materialized.items);
        nextGroups = materialized.groups;
      } else if (group.section === "unknown") {
        const materialized = materializeEditorOrder(
          unknownRef.current,
          sectionGroups,
        );
        unknownRef.current = materialized.items;
        setUnknown(materialized.items);
        nextGroups = materialized.groups;
      } else {
        const materialized = materializeEditorOrder(
          objectsRef.current,
          sectionGroups,
        );
        objectsRef.current = materialized.items;
        setObjects(materialized.items);
        nextGroups = materialized.groups;
      }
      const materializedGroups = new Map(
        nextGroups.map((item) => [item.id, item]),
      );
      groupsRef.current = groupsRef.current.map(
        (item) => materializedGroups.get(item.id) ?? item,
      );
      setGroups(groupsRef.current);
      draggedGroupRef.current =
        groupsRef.current.find((item) => item.id === group.id) ?? group;
      lastTargetRef.current = null;
      setDraggedGroupId(group.id);
      lastPointerYRef.current = event.clientY;
      const sourceHeader = event.currentTarget.closest<HTMLElement>(
        ".editor-group-header",
      );
      const sourceBounds = sourceHeader?.getBoundingClientRect();
      dragStepRef.current = {
        pointerY: event.clientY,
        distance: Math.max(18, (sourceBounds?.height ?? 38) * 0.55),
      };
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
      dragCleanupRef.current?.();
      const move = (moveEvent: PointerEvent) => {
        const source = draggedGroupRef.current;
        if (!source || source.id !== group.id) return;
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
        const boundary = hit?.closest<HTMLElement>(
          "[data-editor-group-boundary]",
        );
        const boundaryGroupId = boundary?.dataset.editorGroupId;
        if (
          boundary?.dataset.editorGroupSection === source.section &&
          boundaryGroupId
        ) {
          if (boundaryGroupId === source.parentGroupId) {
            const parent = groupsRef.current.find(
              (group) => group.id === boundaryGroupId,
            );
            const targetKey = `exit:${boundaryGroupId}`;
            if (!shouldSkipTarget(targetKey, moveEvent.clientY)) {
              commitGroupMove(
                source,
                parent?.parentGroupId,
                { kind: "group", id: boundaryGroupId },
                "after",
              );
              dragStepRef.current.pointerY = moveEvent.clientY;
            }
            return;
          }
          if (
            boundaryGroupId === source.id ||
            isGroupDescendant(boundaryGroupId, source.id)
          ) {
            if (
              moveEvent.clientY - dragStepRef.current.pointerY >=
                dragStepRef.current.distance &&
              advanceGroupDown(source, moveEvent.clientY)
            ) {
              dragStepRef.current.pointerY = moveEvent.clientY;
            }
            return;
          }
          commitGroupMove(source, boundaryGroupId, null, "last");
          dragStepRef.current.pointerY = moveEvent.clientY;
          return;
        }
        const sourceHeaderHit = hit?.closest<HTMLElement>(
          ".editor-group-header[data-editor-group-id]",
        );
        if (sourceHeaderHit?.dataset.editorGroupId === source.id) {
          dragStepRef.current.pointerY = moveEvent.clientY;
          lastTargetRef.current = null;
          return;
        }
        const hitGroupId = hit
          ?.closest<HTMLElement>("[data-editor-group-id]")
          ?.dataset.editorGroupId;
        const hitRowGroupId = hit
          ?.closest<HTMLElement>("[data-expression-row]")
          ?.dataset.expressionGroupId;
        const hitObjectGroupId = hit
          ?.closest<HTMLElement>("[data-object-row]")
          ?.dataset.objectGroupId;
        const hitsOwnContent =
          (hitGroupId && isGroupDescendant(hitGroupId, source.id)) ||
          (hitRowGroupId && isGroupDescendant(hitRowGroupId, source.id)) ||
          (hitObjectGroupId &&
            isGroupDescendant(hitObjectGroupId, source.id));
        if (hitsOwnContent) {
          if (
            pointerDirection > 0 &&
            moveEvent.clientY - dragStepRef.current.pointerY >=
              dragStepRef.current.distance &&
            advanceGroupDown(source, moveEvent.clientY)
          ) {
            dragStepRef.current.pointerY = moveEvent.clientY;
          }
          return;
        }
        {
          const orderedGroup = hit?.closest<HTMLElement>(
            ".editor-group-header[data-editor-group-id]",
          );
          const targetGroupId = orderedGroup?.dataset.editorGroupId;
          if (
            orderedGroup?.dataset.editorGroupSection === source.section &&
            targetGroupId &&
            targetGroupId !== source.id &&
            !isGroupDescendant(targetGroupId, source.id)
          ) {
            const targetGroup = groupsRef.current.find(
              (group) => group.id === targetGroupId,
            );
            if (!targetGroup) return;
            const targetKey = `ordered-group:${targetGroupId}:before`;
            if (shouldSkipTarget(targetKey, moveEvent.clientY)) return;
            commitGroupMove(
              source,
              targetGroup.parentGroupId,
              { kind: "group", id: targetGroupId },
              "before",
            );
            dragStepRef.current.pointerY = moveEvent.clientY;
            return;
          }
          const orderedRow = hit?.closest<HTMLElement>(
            `[data-expression-group="${source.section}"][data-expression-row]`,
          );
          const rowId = Number(orderedRow?.dataset.expressionRow);
          if (orderedRow && Number.isSafeInteger(rowId)) {
            const rowGroupId = orderedRow.dataset.expressionGroupId || undefined;
            if (rowGroupId && isGroupDescendant(rowGroupId, source.id)) return;
            const bounds = orderedRow.getBoundingClientRect();
            const placement = moveEvent.clientY < bounds.top + bounds.height / 2
              ? "before"
              : "after";
            const targetKey = `ordered-row:${rowId}:${placement}:${rowGroupId ?? ""}`;
            if (shouldSkipTarget(targetKey, moveEvent.clientY)) return;
            commitGroupMove(
              source,
              rowGroupId,
              { kind: "item", id: String(rowId) },
              placement,
            );
            dragStepRef.current.pointerY = moveEvent.clientY;
            return;
          }
          const orderedObject = hit?.closest<HTMLElement>(
            "[data-object-row][data-object-kind]",
          );
          const objectKind = orderedObject?.dataset.objectKind;
          const objectId = orderedObject?.dataset.objectRow;
          if (
            source.section === "objects" &&
            orderedObject &&
            (objectKind === "point" || objectKind === "shape") &&
            objectId
          ) {
            const parentGroupId =
              orderedObject.dataset.objectGroupId || undefined;
            if (
              parentGroupId &&
              isGroupDescendant(parentGroupId, source.id)
            ) {
              return;
            }
            const bounds = orderedObject.getBoundingClientRect();
            const placement =
              moveEvent.clientY < bounds.top + bounds.height / 2
                ? "before"
                : "after";
            const targetId = `${objectKind}:${objectId}`;
            const targetKey = `ordered-object:${targetId}:${placement}`;
            if (shouldSkipTarget(targetKey, moveEvent.clientY)) return;
            commitGroupMove(
              source,
              parentGroupId,
              { kind: "item", id: targetId },
              placement,
            );
            dragStepRef.current.pointerY = moveEvent.clientY;
            return;
          }
        }
        const groupTarget = hit?.closest<HTMLElement>(
          ".editor-group-header[data-editor-group-id]",
        );
        const targetGroupId = groupTarget?.dataset.editorGroupId;
        if (
          groupTarget?.dataset.editorGroupSection === source.section &&
          targetGroupId &&
          targetGroupId !== source.id &&
          !isGroupDescendant(targetGroupId, source.id)
        ) {
          const targetBounds = groupTarget.getBoundingClientRect();
          const relativeY =
            (moveEvent.clientY - targetBounds.top) / targetBounds.height;
          const canEnter =
            groupTarget.dataset.editorGroupCollapsed !== "true" &&
            relativeY >= 0.2 &&
            relativeY <= 0.8;
          if (canEnter) {
            const targetKey = `inside:${targetGroupId}`;
            if (shouldSkipTarget(targetKey, moveEvent.clientY)) return;
            const sectionRows =
              source.section === "known"
                ? known
                : source.section === "unknown"
                  ? unknown
                  : [];
            const firstTargetRow = sectionRows.find(
              (row) => row.groupId === targetGroupId,
            );
            setGroups((current) => current.map((candidate) =>
              candidate.id === source.id
                ? {
                    ...candidate,
                    parentGroupId: targetGroupId,
                    anchorId: firstTargetRow
                      ? String(firstTargetRow.id)
                      : undefined,
                    anchorSide: firstTargetRow ? "before" : undefined,
                  }
                : candidate,
            ));
            return;
          }
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
          if (rowGroupId && !isGroupDescendant(rowGroupId, source.id)) {
            const targetKey = `inside-row:${rowGroupId}:${rowId}:${placeAfter}`;
            if (shouldSkipTarget(targetKey, moveEvent.clientY)) return;
            setGroups((current) =>
              current.map((candidate) =>
                candidate.id === source.id
                  ? {
                      ...candidate,
                      parentGroupId: rowGroupId,
                      anchorId: String(rowId),
                      anchorSide: placeAfter ? "after" : "before",
                    }
                  : candidate,
              ),
            );
          } else if (!rowGroupId) {
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
        dragAnchorRef.current = null;
        lastPointerYRef.current = null;
        dragStepRef.current = { pointerY: 0, distance: 20 };
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
