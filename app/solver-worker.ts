/// <reference lib="webworker" />

import type { SolverProgress } from "./domain";
import {
  runSolverRequest,
  type SolverRequest,
  type SolverResponse,
} from "./solver-runner";

type WorkerIncoming = { type: "solve"; request: SolverRequest };
export type SolverWorkerMessage =
  | { type: "progress"; requestId: number; progress: SolverProgress }
  | { type: "complete"; requestId: number; solved: SolverResponse }
  | { type: "error"; requestId: number; message: string };

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<WorkerIncoming>) => {
  if (event.data.type !== "solve") return;
  const { request } = event.data;
  try {
    const solved = runSolverRequest(request, (progress) => {
      workerScope.postMessage({
        type: "progress",
        requestId: request.id,
        progress,
      } satisfies SolverWorkerMessage);
    });
    workerScope.postMessage({
      type: "complete",
      requestId: request.id,
      solved,
    } satisfies SolverWorkerMessage);
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      requestId: request.id,
      message: error instanceof Error ? error.message : String(error),
    } satisfies SolverWorkerMessage);
  }
};

export {};
