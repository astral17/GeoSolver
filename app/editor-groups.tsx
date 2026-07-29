"use client";

import {
  useState,
  type ButtonHTMLAttributes,
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
  T extends { id: string | number; groupId?: string },
>(
  items: T[],
  groups: EditorGroup[],
) {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const populatedGroupIds = new Set(
    items.flatMap((item) => (item.groupId ? [item.groupId] : [])),
  );
  const emittedGroups = new Set<string>();
  const entries: (
    | { kind: "item"; item: T }
    | { kind: "group"; group: EditorGroup; count: number }
    | { kind: "groupEnd"; group: EditorGroup }
  )[] = [];
  const emitEmptyGroups = (
    candidates: EditorGroup[],
    predicate: (group: EditorGroup) => boolean,
  ) => {
    candidates.forEach((candidate) => {
      if (
        emittedGroups.has(candidate.id) ||
        populatedGroupIds.has(candidate.id) ||
        !predicate(candidate)
      ) {
        return;
      }
      entries.push({ kind: "group", group: candidate, count: 0 });
      emittedGroups.add(candidate.id);
    });
  };
  const emitAnchoredGroups = (
    itemId: string | number,
    side: "before" | "after",
  ) => {
    const anchorId = String(itemId);
    emitEmptyGroups(
      groups,
      (group) =>
        group.anchorId === anchorId &&
        (group.anchorSide ?? "before") === side,
    );
  };

  for (const item of items) {
    const group = item.groupId ? groupById.get(item.groupId) : undefined;
    if (!group) {
      emitAnchoredGroups(item.id, "before");
      entries.push({ kind: "item", item });
      emitAnchoredGroups(item.id, "after");
      continue;
    }
    if (emittedGroups.has(group.id)) continue;

    const groupIndex = groups.findIndex((candidate) => candidate.id === group.id);
    emitEmptyGroups(
      groups.slice(0, groupIndex),
      (candidate) => !candidate.anchorId,
    );
    const groupItems = items.filter((candidate) => candidate.groupId === group.id);
    entries.push({ kind: "group", group, count: groupItems.length });
    if (!group.collapsed) {
      entries.push(
        ...groupItems.map((groupItem) => ({
          kind: "item" as const,
          item: groupItem,
        })),
      );
    }
    if (!group.collapsed && groupItems.length > 0) {
      entries.push({ kind: "groupEnd", group });
    }
    emittedGroups.add(group.id);
  }

  for (const group of groups) {
    if (emittedGroups.has(group.id)) continue;
    entries.push({ kind: "group", group, count: 0 });
  }

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
}: {
  group: EditorGroup;
  visible: boolean;
  t: Translate;
}) {
  if (!visible) return null;
  return (
    <div
      className="editor-group-boundary"
      data-editor-group-boundary="after"
      data-editor-group-id={group.id}
      data-editor-group-section={group.section}
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

export function EditorGroupDropZone({
  section,
  visible,
  t,
}: {
  section: EditorGroup["section"];
  visible: boolean;
  t: Translate;
}) {
  if (!visible) return null;
  return (
    <div
      className="editor-group-drop-zone"
      data-editor-group-id=""
      data-editor-group-section={section}
    >
      {t("Перетащите сюда, чтобы вынести из группы", "Drop here to ungroup")}
    </div>
  );
}
