export type Point = {
  id: string;
  x: number;
  y: number;
  visible?: boolean;
  groupId?: string;
};

export type ArcMode = "minor" | "major" | "clockwise";

export type Shape = {
  id: string;
  type:
    | "segment"
    | "line"
    | "ray"
    | "polyline"
    | "circle"
    | "ellipse"
    | "sector"
    | "circularSegment"
    | "polygon";
  points: string[];
  color: string;
  arc?: ArcMode;
  visible?: boolean;
  groupId?: string;
};

export type Measurement = {
  id: number;
  kind: "distance" | "angle" | "area";
  points: string[];
  color: string;
  shapeId?: string;
};

export type GeometryKind =
  | "polygon"
  | "circle"
  | "ellipse"
  | "sector"
  | "circularSegment";

export type ExpressionRow = {
  id: number;
  expression: string;
  enabled: boolean;
  color: string;
  groupId?: string;
};

export type EditorGroup = {
  id: string;
  section: "objects" | "known" | "unknown";
  name: string;
  collapsed?: boolean;
  anchorId?: string;
  anchorSide?: "before" | "after";
};

export type DistanceObject = {
  kind:
    | "point"
    | "segment"
    | "line"
    | "ray"
    | "circle"
    | "ellipse"
    | "sector"
    | "circularSegment"
    | "polygon";
  ids: string[];
};

export type MathNode =
  | { kind: "number"; value: number }
  | { kind: "variable"; name: string }
  | {
      kind: "measure";
      measure:
        | "distance"
        | "objectDistance"
        | "intersectionArea"
        | "angle"
        | "area"
        | "perimeter"
        | "x"
        | "y";
      ids: string[];
      geometry?: GeometryKind;
      objects?: [DistanceObject, DistanceObject];
      geometries?: [GeometryReference, GeometryReference];
    }
  | { kind: "unary"; operator: "+" | "-"; value: MathNode }
  | {
      kind: "binary";
      operator: "+" | "-" | "*" | "/" | "^";
      left: MathNode;
      right: MathNode;
    }
  | {
      kind: "function";
      name: "sqrt" | "abs" | "sin" | "cos" | "tan" | "deg" | "rad";
      value: MathNode;
    };

export type AngleUnit = "degrees" | "radians";
export type SolverMode = "numerical" | "analytic";

export type FormulaEquation = {
  left: MathNode;
  right: MathNode;
  source: string;
};

export type ComparisonOperator = "!=" | "<" | ">" | "<=" | ">=";

export type FormulaComparison = {
  left: MathNode;
  right: MathNode;
  operator: ComparisonOperator;
  source: string;
};

export type VariableDefinition = {
  name: string;
  value: MathNode;
  source: string;
};

export type IntersectionObject = {
  kind:
    | "auto"
    | "segment"
    | "line"
    | "ray"
    | "circle"
    | "ellipse"
    | "sector"
    | "circularSegment"
    | "polygon";
  ids: string[];
};

export type GeometryReference = {
  kind: GeometryKind;
  ids: string[];
};

export type ContainmentReference = {
  kind: GeometryKind | "point";
  ids: string[];
};

export type FigureContainment = {
  inner: ContainmentReference;
  outer: GeometryReference;
};

export type DisjointDefinition = {
  first: IntersectionObject;
  second: IntersectionObject;
};

export type IntersectionDefinition = {
  points: string[];
  relation: "equals" | "contains";
  first: IntersectionObject;
  second: IntersectionObject;
};

export type ParsedConstraint = {
  kind:
    | "distance"
    | "angle"
    | "area"
    | "parallel"
    | "perpendicular"
    | "onSegment"
    | "onLine"
    | "onRay"
    | "onCircle"
    | "onArc"
    | "onEllipse"
    | "distinctPoints"
    | "convex"
    | "nonIntersecting"
    | "insideFigure"
    | "intersectionSet"
    | "definition"
    | "formula"
    | "inequality";
  ids: string[];
  value?: number;
  formula?: FormulaEquation;
  formulas?: FormulaEquation[];
  comparison?: FormulaComparison;
  comparisons?: FormulaComparison[];
  definition?: VariableDefinition;
  intersection?: IntersectionDefinition;
  disjoint?: DisjointDefinition;
  containment?: FigureContainment;
  source?: string;
};

export type UnknownTarget = {
  kind:
    | "distance"
    | "angle"
    | "area"
    | "perimeter"
    | "formula"
    | "predicate";
  ids: string[];
  label: string;
  formula?: MathNode;
  geometry?: GeometryKind;
  predicate?: ParsedConstraint;
};

export type LocalizedText = { ru: string; en: string };

export type SolutionStep = {
  title: LocalizedText;
  detail: LocalizedText;
  expression?: string;
};

export type ProofResult = {
  label: string;
  verdict: "proved" | "disproved" | "undetermined";
  evidence: "direct" | "analytic" | "counterexample" | "unsupported";
  detail: LocalizedText;
  steps: SolutionStep[];
};

export type SolveResult = {
  kind: "exact" | "approximate" | "dirty" | "empty";
  residual: number;
  elapsed: number;
  iterations: number;
  timedOut: boolean;
  values: {
    label: string;
    value: number;
    suffix: string;
    exact?: string;
    alternatives?: { value: number; exact?: string }[];
    steps?: SolutionStep[];
  }[];
  statements?: ProofResult[];
  mode?: SolverMode;
  steps?: SolutionStep[];
  goalSummary?: {
    total: number;
    completed: number;
    unresolved: string[];
  };
  drawing?: {
    status: "rebuilt" | "approximate" | "unchanged";
    residual: number;
    timedOut: boolean;
  };
  issues: { expression: string; error: number }[];
};

export type DrawingSnapshot = {
  points: Point[];
  shapes: Shape[];
  measurements: Measurement[];
  known: ExpressionRow[];
  unknown: ExpressionRow[];
  groups: EditorGroup[];
};

export type CanvasView = { x: number; y: number; scale: number };

export type CanvasDrag =
  | {
      type: "point";
      id: string;
      startX: number;
      startY: number;
      moved: boolean;
      cycleOnClick: boolean;
      cycleCandidates: string[];
    }
  | {
      type: "group";
      ids: string[];
      start: { x: number; y: number };
      origins: { id: string; x: number; y: number }[];
    }
  | {
      type: "marquee";
      startX: number;
      startY: number;
      currentX: number;
      currentY: number;
    }
  | {
      type: "measurementPan";
      hit: string | null;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
      moved: boolean;
    }
  | {
      type: "pan";
      startX: number;
      startY: number;
      originX: number;
      originY: number;
    }
  | null;

export type ImportedProject = {
  projectTitle: string;
  snapshot: DrawingSnapshot;
  solverEpsilon: string;
  solverMaxIterations: string;
  solverTimeLimitMs: string;
  solverMode: SolverMode;
  view: CanvasView | null;
};

export type HistoryState = {
  past: DrawingSnapshot[];
  present: DrawingSnapshot;
  future: DrawingSnapshot[];
};
