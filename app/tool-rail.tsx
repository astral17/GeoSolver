"use client";

import { ToolGlyph } from "./interface-icons";
import type {
  ToolDefinition,
  ToolGroupDefinition,
  ToolGroupId,
  ToolId,
} from "./tools";

const MOBILE_WORKSPACE_QUERY =
  "(max-width: 680px), (max-width: 1000px) and (max-height: 650px) and (orientation: landscape)";

type Translate = (russian: string, english: string) => string;

type ToolRailProps = {
  tools: ToolDefinition[];
  toolGroups: ToolGroupDefinition[];
  railItems: (
    | { kind: "tool"; id: ToolId }
    | { kind: "group"; id: ToolGroupId }
  )[];
  activeTool: ToolId;
  openToolGroup: ToolGroupId | null;
  toolGroupIndex: number;
  canDelete: boolean;
  t: Translate;
  chooseTool: (tool: ToolId) => void;
  openToolGroupMenu: (group: ToolGroupId) => void;
  toggleToolGroupMenu: (group: ToolGroupId) => void;
  scheduleToolGroupClose: () => void;
  setToolGroupIndex: (index: number) => void;
  deleteSelected: () => void;
};

export function ToolRail({
  tools,
  toolGroups,
  railItems,
  activeTool,
  openToolGroup,
  toolGroupIndex,
  canDelete,
  t,
  chooseTool,
  openToolGroupMenu,
  toggleToolGroupMenu,
  scheduleToolGroupClose,
  setToolGroupIndex,
  deleteSelected,
}: ToolRailProps) {
  return (
    <nav
      className="tool-rail"
      aria-label={t("Инструменты построения", "Construction tools")}
    >
      {railItems.map((item) => {
        if (item.kind === "tool") {
          const tool = tools.find((candidate) => candidate.id === item.id);
          if (!tool) return null;
          return (
            <button
              key={tool.id}
              data-tool={tool.id}
              className={activeTool === tool.id ? "active" : ""}
              onClick={() => chooseTool(tool.id)}
              title={`${tool.label} · ${tool.shortcut}`}
              aria-label={tool.label}
            >
              <ToolGlyph tool={tool} />
              <kbd className="tool-shortcut">{tool.shortcut}</kbd>
            </button>
          );
        }

        const group = toolGroups.find(
          (candidate) => candidate.id === item.id,
        );
        if (!group) return null;
        const groupTools = group.toolIds
          .map((id) => tools.find((tool) => tool.id === id))
          .filter((tool): tool is ToolDefinition => Boolean(tool));
        const groupActive = group.toolIds.includes(activeTool);
        const selectedGroupTool = groupTools.find(
          (tool) => tool.id === activeTool,
        );
        const groupOpen = openToolGroup === group.id;
        return (
          <div
            className="tool-group-slot"
            key={group.id}
            onPointerEnter={(event) => {
              if (
                event.pointerType === "mouse" &&
                !window.matchMedia(MOBILE_WORKSPACE_QUERY).matches
              ) {
                openToolGroupMenu(group.id);
              }
            }}
            onPointerLeave={(event) => {
              if (
                event.pointerType === "mouse" &&
                !window.matchMedia(MOBILE_WORKSPACE_QUERY).matches
              ) {
                scheduleToolGroupClose();
              }
            }}
          >
            <button
              data-tool-group={group.id}
              className={`tool-group-trigger ${
                groupActive || groupOpen ? "active" : ""
              }`}
              onClick={() => toggleToolGroupMenu(group.id)}
              title={`${group.label} · ${group.shortcut}${
                selectedGroupTool ? ` · ${selectedGroupTool.label}` : ""
              }`}
              aria-label={
                selectedGroupTool
                  ? t(
                      `${group.label}: выбран ${selectedGroupTool.label}`,
                      `${group.label}: ${selectedGroupTool.label} selected`,
                    )
                  : group.label
              }
              aria-haspopup="menu"
              aria-expanded={groupOpen}
            >
              {selectedGroupTool ? (
                <ToolGlyph tool={selectedGroupTool} />
              ) : (
                <span className="tool-glyph" aria-hidden="true">
                  {group.icon}
                </span>
              )}
              <i className="tool-group-caret">›</i>
              <kbd className="tool-shortcut">{group.shortcut}</kbd>
            </button>
            {groupOpen && (
              <div
                className={`tool-flyout ${
                  group.id === "triangles" ||
                  group.id === "quadrilaterals" ||
                  group.id === "polygons" ||
                  group.id === "constraints"
                    ? "align-bottom"
                    : ""
                }`}
                role="menu"
                aria-label={group.label}
              >
                <div className="tool-flyout-title">
                  <b>{group.label}</b>
                  <span>↑↓ · Enter</span>
                </div>
                {groupTools.map((tool, index) => (
                  <button
                    className={`tool-flyout-item ${
                      toolGroupIndex === index ? "focused" : ""
                    } ${activeTool === tool.id ? "current" : ""}`}
                    key={tool.id}
                    role="menuitem"
                    onMouseEnter={() => setToolGroupIndex(index)}
                    onClick={() => chooseTool(tool.id)}
                  >
                    <ToolGlyph tool={tool} />
                    <span>
                      <b>{tool.label}</b>
                      <small>{tool.hint}</small>
                    </span>
                    <kbd>{index + 1}</kbd>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="rail-spacer" />
      <button
        onClick={deleteSelected}
        disabled={!canDelete}
        title={t("Удалить выбранные объекты", "Delete selected objects")}
        aria-label={t("Удалить", "Delete")}
      >
        <span className="trash-icon">×</span>
      </button>
    </nav>
  );
}
