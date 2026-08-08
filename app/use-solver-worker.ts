"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type {
  AngleUnit,
  ExpressionRow,
  Point,
  Shape,
  SolverMode,
  SolverProgress,
  SolveResult,
} from "./domain";
import {
  mergeSolvedPointCoordinates,
  type SolverRequest,
} from "./solver-runner";
import type { SolverWorkerMessage } from "./solver-worker";

type UseSolverWorkerOptions = {
  points: Point[];
  shapes: Shape[];
  known: ExpressionRow[];
  unknown: ExpressionRow[];
  mode: SolverMode;
  angleUnit: AngleUnit;
  tolerance: number;
  maxIterations: number;
  timeLimitMs: number;
  setPoints: Dispatch<SetStateAction<Point[]>>;
  setResult: Dispatch<SetStateAction<SolveResult>>;
  setCanvasNotice: Dispatch<SetStateAction<string | null>>;
  setRightOpen: Dispatch<SetStateAction<boolean>>;
  translate: (ru: string, en: string) => string;
};

export function useSolverWorker(options: UseSolverWorkerOptions) {
  const [solving, setSolving] = useState(false);
  const [solverProgress, setSolverProgress] =
    useState<SolverProgress | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const lastProgressRef = useRef<SolverProgress | null>(null);

  const runSolver = useCallback(() => {
    if (solving) {
      workerRef.current?.terminate();
      workerRef.current = null;
      const latest = lastProgressRef.current;
      if (latest) {
        options.setPoints((current) =>
          mergeSolvedPointCoordinates(current, latest.points),
        );
        options.setResult({
          kind: "approximate",
          residual: latest.residual,
          elapsed: latest.elapsed,
          iterations: latest.iterations,
          timedOut: false,
          stopped: true,
          values: [],
          mode: options.mode,
          drawing: {
            status: "approximate",
            residual: latest.residual,
            timedOut: false,
          },
          issues: [],
        });
      }
      setSolving(false);
      setSolverProgress(null);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const worker = new Worker(new URL("./solver-worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    lastProgressRef.current = null;
    setSolverProgress({
      points: options.points,
      residual: Number.POSITIVE_INFINITY,
      elapsed: 0,
      iterations: 0,
      phase: "preparing",
    });
    setSolving(true);
    options.setRightOpen(true);
    const finish = () => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      setSolving(false);
      setSolverProgress(null);
    };
    worker.onmessage = (event: MessageEvent<SolverWorkerMessage>) => {
      const message = event.data;
      if (message.requestId !== requestId) return;
      if (message.type === "progress") {
        lastProgressRef.current = message.progress;
        setSolverProgress(message.progress);
        return;
      }
      if (message.type === "complete") {
        options.setPoints((current) =>
          mergeSolvedPointCoordinates(current, message.solved.points),
        );
        options.setResult(message.solved.result);
        finish();
        return;
      }
      options.setCanvasNotice(message.message);
      finish();
    };
    worker.onerror = (event) => {
      options.setCanvasNotice(
        event.message || options.translate("Ошибка решателя", "Solver error"),
      );
      finish();
    };
    const request: SolverRequest = {
      id: requestId,
      points: options.points,
      shapes: options.shapes,
      known: options.known,
      unknown: options.unknown,
      mode: options.mode,
      angleUnit: options.angleUnit,
      tolerance: options.tolerance,
      maxIterations: options.maxIterations,
      timeLimitMs: options.timeLimitMs,
    };
    worker.postMessage({ type: "solve", request });
  }, [options, solving]);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  return { runSolver, solving, solverProgress };
}
