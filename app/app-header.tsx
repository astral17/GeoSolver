import type {
  ChangeEvent,
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";

import { AppMark, HistoryArrowIcon } from "./interface-icons";
import { DEFAULT_PROJECT_TITLE } from "./project-state";

type MobilePanel = "conditions" | "canvas" | "solver";
type Translate = (russian: string, english: string) => string;

type AppHeaderProps = {
  projectTitle: string;
  setProjectTitle: Dispatch<SetStateAction<string>>;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  clearDrawing: () => void;
  setHelpOpen: Dispatch<SetStateAction<boolean>>;
  settingsOpen: boolean;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  importInputRef: RefObject<HTMLInputElement | null>;
  handleImportInput: (event: ChangeEvent<HTMLInputElement>) => void;
  rightOpen: boolean;
  setRightOpen: Dispatch<SetStateAction<boolean>>;
  mobilePanel: MobilePanel;
  setMobilePanel: Dispatch<SetStateAction<MobilePanel>>;
  toggleMobilePanel: (panel: "conditions" | "solver") => void;
  t: Translate;
};

export function AppHeader({
  projectTitle,
  setProjectTitle,
  canUndo,
  canRedo,
  undo,
  redo,
  clearDrawing,
  setHelpOpen,
  settingsOpen,
  setSettingsOpen,
  importInputRef,
  handleImportInput,
  rightOpen,
  setRightOpen,
  mobilePanel,
  setMobilePanel,
  toggleMobilePanel,
  t,
}: AppHeaderProps) {
  return (
    <header className="topbar">
      <div className="brand-block">
        <AppMark />
        <span className="brand-name">
          geo<span>solver</span>
        </span>
      </div>
      <div className="project-title">
        <input
          id="project-title"
          name="project-title"
          value={projectTitle}
          maxLength={80}
          autoComplete="off"
          aria-label={t("Название проекта", "Project name")}
          title={t(
            "Название сохраняется автоматически",
            "The name is saved automatically",
          )}
          onChange={(event) => setProjectTitle(event.target.value)}
          onBlur={() =>
            setProjectTitle((current) =>
              current.trim() || DEFAULT_PROJECT_TITLE,
            )
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </div>
      <div className="top-actions">
        <div
          className="history-actions"
          aria-label={t("История действий", "Action history")}
        >
          <button
            className="top-button icon-button"
            onClick={undo}
            disabled={!canUndo}
            title={t("Отменить · Ctrl+Z", "Undo · Ctrl+Z")}
            aria-label={t("Отменить действие", "Undo")}
          >
            <HistoryArrowIcon direction="undo" />
          </button>
          <button
            className="top-button icon-button"
            onClick={redo}
            disabled={!canRedo}
            title={t("Повторить · Ctrl+Y", "Redo · Ctrl+Y")}
            aria-label={t("Повторить действие", "Redo")}
          >
            <HistoryArrowIcon direction="redo" />
          </button>
        </div>
        <button
          className="top-button icon-button clear-button"
          onClick={clearDrawing}
          title={t("Очистить полностью", "Clear completely")}
          aria-label={t("Очистить полностью", "Clear completely")}
        >
          ⌫
        </button>
        <button
          className="top-button help-button"
          onClick={() => setHelpOpen(true)}
          title={t("Открыть справку · F1", "Open help · F1")}
          aria-label={t("Открыть справку", "Open help")}
        >
          <span aria-hidden="true">
            <svg viewBox="0 0 20 20" focusable="false">
              <circle cx="10" cy="10" r="8.25" />
              <path d="M7.8 7.25a2.35 2.35 0 1 1 3.55 2.02C10.4 9.9 10 10.48 10 11.5" />
              <circle className="help-dot" cx="10" cy="14.35" r="0.8" />
            </svg>
          </span>
          <em>{t("Справка", "Help")}</em>
        </button>
        <button
          className={`top-button icon-button settings-button ${
            settingsOpen ? "is-active" : ""
          }`}
          onClick={() => setSettingsOpen((open) => !open)}
          title={t("Настройки", "Settings")}
          aria-label={
            settingsOpen
              ? t("Закрыть настройки", "Close settings")
              : t("Открыть настройки", "Open settings")
          }
          aria-expanded={settingsOpen}
          aria-controls="settings-panel"
        >
          <span aria-hidden="true">⚙</span>
        </button>
        <input
          ref={importInputRef}
          id="project-import"
          name="project-import"
          className="project-import-input"
          type="file"
          accept=".json,application/json"
          onChange={handleImportInput}
        />
        <button
          className={`top-button solver-toggle ${rightOpen ? "is-active" : ""}`}
          onClick={() => setRightOpen((open) => !open)}
        >
          {t("Решение", "Solution")}
          <span>{rightOpen ? "›" : "‹"}</span>
        </button>
      </div>
      <nav
        className="mobile-panel-tabs"
        aria-label={t("Разделы рабочего пространства", "Workspace sections")}
      >
        <button
          className={mobilePanel === "conditions" ? "active" : ""}
          onClick={() => toggleMobilePanel("conditions")}
          aria-pressed={mobilePanel === "conditions"}
          title={t(
            "Развернуть или свернуть условия и цели",
            "Expand or collapse constraints and targets",
          )}
        >
          <span>≡</span>
          {t("Условия", "Conditions")}
        </button>
        <button
          className={mobilePanel === "canvas" ? "active" : ""}
          onClick={() => setMobilePanel("canvas")}
          aria-pressed={mobilePanel === "canvas"}
        >
          <span>◇</span>
          {t("Чертёж", "Drawing")}
        </button>
        <button
          className={mobilePanel === "solver" ? "active" : ""}
          onClick={() => toggleMobilePanel("solver")}
          aria-pressed={mobilePanel === "solver"}
          title={t(
            "Развернуть или свернуть решение",
            "Expand or collapse the solution",
          )}
        >
          <span>✓</span>
          {t("Решение", "Solution")}
        </button>
      </nav>
    </header>
  );
}
