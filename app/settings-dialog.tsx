import type { Locale } from "./i18n";
import { localText } from "./i18n";

type SettingsDialogProps = {
  locale: Locale;
  theme: "light" | "dark";
  showCongruenceMarks: boolean;
  showAngles: boolean;
  showAreaConstraints: boolean;
  showToolHint: boolean;
  solverEpsilonInput: string;
  solverEpsilonValid: boolean;
  solverMaxIterationsInput: string;
  solverMaxIterationsValid: boolean;
  solverTimeLimitMsInput: string;
  solverTimeLimitMsValid: boolean;
  bareAngleUnit: "degrees" | "radians";
  decimalDigits: number;
  onLocaleChange: (locale: Locale) => void;
  onThemeChange: (theme: "light" | "dark") => void;
  onShowCongruenceMarksChange: (value: boolean) => void;
  onShowAnglesChange: (value: boolean) => void;
  onShowAreaConstraintsChange: (value: boolean) => void;
  onShowToolHintChange: (value: boolean) => void;
  onSolverEpsilonInputChange: (value: string) => void;
  onSolverEpsilonInputBlur: () => void;
  onSolverMaxIterationsInputChange: (value: string) => void;
  onSolverMaxIterationsInputBlur: () => void;
  onSolverTimeLimitMsInputChange: (value: string) => void;
  onSolverTimeLimitMsInputBlur: () => void;
  onBareAngleUnitChange: (unit: "degrees" | "radians") => void;
  onDecimalDigitsChange: (digits: number) => void;
  onExport: () => void;
  onImport: () => void;
  onClose: () => void;
};

export function SettingsDialog({
  locale,
  theme,
  showCongruenceMarks,
  showAngles,
  showAreaConstraints,
  showToolHint,
  solverEpsilonInput,
  solverEpsilonValid,
  solverMaxIterationsInput,
  solverMaxIterationsValid,
  solverTimeLimitMsInput,
  solverTimeLimitMsValid,
  bareAngleUnit,
  decimalDigits,
  onLocaleChange,
  onThemeChange,
  onShowCongruenceMarksChange,
  onShowAnglesChange,
  onShowAreaConstraintsChange,
  onShowToolHintChange,
  onSolverEpsilonInputChange,
  onSolverEpsilonInputBlur,
  onSolverMaxIterationsInputChange,
  onSolverMaxIterationsInputBlur,
  onSolverTimeLimitMsInputChange,
  onSolverTimeLimitMsInputBlur,
  onBareAngleUnitChange,
  onDecimalDigitsChange,
  onExport,
  onImport,
  onClose,
}: SettingsDialogProps) {
  const t = (russian: string, english: string) =>
    localText(locale, russian, english);

  return (
    <div className="settings-backdrop" onPointerDown={onClose}>
      <section
        id="settings-panel"
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <div>
            <span className="eyebrow">{t("ПАРАМЕТРЫ", "PREFERENCES")}</span>
            <h2 id="settings-title">{t("Настройки", "Settings")}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Закрыть настройки", "Close settings")}
          >
            ×
          </button>
        </header>

        <div className="settings-scroll">
          <section className="settings-section">
            <h3>{t("Язык", "Language")}</h3>
            <fieldset className="settings-fieldset">
              <legend>{t("Язык интерфейса", "Interface language")}</legend>
              <div className="settings-segmented">
                <button
                  type="button"
                  className={locale === "ru" ? "active" : ""}
                  aria-pressed={locale === "ru"}
                  onClick={() => onLocaleChange("ru")}
                >
                  Русский
                </button>
                <button
                  type="button"
                  className={locale === "en" ? "active" : ""}
                  aria-pressed={locale === "en"}
                  onClick={() => onLocaleChange("en")}
                >
                  English
                </button>
              </div>
            </fieldset>
          </section>

          <section className="settings-section">
            <h3>{t("Отображение", "Appearance")}</h3>
            <fieldset className="settings-fieldset settings-theme-fieldset">
              <legend>{t("Тема интерфейса", "Interface theme")}</legend>
              <div className="settings-segmented">
                <button
                  type="button"
                  className={theme === "light" ? "active" : ""}
                  aria-pressed={theme === "light"}
                  onClick={() => onThemeChange("light")}
                >
                  <span aria-hidden="true">☀</span>
                  {t("Светлая", "Light")}
                </button>
                <button
                  type="button"
                  className={theme === "dark" ? "active" : ""}
                  aria-pressed={theme === "dark"}
                  onClick={() => onThemeChange("dark")}
                >
                  <span aria-hidden="true">☾</span>
                  {t("Тёмная", "Dark")}
                </button>
              </div>
            </fieldset>
            <label
              className="settings-switch-row"
              htmlFor="settings-show-congruence"
            >
              <span>
                <b>{t("Отображать чёрточки", "Show congruence marks")}</b>
                <small>
                  {t("Метки на равных отрезках", "Marks on equal segments")}
                </small>
              </span>
              <span className="settings-switch">
                <input
                  id="settings-show-congruence"
                  name="settings-show-congruence"
                  type="checkbox"
                  checked={showCongruenceMarks}
                  onChange={(event) =>
                    onShowCongruenceMarksChange(event.target.checked)
                  }
                />
                <i aria-hidden="true" />
              </span>
            </label>
            <label
              className="settings-switch-row"
              htmlFor="settings-show-angles"
            >
              <span>
                <b>{t("Отображать углы", "Show angles")}</b>
                <small>
                  {t(
                    "Дуги, прямые углы и подписи на чертеже",
                    "Arcs, right-angle marks and labels on the drawing",
                  )}
                </small>
              </span>
              <span className="settings-switch">
                <input
                  id="settings-show-angles"
                  name="settings-show-angles"
                  type="checkbox"
                  checked={showAngles}
                  onChange={(event) =>
                    onShowAnglesChange(event.target.checked)
                  }
                />
                <i aria-hidden="true" />
              </span>
            </label>
            <label
              className="settings-switch-row"
              htmlFor="settings-show-area-constraints"
            >
              <span>
                <b>
                  {t(
                    "Отображать ограничения площади",
                    "Show area constraints",
                  )}
                </b>
                <small>
                  {t(
                    "Заливка и подписи заданных площадей",
                    "Fills and labels for constrained areas",
                  )}
                </small>
              </span>
              <span className="settings-switch">
                <input
                  id="settings-show-area-constraints"
                  name="settings-show-area-constraints"
                  type="checkbox"
                  checked={showAreaConstraints}
                  onChange={(event) =>
                    onShowAreaConstraintsChange(event.target.checked)
                  }
                />
                <i aria-hidden="true" />
              </span>
            </label>
            <label
              className="settings-switch-row"
              htmlFor="settings-show-tool-hint"
            >
              <span>
                <b>{t("Отображать подсказку инструмента", "Show tool hint")}</b>
                <small>
                  {t(
                    "Название, горячая клавиша и следующий шаг",
                    "Name, shortcut and next step",
                  )}
                </small>
              </span>
              <span className="settings-switch">
                <input
                  id="settings-show-tool-hint"
                  name="settings-show-tool-hint"
                  type="checkbox"
                  checked={showToolHint}
                  onChange={(event) =>
                    onShowToolHintChange(event.target.checked)
                  }
                />
                <i aria-hidden="true" />
              </span>
            </label>
          </section>

          <section className="settings-section">
            <h3>{t("Вычисления", "Calculations")}</h3>
            <div className="settings-field">
              <div>
                <label htmlFor="settings-solver-epsilon">
                  {t("Эпсилон численного поиска", "Numerical search epsilon")}
                </label>
                <small>
                  {t(
                    "Допуск по среднеквадратичной невязке",
                    "Root-mean-square residual tolerance",
                  )}
                </small>
              </div>
              <input
                id="settings-solver-epsilon"
                name="settings-solver-epsilon"
                className={solverEpsilonValid ? "" : "settings-input-invalid"}
                value={solverEpsilonInput}
                inputMode="decimal"
                autoComplete="off"
                aria-invalid={!solverEpsilonValid}
                onChange={(event) =>
                  onSolverEpsilonInputChange(event.target.value)
                }
                onBlur={onSolverEpsilonInputBlur}
              />
            </div>

            <div className="settings-field">
              <div>
                <label htmlFor="settings-solver-iterations">
                  {t("Максимум итераций", "Maximum iterations")}
                </label>
                <small>
                  {t(
                    "Общий предел для всех стартовых приближений",
                    "Total limit across all starting approximations",
                  )}
                </small>
              </div>
              <input
                id="settings-solver-iterations"
                name="settings-solver-iterations"
                className={
                  solverMaxIterationsValid ? "" : "settings-input-invalid"
                }
                value={solverMaxIterationsInput}
                inputMode="numeric"
                autoComplete="off"
                aria-invalid={!solverMaxIterationsValid}
                onChange={(event) =>
                  onSolverMaxIterationsInputChange(event.target.value)
                }
                onBlur={onSolverMaxIterationsInputBlur}
              />
            </div>

            <div className="settings-field">
              <div>
                <label htmlFor="settings-solver-time-limit">
                  {t("Лимит времени, мс", "Time limit, ms")}
                </label>
                <small>
                  {t(
                    "Поиск вернёт лучшее найденное решение по истечении лимита",
                    "The search returns its best result when the limit expires",
                  )}
                </small>
              </div>
              <input
                id="settings-solver-time-limit"
                name="settings-solver-time-limit"
                className={
                  solverTimeLimitMsValid ? "" : "settings-input-invalid"
                }
                value={solverTimeLimitMsInput}
                inputMode="numeric"
                autoComplete="off"
                aria-invalid={!solverTimeLimitMsValid}
                onChange={(event) =>
                  onSolverTimeLimitMsInputChange(event.target.value)
                }
                onBlur={onSolverTimeLimitMsInputBlur}
              />
            </div>

            <fieldset className="settings-fieldset">
              <legend>
                {t("Числа без", "Treat numbers without")} <code>°</code>{" "}
                {t("считать как", "as")}
              </legend>
              <div className="settings-segmented">
                <button
                  type="button"
                  className={bareAngleUnit === "degrees" ? "active" : ""}
                  aria-pressed={bareAngleUnit === "degrees"}
                  onClick={() => onBareAngleUnitChange("degrees")}
                >
                  {t("Градусы", "Degrees")}
                </button>
                <button
                  type="button"
                  className={bareAngleUnit === "radians" ? "active" : ""}
                  aria-pressed={bareAngleUnit === "radians"}
                  onClick={() => onBareAngleUnitChange("radians")}
                >
                  {t("Радианы", "Radians")}
                </button>
              </div>
            </fieldset>

            <div className="settings-field">
              <div>
                <label htmlFor="settings-decimal-digits">
                  {t("Знаков после запятой", "Decimal places")}
                </label>
                <small>
                  {t(
                    "Максимум в результатах и измерениях",
                    "Maximum in results and measurements",
                  )}
                </small>
              </div>
              <select
                id="settings-decimal-digits"
                name="settings-decimal-digits"
                value={decimalDigits}
                onChange={(event) =>
                  onDecimalDigitsChange(Number(event.target.value))
                }
              >
                {Array.from({ length: 9 }, (_, digits) => (
                  <option key={digits} value={digits}>
                    {digits}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="settings-section">
            <h3>{t("Проект", "Project")}</h3>
            <div className="settings-file-actions">
              <button type="button" onClick={onExport}>
                <span aria-hidden="true">↑</span>
                {t("Экспорт", "Export")}
              </button>
              <button type="button" onClick={onImport}>
                <span aria-hidden="true">↓</span>
                {t("Импорт", "Import")}
              </button>
            </div>
            <p>
              {t(
                "JSON-файл также можно перетащить прямо на окно.",
                "You can also drag and drop a JSON file onto the window.",
              )}
            </p>
          </section>
        </div>
      </section>
    </div>
  );
}
