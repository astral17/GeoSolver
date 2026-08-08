"use client";

import {
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
} from "react";
import type { EditorGroup } from "./domain";

type Translate = (russian: string, english: string) => string;

function focusNavigationEntry(
  entry: HTMLElement,
  preferredColumn?: string,
) {
  let target: HTMLElement | null = null;
  if (entry.dataset.editorNavigationKind === "object") {
    const fields = Array.from(
      entry.querySelectorAll<HTMLElement>("[data-object-column]"),
    );
    target =
      fields.find(
        (field) => field.dataset.objectColumn === preferredColumn,
      ) ??
      entry.querySelector<HTMLElement>("[data-object-primary]") ??
      fields[0] ??
      null;
  } else {
    target = entry;
    if (
      entry.dataset.editorNavigationKind === "group" &&
      preferredColumn
    ) {
      entry.dataset.editorNavigationColumn = preferredColumn;
    }
  }
  if (!target) return false;
  target.focus();
  if (
    target instanceof HTMLInputElement &&
    target.type === "text"
  ) {
    target.setSelectionRange(target.value.length, target.value.length);
  }
  return true;
}

export function focusAdjacentEditorEntry(
  current: HTMLElement,
  direction: -1 | 1,
  preferredColumn?: string,
) {
  const currentEntry = current.closest<HTMLElement>(
    "[data-editor-navigation-entry]",
  );
  if (!currentEntry) return false;
  const entries = Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-editor-navigation-entry]",
    ),
  );
  const index = entries.indexOf(currentEntry);
  const target = entries[index + direction];
  const navigationColumn =
    preferredColumn ?? currentEntry.dataset.editorNavigationColumn;
  return target
    ? focusNavigationEntry(target, navigationColumn)
    : false;
}

export function focusEditorSectionEdge(
  section: EditorGroup["section"],
  edge: "first" | "last",
  preferredColumn?: string,
) {
  const entries = Array.from(
    document.querySelectorAll<HTMLElement>(
      `[data-editor-navigation-section="${section}"]`,
    ),
  );
  const target = edge === "first" ? entries[0] : entries[entries.length - 1];
  return target
    ? focusNavigationEntry(target, preferredColumn)
    : false;
}

export function partitionGroupedItems<T extends { groupId?: string }>(
  items: T[],
  groups: EditorGroup[],
) {
  return {
    ungrouped: items.filter(
      (item) =>
        !item.groupId || !groups.some((group) => group.id === item.groupId),
    ),
    grouped: groups.map((group) => ({
      group,
      items: items.filter((item) => item.groupId === group.id),
    })),
  };
}

export function buildGroupedEntries<
  T extends {
    id: string | number;
    groupId?: string;
    editorOrder?: number;
  },
>(
  items: T[],
  groups: EditorGroup[],
) {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const itemIndex = new Map(
    items.map((item, index) => [String(item.id), index]),
  );
  const validParent = (group: EditorGroup) => {
    const seen = new Set([group.id]);
    let parentId = group.parentGroupId;
    while (parentId) {
      if (seen.has(parentId)) return undefined;
      seen.add(parentId);
      const parent = groupById.get(parentId);
      if (!parent || parent.section !== group.section) return undefined;
      parentId = parent.parentGroupId;
    }
    return group.parentGroupId;
  };
  const parentByGroup = new Map(
    groups.map((group) => [group.id, validParent(group)]),
  );
  const entries: (
    | { kind: "item"; item: T; depth: number }
    | { kind: "group"; group: EditorGroup; count: number; depth: number }
    | { kind: "groupEnd"; group: EditorGroup; depth: number }
  )[] = [];
  const descendants = (groupId: string): string[] => [
    groupId,
    ...groups
      .filter((group) => parentByGroup.get(group.id) === groupId)
      .flatMap((group) => descendants(group.id)),
  ];
  const descendantCount = (groupId: string) => {
    const ids = new Set(descendants(groupId));
    return items.filter((item) => item.groupId && ids.has(item.groupId)).length;
  };
  const firstDescendantIndex = (groupId: string) => {
    const ids = new Set(descendants(groupId));
    return items.reduce(
      (minimum, item, index) =>
        item.groupId && ids.has(item.groupId)
          ? Math.min(minimum, index)
          : minimum,
      Number.POSITIVE_INFINITY,
    );
  };
  const emitContainer = (parentGroupId: string | undefined, depth: number) => {
    const directItems = items.filter((item) => {
      const itemGroup = item.groupId ? groupById.get(item.groupId) : undefined;
      const normalizedGroupId = itemGroup ? item.groupId : undefined;
      return normalizedGroupId === parentGroupId;
    });
    const childGroups = groups.filter(
      (group) => parentByGroup.get(group.id) === parentGroupId,
    );
    const tokens = [
      ...directItems.map((item) => ({
        kind: "item" as const,
        item,
        order:
          item.editorOrder ??
          itemIndex.get(String(item.id)) ??
          Number.POSITIVE_INFINITY,
        tie: 1,
      })),
      ...childGroups.map((group, index) => {
        const anchorIndex = group.anchorId
          ? itemIndex.get(group.anchorId)
          : undefined;
        return {
          kind: "group" as const,
          group,
          order:
            group.editorOrder !== undefined
              ? group.editorOrder
              : anchorIndex !== undefined
              ? anchorIndex + (group.anchorSide === "after" ? 0.25 : -0.25)
              : firstDescendantIndex(group.id),
          tie: groups.indexOf(group) + index / 1000,
        };
      }),
    ].sort((first, second) =>
      first.order === second.order
        ? first.tie - second.tie
        : first.order - second.order,
    );
    tokens.forEach((token) => {
      if (token.kind === "item") {
        entries.push({ kind: "item", item: token.item, depth });
        return;
      }
      const count = descendantCount(token.group.id);
      entries.push({ kind: "group", group: token.group, count, depth });
      if (token.group.collapsed) return;
      emitContainer(token.group.id, depth + 1);
      entries.push({ kind: "groupEnd", group: token.group, depth });
    });
  };
  emitContainer(undefined, 0);

  return entries;
}

export function visibleGroupedItems<
  T extends { id: string | number; groupId?: string },
>(
  items: T[],
  groups: EditorGroup[],
) {
  return buildGroupedEntries(items, groups).flatMap((entry) =>
    entry.kind === "item" ? [entry.item] : [],
  );
}

type OrderedEditorItem = {
  id: string | number;
  groupId?: string;
  editorOrder?: number;
};

type EditorToken =
  | { kind: "item"; id: string; order: number }
  | { kind: "group"; id: string; order: number };

const tokenKey = (token: Pick<EditorToken, "kind" | "id">) =>
  `${token.kind}:${token.id}`;

export function materializeEditorOrder<T extends OrderedEditorItem>(
  items: T[],
  groups: EditorGroup[],
): { items: T[]; groups: EditorGroup[] } {
  const itemOrder = new Map<string, number>();
  const groupOrder = new Map<string, number>();
  const nextByParent = new Map<string, number>();
  const nextOrder = (parentGroupId: string | undefined) => {
    const key = parentGroupId ?? "";
    const order = nextByParent.get(key) ?? 0;
    nextByParent.set(key, order + 1);
    return order;
  };
  buildGroupedEntries(
    items,
    groups.map((group) => ({ ...group, collapsed: false })),
  ).forEach((entry) => {
    if (entry.kind === "item") {
      itemOrder.set(
        String(entry.item.id),
        nextOrder(entry.item.groupId),
      );
    } else if (entry.kind === "group") {
      groupOrder.set(
        entry.group.id,
        nextOrder(entry.group.parentGroupId),
      );
    }
  });
  return {
    items: items.map(
      (item) =>
        ({
          ...item,
          editorOrder: itemOrder.get(String(item.id)) ?? item.editorOrder ?? 0,
        }) as T,
    ),
    groups: groups.map((group) => ({
      ...group,
      editorOrder: groupOrder.get(group.id) ?? group.editorOrder ?? 0,
      anchorId: undefined,
      anchorSide: undefined,
    })),
  };
}

function containerTokens<T extends OrderedEditorItem>(
  items: T[],
  groups: EditorGroup[],
  parentGroupId: string | undefined,
) {
  return [
    ...items
      .filter((item) => item.groupId === parentGroupId)
      .map((item) => ({
        kind: "item" as const,
        id: String(item.id),
        order: item.editorOrder ?? 0,
      })),
    ...groups
      .filter((group) => group.parentGroupId === parentGroupId)
      .map((group) => ({
        kind: "group" as const,
        id: group.id,
        order: group.editorOrder ?? 0,
      })),
  ].sort((first, second) => first.order - second.order);
}

function assignContainerOrder<T extends OrderedEditorItem>(
  items: T[],
  groups: EditorGroup[],
  parentGroupId: string | undefined,
  tokens: EditorToken[],
): { items: T[]; groups: EditorGroup[] } {
  const order = new Map(tokens.map((token, index) => [tokenKey(token), index]));
  return {
    items: items.map((item) =>
      item.groupId === parentGroupId
        ? {
            ...item,
            editorOrder:
              order.get(`item:${String(item.id)}`) ?? item.editorOrder,
          }
        : item,
    ),
    groups: groups.map((group) =>
      group.parentGroupId === parentGroupId
        ? {
            ...group,
            editorOrder: order.get(`group:${group.id}`) ?? group.editorOrder,
          }
        : group,
    ),
  };
}

export function moveEditorRow<T extends OrderedEditorItem>(
  sourceItems: T[],
  sourceGroups: EditorGroup[],
  sourceId: string | number,
  parentGroupId: string | undefined,
  target: { kind: "item" | "group"; id: string } | null,
  placement: "before" | "after" | "first" | "last",
) {
  let { items, groups } = materializeEditorOrder(sourceItems, sourceGroups);
  const source = items.find((item) => String(item.id) === String(sourceId));
  if (!source) return { items: sourceItems, groups: sourceGroups };
  const previousParent = source.groupId;
  items = items.map((item) =>
    String(item.id) === String(sourceId)
      ? { ...item, groupId: parentGroupId }
      : item,
  );
  const sourceKey = `item:${String(sourceId)}`;
  const targetTokens = containerTokens(items, groups, parentGroupId).filter(
    (token) => tokenKey(token) !== sourceKey,
  );
  let insertIndex = placement === "first" ? 0 : targetTokens.length;
  if (target) {
    const targetIndex = targetTokens.findIndex(
      (token) => tokenKey(token) === `${target.kind}:${target.id}`,
    );
    if (targetIndex < 0) return { items: sourceItems, groups: sourceGroups };
    insertIndex = targetIndex + (placement === "after" ? 1 : 0);
  }
  targetTokens.splice(insertIndex, 0, {
    kind: "item",
    id: String(sourceId),
    order: insertIndex,
  });
  ({ items, groups } = assignContainerOrder(
    items,
    groups,
    parentGroupId,
    targetTokens,
  ));
  if (previousParent !== parentGroupId) {
    ({ items, groups } = assignContainerOrder(
      items,
      groups,
      previousParent,
      containerTokens(items, groups, previousParent),
    ));
  }
  return { items, groups };
}

/**
 * Moves a row by one logical position inside the recursive editor tree.
 *
 * Keyboard reordering used to walk the flattened, visible list. That made a
 * single Alt+Arrow step depend on which groups happened to be expanded and,
 * with duplicate legacy editorOrder values, could select an unrelated row.
 * This helper always normalizes the tree first and then moves between direct
 * siblings. Crossing a container edge explicitly exits the current group.
 */
export function moveEditorRowOneStep<T extends OrderedEditorItem>(
  sourceItems: T[],
  sourceGroups: EditorGroup[],
  sourceId: string | number,
  direction: -1 | 1,
) {
  const normalized = materializeEditorOrder(sourceItems, sourceGroups);
  const source = normalized.items.find(
    (item) => String(item.id) === String(sourceId),
  );
  if (!source) return normalized;

  const siblings = containerTokens(
    normalized.items,
    normalized.groups,
    source.groupId,
  );
  const sourceIndex = siblings.findIndex(
    (token) => token.kind === "item" && token.id === String(sourceId),
  );
  if (sourceIndex < 0) return normalized;
  const target = siblings[sourceIndex + direction];

  if (!target) {
    const parent = source.groupId
      ? normalized.groups.find((group) => group.id === source.groupId)
      : undefined;
    if (!parent) return normalized;
    return moveEditorRow(
      normalized.items,
      normalized.groups,
      sourceId,
      parent.parentGroupId,
      { kind: "group", id: parent.id },
      direction < 0 ? "before" : "after",
    );
  }

  if (target.kind === "group") {
    const targetGroup = normalized.groups.find(
      (group) => group.id === target.id,
    );
    if (targetGroup && !targetGroup.collapsed) {
      return moveEditorRow(
        normalized.items,
        normalized.groups,
        sourceId,
        targetGroup.id,
        null,
        direction < 0 ? "last" : "first",
      );
    }
  }

  return moveEditorRow(
    normalized.items,
    normalized.groups,
    sourceId,
    source.groupId,
    target,
    direction < 0 ? "before" : "after",
  );
}

export function moveEditorGroupByOrder<T extends OrderedEditorItem>(
  sourceItems: T[],
  sourceGroups: EditorGroup[],
  sourceId: string,
  parentGroupId: string | undefined,
  target: { kind: "item" | "group"; id: string } | null,
  placement: "before" | "after" | "first" | "last",
) {
  let { items, groups } = materializeEditorOrder(sourceItems, sourceGroups);
  const source = groups.find((group) => group.id === sourceId);
  if (!source) return { items: sourceItems, groups: sourceGroups };
  const previousParent = source.parentGroupId;
  groups = groups.map((group) =>
    group.id === sourceId ? { ...group, parentGroupId } : group,
  );
  const sourceKey = `group:${sourceId}`;
  const targetTokens = containerTokens(items, groups, parentGroupId).filter(
    (token) => tokenKey(token) !== sourceKey,
  );
  let insertIndex = placement === "first" ? 0 : targetTokens.length;
  if (target) {
    const targetIndex = targetTokens.findIndex(
      (token) => tokenKey(token) === `${target.kind}:${target.id}`,
    );
    if (targetIndex < 0) return { items: sourceItems, groups: sourceGroups };
    insertIndex = targetIndex + (placement === "after" ? 1 : 0);
  }
  targetTokens.splice(insertIndex, 0, {
    kind: "group",
    id: sourceId,
    order: insertIndex,
  });
  ({ items, groups } = assignContainerOrder(
    items,
    groups,
    parentGroupId,
    targetTokens,
  ));
  if (previousParent !== parentGroupId) {
    ({ items, groups } = assignContainerOrder(
      items,
      groups,
      previousParent,
      containerTokens(items, groups, previousParent),
    ));
  }
  return { items, groups };
}

export function EditorGroupAddGlyph() {
  return (
    <svg
      className="group-add-icon"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="5" height="5" rx="0.75" />
      <rect x="9" y="2" width="5" height="5" rx="0.75" />
      <rect x="2" y="9" width="5" height="5" rx="0.75" />
      <rect x="9" y="9" width="5" height="5" rx="0.75" />
    </svg>
  );
}

export function EditorGroupHeader({
  group,
  count,
  t,
  onToggle,
  onRename,
  onDelete,
  onSelect,
  dragging,
  dragHandleProps,
  onMove,
  onNavigate,
  depth = 0,
}: {
  group: EditorGroup;
  count: number;
  t: Translate;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onSelect: () => void;
  dragging?: boolean;
  dragHandleProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  onMove: (direction: -1 | 1) => void;
  onNavigate: (
    current: HTMLInputElement,
    direction: -1 | 1,
  ) => boolean;
  depth?: number;
}) {
  return (
    <div
      className={`editor-group-header ${
        dragging ? "is-reordering" : ""
      }`}
      data-editor-group-id={group.id}
      data-editor-group-section={group.section}
      data-editor-group-collapsed={group.collapsed ? "true" : "false"}
      data-editor-group-count={count}
      data-editor-group-parent-id={group.parentGroupId ?? ""}
      data-editor-group-depth={depth}
      style={{ "--group-depth": depth } as CSSProperties}
    >
      <button
        type="button"
        className="editor-group-drag-handle"
        title={t("Перетащить группу · Alt+↑/↓", "Drag group · Alt+↑/↓")}
        aria-label={t(
          `Переместить группу ${group.name}`,
          `Move group ${group.name}`,
        )}
        {...dragHandleProps}
      >
        ⠿
      </button>
      <button
        type="button"
        className="editor-group-toggle"
        onClick={onToggle}
        aria-expanded={!group.collapsed}
        aria-label={
          group.collapsed
            ? t("Развернуть группу", "Expand group")
            : t("Свернуть группу", "Collapse group")
        }
      >
        <svg
          className={`editor-group-chevron ${
            group.collapsed ? "is-collapsed" : ""
          }`}
          viewBox="0 0 12 12"
          aria-hidden="true"
        >
          <path d="M2.5 4.25 6 7.75l3.5-3.5" />
        </svg>
      </button>
      <EditorGroupName
        key={`${group.id}-${group.name}`}
        group={group}
        t={t}
        onRename={onRename}
        onMove={onMove}
        onNavigate={onNavigate}
      />
      <em>{count}</em>
      <button
        type="button"
        className="editor-group-select"
        onClick={onSelect}
        title={t(
          "Выделить точки группы на чертеже",
          "Select group points on canvas",
        )}
        aria-label={t(
          "Выделить точки группы на чертеже",
          "Select group points on canvas",
        )}
      >
        <span aria-hidden="true">◎</span>
      </button>
      <button
        type="button"
        className="editor-group-delete"
        onClick={onDelete}
        title={t("Удалить группу", "Delete group")}
        aria-label={t("Удалить группу", "Delete group")}
      >
        ×
      </button>
    </div>
  );
}

export function EditorGroupBoundaryDropZone({
  group,
  visible,
  t,
  depth = 0,
}: {
  group: EditorGroup;
  visible: boolean;
  t: Translate;
  depth?: number;
}) {
  if (!visible) return null;
  return (
    <div
      className="editor-group-boundary"
      data-editor-group-boundary="after"
      data-editor-group-id={group.id}
      data-editor-group-section={group.section}
      data-editor-group-depth={depth}
      style={{ "--group-depth": depth } as CSSProperties}
      title={t(
        "Переместить через нижнюю границу группы",
        "Move across the lower group boundary",
      )}
      aria-label={t(
        "Переместить через нижнюю границу группы",
        "Move across the lower group boundary",
      )}
    />
  );
}

function EditorGroupName({
  group,
  t,
  onRename,
  onMove,
  onNavigate,
}: {
  group: EditorGroup;
  t: Translate;
  onRename: (name: string) => void;
  onMove: (direction: -1 | 1) => void;
  onNavigate: (
    current: HTMLInputElement,
    direction: -1 | 1,
  ) => boolean;
}) {
  const [draft, setDraft] = useState(group.name);
  const commit = () => {
    const name = draft.trim();
    if (name) onRename(name);
    else setDraft(group.name);
  };
  return (
    <input
      value={draft}
      name={`group-${group.id}-name`}
      data-editor-navigation-entry=""
      data-editor-navigation-kind="group"
      data-editor-navigation-section={group.section}
      maxLength={80}
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (
          event.altKey &&
          (event.key === "ArrowUp" || event.key === "ArrowDown")
        ) {
          event.preventDefault();
          onMove(event.key === "ArrowUp" ? -1 : 1);
        } else if (
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          (event.key === "ArrowUp" || event.key === "ArrowDown") &&
          onNavigate(
            event.currentTarget,
            event.key === "ArrowUp" ? -1 : 1,
          )
        ) {
          event.preventDefault();
        } else if (event.key === "Enter") {
          event.preventDefault();
          commit();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          setDraft(group.name);
          event.currentTarget.blur();
        }
      }}
      aria-label={t("Название группы", "Group name")}
    />
  );
}
