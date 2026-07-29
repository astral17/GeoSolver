export type Point = {
  id: string;
  x: number;
  y: number;
  visible?: boolean;
  groupId?: string;
};

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
  arc?: "minor" | "major";
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

export type MathNode =
  | { kind: "number"; value: number }
  | { kind: "variable"; name: string }
  | {
      kind: "measure";
      measure:
        | "distance"
        | "angle"
        | "area"
        | "perimeter"
        | "x"
        | "y";
      ids: string[];
      geometry?: GeometryKind;
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
  kind: "auto" | "segment" | "line" | "ray" | "circle";
  ids: [string, string];
};

export type IntersectionDefinition = {
  point: string;
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
    | "nonIntersecting"
    | "intersectionPoint"
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
  source?: string;
};

export type UnknownTarget = {
  kind: "distance" | "angle" | "area" | "perimeter" | "formula";
  ids: string[];
  label: string;
  formula?: MathNode;
  geometry?: GeometryKind;
};

export type SolveResult = {
  kind: "exact" | "approximate" | "dirty" | "empty";
  residual: number;
  elapsed: number;
  iterations: number;
  timedOut: boolean;
  values: { label: string; value: number; suffix: string }[];
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
  view: CanvasView | null;
};

export type HistoryState = {
  past: DrawingSnapshot[];
  present: DrawingSnapshot;
  future: DrawingSnapshot[];
};
