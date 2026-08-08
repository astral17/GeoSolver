"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { HelpDialog } from "./help-dialog";
import type {
  AngleUnit,
  CanvasDrag,
  CanvasView,
  DrawingSnapshot,
  EditorGroup,
  ExpressionRow,
  GeometryKind,
  HistoryState,
  ImportedProject,
  Measurement,
  ParsedConstraint,
  Point,
  Shape,
  SolverMode,
  SolveResult,
} from "./domain";
import {
  loadProjectExample as importProjectExampleJson,
  type ProjectExample,
} from "./examples";
import type { Locale } from "./i18n";
import { localText } from "./i18n";
import {
  parseConstraint,
  trimNumber,
} from "./expressions";
import { useSolverWorker } from "./use-solver-worker";
import {
  angleDegrees,
  distance,
  geometryMetric,
  pointMap,
} from "./geometry";
import { ToolGlyph } from "./interface-icons";
import { SettingsDialog } from "./settings-dialog";
import { ConditionsPanel } from "./conditions-panel";
import { ToolRail } from "./tool-rail";
import { useCanvasRenderer } from "./canvas-renderer";
import { useCanvasInteractions } from "./canvas-interactions";
import { useCanvasHitTesting } from "./canvas-hit-testing";
import { AppHeader } from "./app-header";
import { buildEqualSideMarks } from "./congruence-marks";
import {
  CURRENT_PROJECT_FORMAT_VERSION,
  migrateProjectData,
} from "./project-migrations";
import { useObjectEditing } from "./object-editing";
import { SolverPanel } from "./solver-panel";
import { expandSymbolCommands } from "./symbol-input";
import { useExpressionReordering } from "./expression-reordering";
import {
  cloneSnapshot,
  COLORS,
  DEFAULT_DECIMAL_DIGITS,
  DEFAULT_PROJECT_TITLE,
  DEFAULT_SOLVER_EPSILON_INPUT,
  DEFAULT_SOLVER_MAX_ITERATIONS,
  DEFAULT_SOLVER_MAX_ITERATIONS_INPUT,
  DEFAULT_SOLVER_MODE,
  DEFAULT_SOLVER_TIME_LIMIT_MS,
  DEFAULT_SOLVER_TIME_LIMIT_MS_INPUT,
  EMPTY_PROJECT_TITLE,
  INITIAL_KNOWN,
  INITIAL_GROUPS,
  INITIAL_MEASUREMENTS,
  INITIAL_POINTS,
  INITIAL_SHAPES,
  INITIAL_UNKNOWN,
  MAX_IMPORT_FILE_SIZE,
  parseImportedProject,
  parseSolverEpsilon,
  parseSolverLimit,
  PENDING_RESULT,
  SETTINGS_STORAGE_KEY,
  snapshotKey,
} from "./project-state";
import {
  TOOL_GROUPS,
  TOOL_RAIL_ITEMS,
  TOOLS,
  type ToolGroupId,
  type ToolId,
  localizeToolGroups,
  localizeTools,
} from "./tools";

const MIN_VIEW_SCALE = 0.1;
const MAX_VIEW_SCALE = 100_000;
const MOBILE_WORKSPACE_QUERY =
  "(max-width: 680px), (max-width: 1000px) and (max-height: 650px) and (orientation: landscape)";
export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const importDragDepthRef = useRef(0);
  const toolGroupCloseTimerRef = useRef<number | null>(null);
  const activeCanvasPointersRef = useRef(
    new Map<number, { x: number; y: number }>(),
  );
  const pinchGestureRef = useRef<{
    distance: number;
    center: { x: number; y: number };
    view: CanvasView;
  } | null>(null);
  const touchGestureStartRef = useRef<{
    snapshot: DrawingSnapshot;
    view: CanvasView;
    selectedPoint: string | null;
    selectedPoints: string[];
    pendingPoints: string[];
    result: SolveResult;
  } | null>(null);
  const [projectTitle, setProjectTitle] = useState(DEFAULT_PROJECT_TITLE);
  const [points, setPoints] = useState<Point[]>(INITIAL_POINTS);
  const [shapes, setShapes] = useState<Shape[]>(INITIAL_SHAPES);
  const [measurements, setMeasurements] = useState<Measurement[]>(INITIAL_MEASUREMENTS);
  const [known, setKnown] = useState<ExpressionRow[]>(INITIAL_KNOWN);
  const [unknown, setUnknown] = useState<ExpressionRow[]>(INITIAL_UNKNOWN);
  const [groups, setGroups] = useState<EditorGroup[]>(INITIAL_GROUPS);
  const [activeTool, setActiveTool] = useState<ToolId>("select");
  const [openToolGroup, setOpenToolGroup] = useState<ToolGroupId | null>(null);
  const [toolGroupIndex, setToolGroupIndex] = useState(0);
  const [pendingPoints, setPendingPoints] = useState<string[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null);
  const [selectedPoints, setSelectedPoints] = useState<string[]>([]);
  const [renameValue, setRenameValue] = useState("");
  const [drag, setDrag] = useState<CanvasDrag>(null);
  const [view, setView] = useState({ x: 35, y: 34, scale: 74 });
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 700 });
  const [result, setResult] = useState<SolveResult>(PENDING_RESULT);
  const [solverEpsilonInput, setSolverEpsilonInput] = useState(
    DEFAULT_SOLVER_EPSILON_INPUT,
  );
  const [solverMaxIterationsInput, setSolverMaxIterationsInput] = useState(
    DEFAULT_SOLVER_MAX_ITERATIONS_INPUT,
  );
  const [solverTimeLimitMsInput, setSolverTimeLimitMsInput] = useState(
    DEFAULT_SOLVER_TIME_LIMIT_MS_INPUT,
  );
  const [solverMode, setSolverMode] = useState<SolverMode>(
    DEFAULT_SOLVER_MODE,
  );
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [mobilePanel, setMobilePanel] = useState<
    "canvas" | "conditions" | "solver"
  >("canvas");
  const [locale, setLocale] = useState<Locale>("ru");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [themeHydrated, setThemeHydrated] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showCongruenceMarks, setShowCongruenceMarks] = useState(true);
  const [showAngles, setShowAngles] = useState(true);
  const [showAreaConstraints, setShowAreaConstraints] = useState(true);
  const [showToolHint, setShowToolHint] = useState(true);
  const [bareAngleUnit, setBareAngleUnit] = useState<AngleUnit>("degrees");
  const [decimalDigits, setDecimalDigits] = useState(DEFAULT_DECIMAL_DIGITS);
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [importDragActive, setImportDragActive] = useState(false);
  const [addMenu, setAddMenu] = useState<"known" | "unknown" | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [canvasNotice, setCanvasNotice] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const historyTimerRef = useRef<number | null>(null);
  const historyReadyRef = useRef(false);
  const storageKeyRef = useRef<string | null>(null);
  const expressionIdRef = useRef(0);
  const historyRef = useRef<HistoryState>({
    past: [],
    present: cloneSnapshot({
      points: INITIAL_POINTS,
      shapes: INITIAL_SHAPES,
      measurements: INITIAL_MEASUREMENTS,
      known: INITIAL_KNOWN,
      unknown: INITIAL_UNKNOWN,
      groups: INITIAL_GROUPS,
    }),
    future: [],
  });

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const parsedKnown = useMemo(
    () =>
      known
        .filter((row) => row.enabled)
        .map((row) => ({
          ...row,
          parsed: parseConstraint(row.expression, bareAngleUnit),
        })),
    [bareAngleUnit, known],
  );
  const objectMemberships = useMemo(
    () =>
      parsedKnown
        .map((row) => row.parsed)
        .filter(
          (constraint): constraint is ParsedConstraint =>
            constraint?.kind === "onSegment" ||
            constraint?.kind === "onLine" ||
            constraint?.kind === "onRay" ||
            constraint?.kind === "onCircle" ||
            constraint?.kind === "onArc" ||
            constraint?.kind === "onEllipse",
        ),
    [parsedKnown],
  );
  const equalSideMarks = useMemo(
    () => buildEqualSideMarks(parsedKnown, shapes),
    [parsedKnown, shapes],
  );

  const tools = useMemo(() => localizeTools(TOOLS, locale), [locale]);
  const toolGroups = useMemo(
    () => localizeToolGroups(TOOL_GROUPS, locale),
    [locale],
  );
  const activeToolInfo =
    tools.find((tool) => tool.id === activeTool) ?? tools[0];
  const t = useCallback(
    (russian: string, english: string) =>
      localText(locale, russian, english),
    [locale],
  );
  const solverEpsilon = useMemo(
    () => parseSolverEpsilon(solverEpsilonInput),
    [solverEpsilonInput],
  );
  const solverEpsilonValid = useMemo(() => {
    const parsed = Number(solverEpsilonInput.trim().replace(",", "."));
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 1;
  }, [solverEpsilonInput]);
  const solverMaxIterations = useMemo(
    () =>
      parseSolverLimit(
        solverMaxIterationsInput,
        DEFAULT_SOLVER_MAX_ITERATIONS,
        1,
        100_000,
      ),
    [solverMaxIterationsInput],
  );
  const solverMaxIterationsValid = useMemo(
    () =>
      Number(solverMaxIterationsInput) === solverMaxIterations &&
      Number.isInteger(Number(solverMaxIterationsInput)),
    [solverMaxIterations, solverMaxIterationsInput],
  );
  const solverTimeLimitMs = useMemo(
    () =>
      parseSolverLimit(
        solverTimeLimitMsInput,
        DEFAULT_SOLVER_TIME_LIMIT_MS,
        50,
        60_000,
      ),
    [solverTimeLimitMsInput],
  );
  const solverTimeLimitMsValid = useMemo(
    () =>
      Number(solverTimeLimitMsInput) === solverTimeLimitMs &&
      Number.isInteger(Number(solverTimeLimitMsInput)),
    [solverTimeLimitMs, solverTimeLimitMsInput],
  );
  const formatNumber = useCallback(
    (value: number) => trimNumber(value, decimalDigits),
    [decimalDigits],
  );
  const selectedPointData =
    points.find((point) => point.id === selectedPoint) ?? null;
  const measurementReadings = useMemo(() => {
    const map = pointMap(points);
    return measurements.map((measurement) => {
      const measuredShape = measurement.shapeId
        ? shapes.find((shape) => shape.id === measurement.shapeId)
        : null;
      const measuredPoints = measurement.points
        .map((id) => map.get(id))
        .filter((point): point is Point => Boolean(point));
      const geometry =
        measuredShape &&
        (
          [
            "polygon",
            "circle",
            "ellipse",
            "sector",
            "circularSegment",
          ] as Shape["type"][]
        ).includes(measuredShape.type)
          ? (measuredShape.type as GeometryKind)
          : "polygon";
      const value =
        measurement.kind === "distance" && measuredPoints.length === 2
          ? formatNumber(distance(measuredPoints[0], measuredPoints[1]))
          : measurement.kind === "angle" && measuredPoints.length === 3
            ? `${formatNumber(
                angleDegrees(
                  measuredPoints[0],
                  measuredPoints[1],
                  measuredPoints[2],
                ),
              )}°`
            : measurement.kind === "area" &&
                (geometry !== "polygon" || measuredPoints.length >= 3)
              ? `${formatNumber(
                  geometryMetric(
                    "area",
                    geometry,
                    measuredPoints,
                    measuredShape?.arc,
                  ),
                )} ${t("ед²", "units²")}`
            : "—";
      const geometryName =
        geometry === "circularSegment" ? "segment" : geometry;
      return {
        ...measurement,
        label:
          measurement.kind === "distance"
            ? measurement.points.join("")
            : measurement.kind === "angle"
              ? `∠${measurement.points.join("")}`
              : geometry === "polygon"
                ? `S(${measurement.points.join("")})`
                : `S(${geometryName}(${measurement.points.join("")}))`,
        value,
      };
    });
  }, [formatNumber, measurements, points, shapes, t]);

  const captureSnapshot = useCallback(
    () =>
      cloneSnapshot({ points, shapes, measurements, known, unknown, groups }),
    [groups, known, measurements, points, shapes, unknown],
  );

  const markDirty = useCallback(() => {
    setResult((current) =>
      current.kind === "dirty" ? current : PENDING_RESULT,
    );
  }, []);

  const {
    draggedExpression,
    expressionDragHandleProps,
    moveExpressionRow,
    focusAdjacentExpression,
  } = useExpressionReordering({
    known,
    unknown,
    groups,
    setGroups,
    setKnown,
    setUnknown,
    markDirty,
  });

  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        {
          setTheme(
            document.documentElement.dataset.theme === "dark"
              ? "dark"
              : "light",
          );
          setThemeHydrated(true);
        },
      0,
    );
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.theme === "light" || parsed.theme === "dark") {
            setTheme(parsed.theme);
          }
          if (parsed.locale === "ru" || parsed.locale === "en") {
            setLocale(parsed.locale);
          }
          if (typeof parsed.showCongruenceMarks === "boolean") {
            setShowCongruenceMarks(parsed.showCongruenceMarks);
          }
          if (typeof parsed.showAngles === "boolean") {
            setShowAngles(parsed.showAngles);
          }
          if (typeof parsed.showAreaConstraints === "boolean") {
            setShowAreaConstraints(parsed.showAreaConstraints);
          }
          if (typeof parsed.showToolHint === "boolean") {
            setShowToolHint(parsed.showToolHint);
          }
          if (
            parsed.bareAngleUnit === "degrees" ||
            parsed.bareAngleUnit === "radians"
          ) {
            setBareAngleUnit(parsed.bareAngleUnit);
          }
          if (
            Number.isInteger(parsed.decimalDigits) &&
            parsed.decimalDigits >= 0 &&
            parsed.decimalDigits <= 8
          ) {
            setDecimalDigits(parsed.decimalDigits);
          }
        }
      } catch {
        // Invalid or unavailable browser storage should not block the editor.
      } finally {
        setSettingsHydrated(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!settingsHydrated) return;
    try {
      localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify({
          theme,
          locale,
          showCongruenceMarks,
          showAngles,
          showAreaConstraints,
          showToolHint,
          bareAngleUnit,
          decimalDigits,
        }),
      );
    } catch {
      // Settings still work for the current page without browser storage.
    }
  }, [
    bareAngleUnit,
    decimalDigits,
    locale,
    settingsHydrated,
    showAngles,
    showAreaConstraints,
    showCongruenceMarks,
    showToolHint,
    theme,
  ]);

  useEffect(() => {
    if (!themeHydrated) return;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme, themeHydrated]);

  const selectTheme = (nextTheme: "light" | "dark") => {
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    try {
      localStorage.setItem("geosolver-theme", nextTheme);
    } catch {
      // The theme still works for the current page without browser storage.
    }
  };

  useEffect(() => {
    let disposed = false;
    let timer: number | null = null;
    let channel: BroadcastChannel | null = null;
    let occupied = false;
    const makeId = () =>
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const instanceId = makeId();
    let workspaceId =
      sessionStorage.getItem("geosolver-workspace-v2") ?? makeId();

    const loadWorkspace = () => {
      if (disposed) return;
      if (occupied) workspaceId = makeId();

      let loaded = cloneSnapshot({
        points: INITIAL_POINTS,
        shapes: INITIAL_SHAPES,
        measurements: INITIAL_MEASUREMENTS,
        known: INITIAL_KNOWN,
        unknown: INITIAL_UNKNOWN,
        groups: INITIAL_GROUPS,
      });
      let loadedProjectTitle = DEFAULT_PROJECT_TITLE;
      let loadedSolverEpsilon = DEFAULT_SOLVER_EPSILON_INPUT;
      let loadedSolverMaxIterations =
        DEFAULT_SOLVER_MAX_ITERATIONS_INPUT;
      let loadedSolverTimeLimitMs =
        DEFAULT_SOLVER_TIME_LIMIT_MS_INPUT;
      let loadedSolverMode = DEFAULT_SOLVER_MODE;

      try {
        sessionStorage.setItem("geosolver-workspace-v2", workspaceId);
        const storageKey = `geosolver-drawing-v2:${workspaceId}`;
        storageKeyRef.current = storageKey;
        let saved = localStorage.getItem(storageKey);

        // Migrate the old shared draft once. Every later tab starts independently.
        if (
          !saved &&
          localStorage.getItem("geosolver-storage-migrated-v2") !== "1"
        ) {
          saved = localStorage.getItem("geosolver-drawing-v1");
          localStorage.setItem("geosolver-storage-migrated-v2", "1");
        }

        if (saved) {
          const data = migrateProjectData(JSON.parse(saved));
          loaded = {
            points: Array.isArray(data.points) ? data.points : loaded.points,
            shapes: Array.isArray(data.shapes) ? data.shapes : loaded.shapes,
            measurements: Array.isArray(data.measurements)
              ? data.measurements
              : loaded.measurements,
            known: Array.isArray(data.known)
              ? (data.known as ExpressionRow[])
              : loaded.known,
            unknown: Array.isArray(data.unknown)
              ? (data.unknown as ExpressionRow[])
              : loaded.unknown,
            groups: Array.isArray(data.groups)
              ? data.groups
              : loaded.groups,
          };
          if (typeof data.projectTitle === "string" && data.projectTitle.trim()) {
            loadedProjectTitle = data.projectTitle.trim().slice(0, 80);
          }
          if (
            (typeof data.solverEpsilon === "string" ||
              typeof data.solverEpsilon === "number") &&
            parseSolverEpsilon(data.solverEpsilon) ===
              Number(String(data.solverEpsilon).replace(",", "."))
          ) {
            loadedSolverEpsilon = String(data.solverEpsilon);
          }
          if (
            typeof data.solverMaxIterations === "string" ||
            typeof data.solverMaxIterations === "number"
          ) {
            loadedSolverMaxIterations = String(
              parseSolverLimit(
                data.solverMaxIterations,
                DEFAULT_SOLVER_MAX_ITERATIONS,
                1,
                100_000,
              ),
            );
          }
          if (
            typeof data.solverTimeLimitMs === "string" ||
            typeof data.solverTimeLimitMs === "number"
          ) {
            loadedSolverTimeLimitMs = String(
              parseSolverLimit(
                data.solverTimeLimitMs,
                DEFAULT_SOLVER_TIME_LIMIT_MS,
                50,
                60_000,
              ),
            );
          }
          loadedSolverMode =
            data.solverMode === "analytic" ? "analytic" : "numerical";
        }
      } catch {
        // A damaged or unavailable local draft should never block the app.
      }

      setPoints(loaded.points);
      setShapes(loaded.shapes);
      setMeasurements(loaded.measurements);
      setKnown(loaded.known);
      setUnknown(loaded.unknown);
      setGroups(loaded.groups);
      setProjectTitle(loadedProjectTitle);
      setSolverEpsilonInput(loadedSolverEpsilon);
      setSolverMaxIterationsInput(loadedSolverMaxIterations);
      setSolverTimeLimitMsInput(loadedSolverTimeLimitMs);
      setSolverMode(loadedSolverMode);
      setResult(PENDING_RESULT);
      historyRef.current = {
        past: [],
        present: cloneSnapshot(loaded),
        future: [],
      };
      historyReadyRef.current = true;
      setHydrated(true);
    };

    if ("BroadcastChannel" in window) {
      channel = new BroadcastChannel("geosolver-tabs-v2");
      channel.onmessage = (event) => {
        const message = event.data;
        if (
          message?.type === "probe" &&
          message.workspaceId === workspaceId &&
          message.instanceId !== instanceId
        ) {
          channel?.postMessage({
            type: "occupied",
            workspaceId,
            targetInstanceId: message.instanceId,
          });
        }
        if (
          message?.type === "occupied" &&
          message.workspaceId === workspaceId &&
          message.targetInstanceId === instanceId
        ) {
          occupied = true;
        }
      };
      channel.postMessage({ type: "probe", workspaceId, instanceId });
      timer = window.setTimeout(loadWorkspace, 80);
    } else {
      loadWorkspace();
    }

    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
      channel?.close();
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !historyReadyRef.current) return;
    const current = captureSnapshot();
    if (snapshotKey(current) === snapshotKey(historyRef.current.present)) return;
    if (historyTimerRef.current !== null) {
      window.clearTimeout(historyTimerRef.current);
    }
    setHistoryVersion((version) => version + 1);
    historyTimerRef.current = window.setTimeout(() => {
      const history = historyRef.current;
      const latest = captureSnapshot();
      if (snapshotKey(latest) === snapshotKey(history.present)) return;
      history.past.push(cloneSnapshot(history.present));
      if (history.past.length > 80) history.past.shift();
      history.present = cloneSnapshot(latest);
      history.future = [];
      historyTimerRef.current = null;
      setHistoryVersion((version) => version + 1);
    }, 220);
    return () => {
      if (historyTimerRef.current !== null) {
        window.clearTimeout(historyTimerRef.current);
        historyTimerRef.current = null;
      }
    };
  }, [captureSnapshot, hydrated]);

  useEffect(() => {
    if (!hydrated || !storageKeyRef.current) return;
    try {
      localStorage.setItem(
        storageKeyRef.current,
        JSON.stringify({
          version: CURRENT_PROJECT_FORMAT_VERSION,
          points,
          shapes,
          measurements,
          known,
          unknown,
          groups,
          projectTitle,
          solverEpsilon: solverEpsilonInput,
          solverMaxIterations: solverMaxIterationsInput,
          solverTimeLimitMs: solverTimeLimitMsInput,
          solverMode,
        }),
      );
    } catch {
      // The editor remains usable if browser storage is unavailable.
    }
  }, [
    hydrated,
    groups,
    known,
    measurements,
    points,
    projectTitle,
    shapes,
    solverEpsilonInput,
    solverMaxIterationsInput,
    solverMode,
    solverTimeLimitMsInput,
    unknown,
  ]);

  const applySnapshot = useCallback((snapshot: DrawingSnapshot) => {
    const next = cloneSnapshot(snapshot);
    setPoints(next.points);
    setShapes(next.shapes);
    setMeasurements(next.measurements);
    setKnown(next.known);
    setUnknown(next.unknown);
    setGroups(next.groups);
    setSelectedPoint(null);
    setSelectedPoints([]);
    setPendingPoints([]);
    setResult(PENDING_RESULT);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setRenameValue(selectedPoint ?? ""),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [selectedPoint]);

  const undo = useCallback(() => {
    if (!historyReadyRef.current) return;
    if (historyTimerRef.current !== null) {
      window.clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    }
    const history = historyRef.current;
    const current = captureSnapshot();
    if (snapshotKey(current) !== snapshotKey(history.present)) {
      history.past.push(cloneSnapshot(history.present));
      history.present = cloneSnapshot(current);
      history.future = [];
    }
    const previous = history.past.pop();
    if (!previous) return;
    history.future.push(cloneSnapshot(history.present));
    history.present = cloneSnapshot(previous);
    applySnapshot(previous);
    setHistoryVersion((version) => version + 1);
  }, [applySnapshot, captureSnapshot]);

  const redo = useCallback(() => {
    if (!historyReadyRef.current) return;
    if (historyTimerRef.current !== null) {
      window.clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    }
    const history = historyRef.current;
    const current = captureSnapshot();
    if (snapshotKey(current) !== snapshotKey(history.present)) {
      history.past.push(cloneSnapshot(history.present));
      history.present = cloneSnapshot(current);
      history.future = [];
      setHistoryVersion((version) => version + 1);
      return;
    }
    const next = history.future.pop();
    if (!next) return;
    history.past.push(cloneSnapshot(history.present));
    history.present = cloneSnapshot(next);
    applySnapshot(next);
    setHistoryVersion((version) => version + 1);
  }, [applySnapshot, captureSnapshot]);

  void historyVersion;
  /* eslint-disable react-hooks/refs -- History is intentionally stored outside
     React state; historyVersion invalidates these read-only availability flags. */
  const canUndo =
    historyRef.current.past.length > 0 ||
    snapshotKey(captureSnapshot()) !== snapshotKey(historyRef.current.present);
  const canRedo = historyRef.current.future.length > 0;
  /* eslint-enable react-hooks/refs */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(320, entry.contentRect.width);
      const height = Math.max(320, entry.contentRect.height);
      setCanvasSize({ width, height });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const worldToScreen = useCallback(
    (point: Point) => ({
      x: canvasSize.width / 2 + view.x + point.x * view.scale,
      y: canvasSize.height / 2 + view.y - point.y * view.scale,
    }),
    [canvasSize, view],
  );

  const screenToWorld = useCallback(
    (x: number, y: number) => ({
      x: (x - canvasSize.width / 2 - view.x) / view.scale,
      y: -(y - canvasSize.height / 2 - view.y) / view.scale,
    }),
    [canvasSize, view],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleCanvasWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const position = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      setView((current) => {
        const world = {
          x:
            (position.x - canvasSize.width / 2 - current.x) /
            current.scale,
          y:
            -(position.y - canvasSize.height / 2 - current.y) /
            current.scale,
        };
        const nextScale = Math.max(
          MIN_VIEW_SCALE,
          Math.min(
            MAX_VIEW_SCALE,
            current.scale * Math.exp(-event.deltaY * 0.001),
          ),
        );
        return {
          x: position.x - canvasSize.width / 2 - world.x * nextScale,
          y: position.y - canvasSize.height / 2 + world.y * nextScale,
          scale: nextScale,
        };
      });
    };
    canvas.addEventListener("wheel", handleCanvasWheel, {
      passive: false,
    });
    return () => canvas.removeEventListener("wheel", handleCanvasWheel);
  }, [canvasSize]);

  const {
    findPointAt,
    findPointsAt,
    findObjectAt,
    findIntersectionObjectsAt,
  } = useCanvasHitTesting({
    angleUnit: bareAngleUnit,
    parsedKnown,
    points,
    shapes,
    screenToWorld,
    worldToScreen,
  });

  useCanvasRenderer({
    activeTool,
    angleUnit: bareAngleUnit,
    canvasRef,
    canvasSize,
    drag,
    equalSideMarks,
    formatNumber,
    measurements,
    parsedKnown,
    pendingPoints,
    points,
    result,
    selectedPoint,
    selectedPoints,
    shapes,
    showAngles,
    showAreaConstraints,
    showCongruenceMarks,
    theme,
    unknown,
    view,
    worldToScreen,
  });

  const addFocusedKnownFromCanvas = useCallback(
    (expression: string) => {
      expressionIdRef.current = Math.max(
        expressionIdRef.current + 1,
        Date.now(),
      );
      const id = expressionIdRef.current;
      setKnown((current) => [
        ...current,
        {
          id,
          expression,
          enabled: true,
          color: COLORS[current.length % COLORS.length],
        },
      ]);
      setLeftOpen(true);
      setMobilePanel("conditions");
      markDirty();
      window.requestAnimationFrame(() => {
        window.dispatchEvent(
          new CustomEvent("geosolver:focus-expression", {
            detail: { group: "known", id },
          }),
        );
      });
    },
    [markDirty],
  );

  const {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    resetPendingIntersection,
  } = useCanvasInteractions({
    canvasSize,
    activeTool,
    drag,
    points,
    shapes,
    measurements,
    known,
    unknown,
    groups,
    view,
    selectedPoint,
    selectedPoints,
    pendingPoints,
    result,
    objectMemberships,
    setPoints,
    setShapes,
    setMeasurements,
    setKnown,
    setUnknown,
    setView,
    setSelectedPoint,
    setSelectedPoints,
    setPendingPoints,
    setResult,
    setDrag,
    setCanvasNotice,
    activeCanvasPointersRef,
    pinchGestureRef,
    touchGestureStartRef,
    historyTimerRef,
    findPointAt,
    findPointsAt,
    findObjectAt,
    findIntersectionObjectsAt,
    screenToWorld,
    worldToScreen,
    markDirty,
    onAddFocusedKnown: addFocusedKnownFromCanvas,
    t,
    minViewScale: MIN_VIEW_SCALE,
    maxViewScale: MAX_VIEW_SCALE,
  });

  const chooseTool = useCallback((tool: ToolId) => {
    if (toolGroupCloseTimerRef.current !== null) {
      window.clearTimeout(toolGroupCloseTimerRef.current);
      toolGroupCloseTimerRef.current = null;
    }
    resetPendingIntersection();
    setActiveTool(tool);
    setPendingPoints([]);
    setAddMenu(null);
    setOpenToolGroup(null);
  }, [resetPendingIntersection]);

  const openToolGroupMenu = useCallback(
    (groupId: ToolGroupId) => {
      if (toolGroupCloseTimerRef.current !== null) {
        window.clearTimeout(toolGroupCloseTimerRef.current);
        toolGroupCloseTimerRef.current = null;
      }
      const group = toolGroups.find((item) => item.id === groupId);
      if (!group) return;
      const activeIndex = group.toolIds.indexOf(activeTool);
      setToolGroupIndex(activeIndex >= 0 ? activeIndex : 0);
      setOpenToolGroup(groupId);
    },
    [activeTool, toolGroups],
  );

  const scheduleToolGroupClose = useCallback(() => {
    if (toolGroupCloseTimerRef.current !== null) {
      window.clearTimeout(toolGroupCloseTimerRef.current);
    }
    toolGroupCloseTimerRef.current = window.setTimeout(() => {
      setOpenToolGroup(null);
      toolGroupCloseTimerRef.current = null;
    }, 260);
  }, []);

  useEffect(
    () => () => {
      if (toolGroupCloseTimerRef.current !== null) {
        window.clearTimeout(toolGroupCloseTimerRef.current);
      }
    },
    [],
  );

  const toggleToolGroupMenu = (groupId: ToolGroupId) => {
    if (
      window.matchMedia(MOBILE_WORKSPACE_QUERY).matches &&
      openToolGroup === groupId
    ) {
      setOpenToolGroup(null);
      return;
    }
    openToolGroupMenu(groupId);
  };

  const deleteSelected = useCallback(() => {
    const ids = selectedPoints.length
      ? selectedPoints
      : selectedPoint
        ? [selectedPoint]
        : [];
    if (!ids.length) return;
    const selected = new Set(ids);
    setPoints((current) =>
      current.filter((point) => !selected.has(point.id)),
    );
    setShapes((current) =>
      current.filter(
        (shape) => !shape.points.some((id) => selected.has(id)),
      ),
    );
    setMeasurements((current) =>
      current.filter(
        (measurement) =>
          !measurement.points.some((id) => selected.has(id)),
      ),
    );
    setSelectedPoint(null);
    setSelectedPoints([]);
    markDirty();
  }, [markDirty, selectedPoint, selectedPoints]);

  const {
    renamePoint,
    updatePointObject,
    updateShapeObject,
    addPointObject,
    addShapeObject,
    deletePointObject,
    deleteShapeObject,
    movePointObject,
    moveShapeObject,
    reorderPointObject,
    reorderShapeObject,
    reorderMixedObjects,
    moveMixedObject,
  } = useObjectEditing({
    points,
    shapes,
    groups,
    selectedPoint,
    setPoints,
    setShapes,
    setMeasurements,
    setKnown,
    setUnknown,
    setSelectedPoint,
    setSelectedPoints,
    setPendingPoints,
    setRenameValue,
    setCanvasNotice,
    markDirty,
    t,
  });

  const commitRename = useCallback(() => {
    if (selectedPoint) renamePoint(selectedPoint, renameValue);
  }, [renamePoint, renameValue, selectedPoint]);

  const selectPointCollection = (ids: string[]) => {
    const existing = new Set(points.map((point) => point.id));
    const selected = [...new Set(ids)].filter((id) => existing.has(id));
    setSelectedPoints(selected);
    setSelectedPoint(selected.length === 1 ? selected[0] : null);
    setRenameValue(selected.length === 1 ? selected[0] : "");
    setPendingPoints([]);
    setActiveTool("select");
    setMobilePanel("canvas");
  };

  const { runSolver, solving, solverProgress } = useSolverWorker({
    points,
    shapes,
    known,
    unknown,
    mode: solverMode,
    angleUnit: bareAngleUnit,
    tolerance: solverEpsilon,
    maxIterations: solverMaxIterations,
    timeLimitMs: solverTimeLimitMs,
    setPoints,
    setResult,
    setCanvasNotice,
    setRightOpen,
    translate: t,
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (helpOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          setHelpOpen(false);
        }
        return;
      }
      if (settingsOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          setSettingsOpen(false);
        }
        return;
      }
      const commandKey = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const undoKey = event.code === "KeyZ" || key === "z";
      const redoKey = event.code === "KeyY" || key === "y";
      if (commandKey && undoKey) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (commandKey && redoKey) {
        event.preventDefault();
        redo();
        return;
      }
      if (event.key === "F1") {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) return;
      if (event.shiftKey && event.code === "Slash") {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }
      const openedGroup = openToolGroup
        ? toolGroups.find((group) => group.id === openToolGroup)
        : null;
      if (openedGroup) {
        if (event.key === "Escape") {
          event.preventDefault();
          resetPendingIntersection();
          setPendingPoints([]);
          setOpenToolGroup(null);
          return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowRight") {
          event.preventDefault();
          setToolGroupIndex(
            (toolGroupIndex + 1) % openedGroup.toolIds.length,
          );
          return;
        }
        if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
          event.preventDefault();
          setToolGroupIndex(
            (toolGroupIndex - 1 + openedGroup.toolIds.length) %
              openedGroup.toolIds.length,
          );
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          chooseTool(openedGroup.toolIds[toolGroupIndex]);
          return;
        }
        const digit = /^Digit([1-9])$/.exec(event.code);
        if (digit) {
          const index = Number(digit[1]) - 1;
          if (openedGroup.toolIds[index]) {
            event.preventDefault();
            chooseTool(openedGroup.toolIds[index]);
            return;
          }
        }
      }
      if (event.key === "Escape") {
        resetPendingIntersection();
        setPendingPoints([]);
        setSelectedPoint(null);
        setSelectedPoints([]);
        setActiveTool("select");
        setOpenToolGroup(null);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        deleteSelected();
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        runSolver();
        return;
      }
      if (commandKey || event.altKey) return;
      const shortcutGroup = toolGroups.find(
        (group) => group.code === event.code,
      );
      if (shortcutGroup) {
        event.preventDefault();
        if (openToolGroup === shortcutGroup.id) {
          const nextIndex =
            (toolGroupIndex + 1) % shortcutGroup.toolIds.length;
          setToolGroupIndex(nextIndex);
          resetPendingIntersection();
          setActiveTool(shortcutGroup.toolIds[nextIndex]);
          setPendingPoints([]);
        } else {
          const activeIndex = shortcutGroup.toolIds.indexOf(activeTool);
          const nextIndex = activeIndex >= 0 ? activeIndex : 0;
          resetPendingIntersection();
          setActiveTool(shortcutGroup.toolIds[nextIndex]);
          setPendingPoints([]);
          openToolGroupMenu(shortcutGroup.id);
        }
        return;
      }
      const shortcutTool = tools.find(
        (tool) => tool.code && tool.code === event.code,
      );
      if (shortcutTool) {
        event.preventDefault();
        chooseTool(shortcutTool.id);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeTool,
    chooseTool,
    deleteSelected,
    helpOpen,
    openToolGroupMenu,
    openToolGroup,
    redo,
    resetPendingIntersection,
    runSolver,
    settingsOpen,
    toolGroupIndex,
    toolGroups,
    tools,
    undo,
  ]);

  const updateRow = (
    setRows: React.Dispatch<React.SetStateAction<ExpressionRow[]>>,
    id: number,
    patch: Partial<ExpressionRow>,
  ) => {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
    markDirty();
  };

  const updateExpressionInput = (
    setRows: React.Dispatch<React.SetStateAction<ExpressionRow[]>>,
    id: number,
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const input = event.currentTarget;
    const selectionStart = input.selectionStart ?? input.value.length;
    const selectionEnd = input.selectionEnd ?? selectionStart;
    const expanded = expandSymbolCommands(
      input.value,
      selectionStart,
      selectionEnd,
    );
    updateRow(setRows, id, { expression: expanded.value });
    if (expanded.changed) {
      window.requestAnimationFrame(() => {
        if (document.activeElement === input) {
          input.setSelectionRange(
            expanded.selectionStart,
            expanded.selectionEnd,
          );
        }
      });
    }
  };

  const toggleMobilePanel = (panel: "conditions" | "solver") => {
    if (panel === "conditions") setLeftOpen(true);
    if (panel === "solver") setRightOpen(true);
    setMobilePanel((current) => (current === panel ? "canvas" : panel));
  };

  const insertExpressionAfter = (
    group: "known" | "unknown",
    afterId: number,
  ) => {
    expressionIdRef.current = Math.max(
      expressionIdRef.current + 1,
      ...known.map((row) => row.id + 1),
      ...unknown.map((row) => row.id + 1),
    );
    const id = expressionIdRef.current;
    const setRows = group === "known" ? setKnown : setUnknown;
    setRows((current) => {
      const currentIndex = current.findIndex((row) => row.id === afterId);
      const insertIndex =
        currentIndex >= 0 ? currentIndex + 1 : current.length;
      const groupId =
        currentIndex >= 0 ? current[currentIndex].groupId : undefined;
      const next = [...current];
      next.splice(insertIndex, 0, {
        id,
        expression: "",
        enabled: true,
        color: COLORS[insertIndex % COLORS.length],
        groupId,
      });
      return next;
    });
    setAddMenu(null);
    markDirty();
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLInputElement>(
          `[data-expression-input="${group}-${id}"]`,
        )
        ?.focus();
    });
  };

  const addKnownExpression = (expression: string) => {
    setKnown((current) => [
      ...current,
      {
        id: Date.now(),
        expression,
        enabled: true,
        color: COLORS[current.length % COLORS.length],
      },
    ]);
    setAddMenu(null);
    markDirty();
  };

  const addUnknownExpression = (expression: string) => {
    setUnknown((current) => [
      ...current,
      {
        id: Date.now(),
        expression,
        enabled: true,
        color: COLORS[current.length % COLORS.length],
      },
    ]);
    setAddMenu(null);
    markDirty();
  };

  const clearDrawing = () => {
    if (
      !window.confirm(
        t(
          "Полностью очистить чертёж, условия, цели и измерения? Действие можно отменить.",
          "Clear the drawing, conditions, targets and measurements completely? You can undo this action.",
        ),
      )
    ) {
      return;
    }
    setPoints([]);
    setShapes([]);
    setMeasurements([]);
    setKnown([]);
    setUnknown([]);
    setGroups([]);
    setProjectTitle(EMPTY_PROJECT_TITLE[locale]);
    setResult(PENDING_RESULT);
    setView({ x: 0, y: 0, scale: 74 });
    setSelectedPoint(null);
    setSelectedPoints([]);
    setPendingPoints([]);
    setActiveTool("select");
    setOpenToolGroup(null);
    setAddMenu(null);
  };

  const exportDrawing = () => {
    const data = JSON.stringify(
      {
        format: "geosolver",
        version: CURRENT_PROJECT_FORMAT_VERSION,
        projectTitle: projectTitle.trim() || DEFAULT_PROJECT_TITLE,
        points,
        shapes,
        measurements,
        known,
        unknown,
        groups,
        solverEpsilon: solverEpsilonInput,
        solverMaxIterations: solverMaxIterationsInput,
        solverTimeLimitMs: solverTimeLimitMsInput,
        solverMode,
        view,
      },
      null,
      2,
    );
    const href = URL.createObjectURL(
      new Blob([data], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = href;
    const safeTitle = (projectTitle.trim() || "geosolver-drawing")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/g, "")
      .slice(0, 80);
    anchor.download = `${safeTitle || "geosolver-drawing"}.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  };

  const applyImportedProject = useCallback(
    (imported: ImportedProject, notice: string) => {
      if (historyTimerRef.current !== null) {
        window.clearTimeout(historyTimerRef.current);
        historyTimerRef.current = null;
      }
      historyRef.current = {
        past: [],
        present: cloneSnapshot(imported.snapshot),
        future: [],
      };
      applySnapshot(imported.snapshot);
      setProjectTitle(imported.projectTitle);
      setSolverEpsilonInput(imported.solverEpsilon);
      setSolverMaxIterationsInput(imported.solverMaxIterations);
      setSolverTimeLimitMsInput(imported.solverTimeLimitMs);
      setSolverMode(imported.solverMode);
      setView(imported.view ?? { x: 35, y: 34, scale: 74 });
      setActiveTool("select");
      setOpenToolGroup(null);
      setMobilePanel("canvas");
      expressionIdRef.current = Math.max(
        Date.now(),
        ...imported.snapshot.known.map((row) => row.id + 1),
        ...imported.snapshot.unknown.map((row) => row.id + 1),
      );
      setHistoryVersion((version) => version + 1);
      setCanvasNotice(notice);
      window.setTimeout(() => setCanvasNotice(null), 2200);
    },
    [applySnapshot],
  );

  const importDrawingFile = async (file: File) => {
    if (file.size > MAX_IMPORT_FILE_SIZE) {
      window.alert(
        t(
          "Файл слишком большой. Максимальный размер — 5 МБ.",
          "The file is too large. Maximum size is 5 MB.",
        ),
      );
      return;
    }
    try {
      const imported = parseImportedProject(await file.text());
      if (
        !window.confirm(
          t(
            `Импортировать проект «${imported.projectTitle}»? Текущий чертёж будет заменён.`,
            `Import “${imported.projectTitle}”? The current drawing will be replaced.`,
          ),
        )
      ) {
        return;
      }
      applyImportedProject(
        imported,
        t(
          `Импортирован проект «${imported.projectTitle}»`,
          `Imported “${imported.projectTitle}”`,
        ),
      );
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "Не удалось импортировать проект.",
      );
    }
  };

  const handleLoadProjectExample = useCallback(
    async (example: ProjectExample) => {
      const title = example.title[locale];
      if (
        !window.confirm(
          t(
            `Загрузить пример «${title}»? Текущий чертёж будет заменён.`,
            `Load “${title}”? The current drawing will be replaced.`,
          ),
        )
      ) {
        return;
      }
      try {
        const imported = await importProjectExampleJson(example);
        applyImportedProject(
          { ...imported, projectTitle: title },
          t(
            `Импортирован пример «${title}»`,
            `Imported example “${title}”`,
          ),
        );
        setHelpOpen(false);
      } catch {
        window.alert(
          t(
            `Не удалось импортировать ${example.file}`,
            `Could not import ${example.file}`,
          ),
        );
      }
    },
    [applyImportedProject, locale, t],
  );

  const handleImportInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) void importDrawingFile(file);
  };

  const hasDraggedFiles = (event: React.DragEvent<HTMLElement>) =>
    Array.from(event.dataTransfer.types).includes("Files");

  const handleImportDragEnter = (event: React.DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    importDragDepthRef.current += 1;
    setImportDragActive(true);
  };

  const handleImportDragOver = (event: React.DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleImportDragLeave = (event: React.DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    importDragDepthRef.current = Math.max(0, importDragDepthRef.current - 1);
    if (importDragDepthRef.current === 0) setImportDragActive(false);
  };

  const handleImportDrop = (event: React.DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    importDragDepthRef.current = 0;
    setImportDragActive(false);
    const file = event.dataTransfer.files[0];
    if (file) void importDrawingFile(file);
  };

  const fitDrawing = () => {
    if (!points.length) return;
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const scale = Math.min(
      110,
      Math.max(
        35,
        Math.min(
          (canvasSize.width - 180) / Math.max(maxX - minX, 2),
          (canvasSize.height - 180) / Math.max(maxY - minY, 2),
        ),
      ),
    );
    setView({
      scale,
      x: -((minX + maxX) / 2) * scale,
      y: ((minY + maxY) / 2) * scale,
    });
  };

  return (
    <main
      lang={locale}
      className="app-shell"
      onDragEnter={handleImportDragEnter}
      onDragOver={handleImportDragOver}
      onDragLeave={handleImportDragLeave}
      onDrop={handleImportDrop}
    >
      {importDragActive && (
        <div className="import-drop-overlay" role="status" aria-live="polite">
          <div>
            <span aria-hidden="true">↓</span>
            <b>{t("Импорт проекта", "Import project")}</b>
            <small>
              {t("Отпустите JSON-файл GeoSolver", "Drop the GeoSolver JSON file")}
            </small>
          </div>
        </div>
      )}
      <AppHeader
        projectTitle={projectTitle}
        setProjectTitle={setProjectTitle}
        canUndo={canUndo}
        canRedo={canRedo}
        undo={undo}
        redo={redo}
        clearDrawing={clearDrawing}
        setHelpOpen={setHelpOpen}
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
        importInputRef={importInputRef}
        handleImportInput={handleImportInput}
        rightOpen={rightOpen}
        setRightOpen={setRightOpen}
        mobilePanel={mobilePanel}
        setMobilePanel={setMobilePanel}
        toggleMobilePanel={toggleMobilePanel}
        t={t}
      />

      <section
        className={`workspace ${leftOpen ? "" : "left-collapsed"} ${
          rightOpen ? "" : "right-collapsed"
        } mobile-panel-${mobilePanel}`}
      >
        <aside className="left-panel">
          <ToolRail
            tools={tools}
            toolGroups={toolGroups}
            railItems={TOOL_RAIL_ITEMS}
            activeTool={activeTool}
            openToolGroup={openToolGroup}
            toolGroupIndex={toolGroupIndex}
            canDelete={Boolean(selectedPoint || selectedPoints.length)}
            t={t}
            chooseTool={chooseTool}
            openToolGroupMenu={openToolGroupMenu}
            toggleToolGroupMenu={toggleToolGroupMenu}
            scheduleToolGroupClose={scheduleToolGroupClose}
            setToolGroupIndex={setToolGroupIndex}
            deleteSelected={deleteSelected}
          />

          <ConditionsPanel
            known={known}
            unknown={unknown}
            setKnown={setKnown}
            setUnknown={setUnknown}
            addMenu={addMenu}
            setAddMenu={setAddMenu}
            bareAngleUnit={bareAngleUnit}
            points={points}
            shapes={shapes}
            groups={groups}
            setGroups={setGroups}
            locale={locale}
            draggedExpression={draggedExpression}
            t={t}
            insertExpressionAfter={insertExpressionAfter}
            addKnownExpression={addKnownExpression}
            addUnknownExpression={addUnknownExpression}
            expressionDragHandleProps={expressionDragHandleProps}
            updateRow={updateRow}
            updateExpressionInput={updateExpressionInput}
            moveExpressionRow={moveExpressionRow}
            focusAdjacentExpression={focusAdjacentExpression}
            onRenamePoint={renamePoint}
            onUpdatePoint={updatePointObject}
            onUpdateShape={updateShapeObject}
            onSelectPoint={(id) => selectPointCollection([id])}
            onSelectPoints={selectPointCollection}
            onAddPoint={addPointObject}
            onAddShape={addShapeObject}
            onDeletePoint={deletePointObject}
            onDeleteShape={deleteShapeObject}
            onMovePoint={movePointObject}
            onMoveShape={moveShapeObject}
            onReorderPoint={reorderPointObject}
            onReorderShape={reorderShapeObject}
            onReorderObject={reorderMixedObjects}
            onMoveObject={moveMixedObject}
          />
          <button
            className="panel-collapse"
            onClick={() => setLeftOpen(false)}
            aria-label={t("Свернуть панель условий", "Collapse conditions panel")}
          >
            ‹
          </button>
        </aside>

        <section
          className={`canvas-stage ${showToolHint ? "" : "hint-hidden"}`}
        >
          {!leftOpen && (
            <button
              className="reopen-panel left"
              onClick={() => setLeftOpen(true)}
              aria-label={t("Открыть панель условий", "Open conditions panel")}
            >
              ›
            </button>
          )}
          <canvas
            ref={canvasRef}
            className={`geometry-canvas tool-${activeTool} ${
              drag?.type === "group" ? "is-group-dragging" : ""
            }`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            aria-label={t(
              "Координатное поле геометрического чертежа",
              "Geometry coordinate canvas",
            )}
            tabIndex={0}
          />

          {showToolHint && (
            <div className="canvas-hint">
              <ToolGlyph tool={activeToolInfo} />
              <div>
                <b>
                  {activeToolInfo.label}
                  <kbd className="hint-shortcut">
                    {activeToolInfo.shortcut}
                  </kbd>
                </b>
                <small>{activeToolInfo.hint}</small>
              </div>
              {canvasNotice && <em className="notice">{canvasNotice}</em>}
              {!canvasNotice && selectedPoints.length > 1 && (
                <em>
                  {t(
                    `${selectedPoints.length} объектов выбрано`,
                    `${selectedPoints.length} objects selected`,
                  )}
                </em>
              )}
              {pendingPoints.length > 0 && (
                <em>
                  {pendingPoints.join(" → ")} ·{" "}
                  {t(
                    `выбрано ${pendingPoints.length}`,
                    `${pendingPoints.length} selected`,
                  )}
                </em>
              )}
            </div>
          )}

          {selectedPointData && activeTool === "select" && (
            <div className="point-inspector">
              <div className="inspector-title">
                <span>{t("ТОЧКА", "POINT")}</span>
                <small>
                  x {formatNumber(selectedPointData.x)} · y{" "}
                  {formatNumber(selectedPointData.y)}
                </small>
              </div>
              <label>
                <span>{t("Имя", "Name")}</span>
                <input
                  id="selected-point-name"
                  name="selected-point-name"
                  value={renameValue}
                  maxLength={16}
                  autoComplete="off"
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitRename();
                    if (event.key === "Escape") {
                      setRenameValue(selectedPointData.id);
                      event.currentTarget.blur();
                    }
                  }}
                  aria-label={t("Новое имя точки", "New point name")}
                />
              </label>
              <button onClick={commitRename}>
                {t("Переименовать", "Rename")}
              </button>
            </div>
          )}

          {measurementReadings.length > 0 && (
            <div className="measurement-tray">
              <div className="measurement-header">
                <div>
                  <span>{t("ИЗМЕРЕНИЯ", "MEASUREMENTS")}</span>
                  <b>{t("По текущему чертежу", "Current drawing")}</b>
                </div>
                <button
                  onClick={() => setMeasurements([])}
                  aria-label={t("Очистить измерения", "Clear measurements")}
                  title={t("Очистить измерения", "Clear measurements")}
                >
                  ×
                </button>
              </div>
              {measurementReadings.map((measurement) => (
                <div className="measurement-row" key={measurement.id}>
                  <i style={{ background: measurement.color }} />
                  <span>{measurement.label}</span>
                  <b>{measurement.value}</b>
                  <button
                    onClick={() =>
                      setMeasurements((current) =>
                        current.filter((item) => item.id !== measurement.id),
                      )
                    }
                    aria-label={t(
                      `Удалить измерение ${measurement.label}`,
                      `Delete measurement ${measurement.label}`,
                    )}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="canvas-controls">
            <button
              onClick={() =>
                setView((current) => ({
                  ...current,
                  scale: Math.min(
                    MAX_VIEW_SCALE,
                    current.scale * 1.2,
                  ),
                }))
              }
              aria-label={t("Приблизить", "Zoom in")}
            >
              +
            </button>
            <button
              onClick={() =>
                setView((current) => ({
                  ...current,
                  scale: Math.max(
                    MIN_VIEW_SCALE,
                    current.scale / 1.2,
                  ),
                }))
              }
              aria-label={t("Отдалить", "Zoom out")}
            >
              −
            </button>
            <button
              onClick={fitDrawing}
              aria-label={t("Показать весь чертёж", "Fit drawing")}
            >
              ⌗
            </button>
          </div>

          <div className="canvas-status">
            <span>{t(`${points.length} точек`, `${points.length} points`)}</span>
            <i />
            <span>{t(`${shapes.length} фигур`, `${shapes.length} shapes`)}</span>
            <i />
            <span>
              {t("масштаб", "zoom")} {Math.round((view.scale / 74) * 100)}%
            </span>
          </div>
        </section>

        <SolverPanel
          parsedKnown={parsedKnown}
          points={points}
          result={result}
          solverMode={solverMode}
          solverMaxIterations={solverMaxIterations}
          solverTimeLimitMs={solverTimeLimitMs}
          solving={solving}
          solverProgress={solverProgress}
          t={t}
          formatNumber={formatNumber}
          runSolver={runSolver}
          close={() => {
            setRightOpen(false);
            setMobilePanel("canvas");
          }}
        />

        {!rightOpen && (
          <button
            className="reopen-panel right"
            onClick={() => setRightOpen(true)}
            aria-label={t("Открыть решение", "Open solution")}
          >
            ‹
          </button>
        )}
      </section>
      {settingsOpen && (
        <SettingsDialog
          locale={locale}
          theme={theme}
          showCongruenceMarks={showCongruenceMarks}
          showAngles={showAngles}
          showAreaConstraints={showAreaConstraints}
          showToolHint={showToolHint}
          solverMode={solverMode}
          solverEpsilonInput={solverEpsilonInput}
          solverEpsilonValid={solverEpsilonValid}
          solverMaxIterationsInput={solverMaxIterationsInput}
          solverMaxIterationsValid={solverMaxIterationsValid}
          solverTimeLimitMsInput={solverTimeLimitMsInput}
          solverTimeLimitMsValid={solverTimeLimitMsValid}
          bareAngleUnit={bareAngleUnit}
          decimalDigits={decimalDigits}
          onLocaleChange={setLocale}
          onThemeChange={selectTheme}
          onShowCongruenceMarksChange={setShowCongruenceMarks}
          onShowAnglesChange={setShowAngles}
          onShowAreaConstraintsChange={setShowAreaConstraints}
          onShowToolHintChange={setShowToolHint}
          onSolverModeChange={(mode) => {
            setSolverMode(mode);
            markDirty();
          }}
          onSolverEpsilonInputChange={(value) => {
            setSolverEpsilonInput(value);
            markDirty();
          }}
          onSolverEpsilonInputBlur={() =>
            setSolverEpsilonInput(String(solverEpsilon))
          }
          onSolverMaxIterationsInputChange={(value) => {
            setSolverMaxIterationsInput(value);
            markDirty();
          }}
          onSolverMaxIterationsInputBlur={() =>
            setSolverMaxIterationsInput(String(solverMaxIterations))
          }
          onSolverTimeLimitMsInputChange={(value) => {
            setSolverTimeLimitMsInput(value);
            markDirty();
          }}
          onSolverTimeLimitMsInputBlur={() =>
            setSolverTimeLimitMsInput(String(solverTimeLimitMs))
          }
          onBareAngleUnitChange={(unit) => {
            setBareAngleUnit(unit);
            markDirty();
          }}
          onDecimalDigitsChange={setDecimalDigits}
          onExport={exportDrawing}
          onImport={() => {
            setSettingsOpen(false);
            window.setTimeout(() => importInputRef.current?.click(), 0);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {helpOpen && (
        <HelpDialog
          tools={tools}
          locale={locale}
          onLoadExample={handleLoadProjectExample}
          onClose={() => setHelpOpen(false)}
        />
      )}
    </main>
  );
}
