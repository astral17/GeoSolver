import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const moduleNames = [
  "domain",
  "geometry",
  "solver",
  "i18n",
  "expressions",
  "exact-value",
  "analytic-solver",
  "project-migrations",
  "project-state",
  "solver-runner",
];

async function loadLocalModule(entry = "expressions") {
  const compiled = new Map();
  await Promise.all(
    moduleNames.map(async (name) => {
      const source = await readFile(
        new URL(`../app/${name}.ts`, import.meta.url),
        "utf8",
      );
      const result = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
        fileName: `${name}.ts`,
      });
      compiled.set(name, result.outputText);
    }),
  );

  const cache = new Map();
  const load = (name) => {
    if (cache.has(name)) return cache.get(name);
    const code = compiled.get(name);
    if (!code) throw new Error(`Unknown local module: ${name}`);
    const runtimeModule = { exports: {} };
    cache.set(name, runtimeModule.exports);
    const localRequire = (specifier) =>
      load(specifier.replace(/^\.\//, "").replace(/\.js$/, ""));
    new Function("require", "module", "exports", code)(
      localRequire,
      runtimeModule,
      runtimeModule.exports,
    );
    cache.set(name, runtimeModule.exports);
    return runtimeModule.exports;
  };

  return load(entry);
}

test("keeps rational radicals and pi exact", async () => {
  const {
    exactAdd,
    exactFromRational,
    exactMultiply,
    exactPi,
    exactPowInteger,
    exactSqrt,
    formatExact,
  } = await loadLocalModule("exact-value");
  const threeQuarters = exactFromRational(3, 4);
  const diagonal = exactSqrt(
    exactAdd(
      exactPowInteger(threeQuarters, 2),
      exactPowInteger(threeQuarters, 2),
    ),
  );
  assert.equal(formatExact(diagonal), "3*sqrt(2)/4");
  assert.equal(
    formatExact(exactMultiply(exactFromRational(32, 3), exactPi())),
    "32*pi/3",
  );
});

test("reports directly contradictory constraints without guessing from residuals", async () => {
  const { solveNumerically, findConstraintContradictions } =
    await loadLocalModule("expressions");
  const points = [
    { id: "A", x: 0, y: 0 },
    { id: "B", x: 2, y: 0 },
  ];
  const rows = [
    { id: 1, expression: "AB = 3", enabled: true, color: "#000" },
    { id: 2, expression: "AB = 4", enabled: true, color: "#000" },
  ];
  const contradictions = findConstraintContradictions(rows, points, "degrees");
  assert.equal(contradictions.length, 1);
  assert.deepEqual(contradictions[0].expressions, ["AB = 3", "AB = 4"]);
  const solved = solveNumerically(
    points, [], rows, [], 1e-6, "degrees", 1200, 2500,
  );
  assert.equal(solved.result.kind, "inconsistent");
  assert.equal(solved.result.contradictions.length, 1);
  assert.deepEqual(solved.points, points);
});

test("merges only solved snapshot coordinates after a worker run", async () => {
  const { mergeSolvedPointCoordinates } = await loadLocalModule("solver-runner");
  const current = [
    { id: "A", x: 0, y: 0 },
    { id: "NEW", x: 9, y: 8 },
  ];
  const merged = mergeSolvedPointCoordinates(current, [
    { id: "A", x: 3, y: 4 },
    { id: "DELETED", x: 7, y: 7 },
  ]);
  assert.deepEqual(merged, [
    { id: "A", x: 3, y: 4 },
    { id: "NEW", x: 9, y: 8 },
  ]);
});

test("shares one time budget between analytical hints and numerical search", async () => {
  const { runSolverRequest } = await loadLocalModule("solver-runner");
  const points = Array.from({ length: 12 }, (_, index) => ({
    id: String.fromCharCode(65 + index),
    x: Math.cos(index) * (index + 1),
    y: Math.sin(index) * (index + 1),
  }));
  const known = points.map((point, index) => ({
    id: index + 1,
    expression: `${point.id}${points[(index + 1) % points.length].id} = ${1 + index / 7}`,
    enabled: true,
    color: "#000000",
  }));
  const startedAt = performance.now();
  const progress = [];
  const solved = runSolverRequest(
    {
      id: 1,
      points,
      shapes: [],
      known,
      unknown: [],
      mode: "numerical",
      angleUnit: "degrees",
      tolerance: 1e-12,
      maxIterations: 100_000,
      timeLimitMs: 50,
    },
    (update) => progress.push(update),
  );
  const wallTime = performance.now() - startedAt;
  assert.ok(wallTime < 250, `wall time ${wallTime} ms`);
  assert.ok(solved.result.elapsed < 250, `reported ${solved.result.elapsed} ms`);
  assert.ok(progress.length > 0);
});

test("renders a focus-defined ellipse through its third point", async () => {
  const { ellipseGeometry } = await loadLocalModule("geometry");
  const firstFocus = { id: "A", x: -3, y: -1 };
  const secondFocus = { id: "B", x: 3, y: 2 };
  const boundaryPoint = { id: "C", x: 1, y: 5 };
  const geometry = ellipseGeometry(firstFocus, secondFocus, boundaryPoint);
  const screenDx = boundaryPoint.x - geometry.center.x;
  const screenDy = -(boundaryPoint.y - geometry.center.y);
  const screenRotation = -geometry.rotation;
  const localX =
    screenDx * Math.cos(screenRotation) +
    screenDy * Math.sin(screenRotation);
  const localY =
    -screenDx * Math.sin(screenRotation) +
    screenDy * Math.cos(screenRotation);
  const equation =
    (localX * localX) / (geometry.radiusX * geometry.radiusX) +
    (localY * localY) / (geometry.radiusY * geometry.radiusY);
  assert.ok(Math.abs(equation - 1) < 1e-12, equation);
});

test("parses implicit equation objects and recursive set operations", async () => {
  const {
    compileImplicitEquation,
    evaluateImplicitEquation,
    parseConstraint,
    parseMathExpression,
    parseUnknown,
    solveNumerically,
  } = await loadLocalModule("expressions");
  const points = new Map([
    ["A", { id: "A", x: 2, y: -1 }],
  ]);
  const equation = compileImplicitEquation(
    "(x - x(A))^2 + (y - y(A))^2 <= 3^2",
  );
  assert.ok(equation);
  assert.equal(
    evaluateImplicitEquation(equation, { x: 2, y: 2 }, points).inside,
    true,
  );
  assert.ok(
    evaluateImplicitEquation(equation, { x: 6, y: -1 }, points)
      .membershipError > 0,
  );
  const pointFunctionEquation = compileImplicitEquation(
    "distance((x; y), A) = 2",
  );
  assert.ok(pointFunctionEquation);
  assert.ok(
    evaluateImplicitEquation(
      pointFunctionEquation,
      { x: 4, y: -1 },
      points,
    ).boundaryError < 1e-12,
  );

  const chained = parseConstraint("P = AB ∩ CD ∩ EF");
  assert.equal(chained.kind, "intersectionSet");
  assert.equal(chained.intersection.set.kind, "intersection");
  assert.equal(chained.intersection.set.operands.length, 3);

  const union = parseConstraint("P ∈ f1 ∪ ABC");
  assert.equal(union.kind, "intersectionSet");
  assert.equal(union.intersection.set.kind, "union");
  assert.equal(union.intersection.set.operands[0].object.kind, "equation");

  const containment = parseConstraint("ABC ∈ DEFG");
  assert.equal(containment.kind, "insideFigure");
  assert.deepEqual(containment.ids, ["A", "B", "C", "D", "E", "F", "G"]);

  const area = parseMathExpression("S(f1 ∪ ABC)");
  assert.equal(area.measure, "setArea");
  assert.equal(area.set.kind, "union");
  const equationArea = parseMathExpression("S(f1)");
  assert.equal(equationArea.measure, "area");
  assert.equal(equationArea.geometry, "equation");
  assert.equal(equationArea.shapeName, "f1");
  const equationAreaTarget = parseUnknown("S(f1) = ?");
  assert.equal(equationAreaTarget.kind, "formula");
  assert.equal(equationAreaTarget.formula.measure, "area");
  assert.equal(equationAreaTarget.formula.geometry, "equation");
  assert.deepEqual(equationAreaTarget.ids, []);
  assert.equal(parseUnknown("S(F1) = ?"), null);
  assert.equal(parseUnknown("ab = ?").kind, "formula");
  const objectDistance = parseMathExpression("distance(f1, AB)");
  assert.equal(objectDistance.measure, "objectDistance");
  assert.equal(objectDistance.objects[0].kind, "equation");
  const coordinatePoint = parseMathExpression("(1; a)");
  assert.equal(coordinatePoint.kind, "point");
  const pointDistance = parseMathExpression("distance((1; a), C)");
  assert.equal(pointDistance.measure, "objectDistance");
  assert.equal(pointDistance.objects[0].point.kind, "point");
  assert.deepEqual(pointDistance.objects[1].ids, ["C"]);
  const pointToCircle = parseMathExpression(
    "distance((1; 2), circle(AB))",
  );
  assert.equal(pointToCircle.measure, "objectDistance");
  assert.equal(pointToCircle.objects[0].pointArguments.length, 1);
  assert.equal(pointToCircle.objects[1].kind, "circle");
  const pointToCircleConstraint = parseConstraint(
    "distance((1; 2), circle(AB)) = 1",
  );
  assert.equal(pointToCircleConstraint.kind, "formula");
  const computedPolygon = parseMathExpression("S((1; 2)(3; 4)(5; 6))");
  assert.equal(computedPolygon.measure, "area");
  assert.equal(computedPolygon.pointArguments.length, 3);
  const computedContainment = parseConstraint(
    "(1; 1) \u2208 (0; 0)(3; 0)(0; 3)",
  );
  assert.equal(computedContainment.kind, "insideFigure");
  assert.equal(computedContainment.containment.inner.kind, "point");
  assert.equal(computedContainment.containment.outer.kind, "polygon");
  const computedAngle = parseMathExpression("angle((0; 0), C, (1; 0))");
  assert.equal(computedAngle.measure, "angle");
  assert.equal(computedAngle.pointArguments.length, 3);
  const computedPointResult = solveNumerically(
    [{ id: "C", x: 4, y: 6 }],
    [],
    [{ id: 1, expression: "a = 2", enabled: true, color: "#000" }],
    [
      {
        id: 2,
        expression: "distance((1; a), C)",
        enabled: true,
        color: "#000",
      },
    ],
    1e-6,
    "degrees",
    20,
    300,
  );
  assert.ok(
    Math.abs(computedPointResult.result.values[0].value - 5) < 1e-9,
  );
  const pointToCircleResult = solveNumerically(
    [
      { id: "A", x: 0, y: 0 },
      { id: "B", x: 1, y: 0 },
    ],
    [],
    [
      { id: 4, expression: "A = (0; 0)", enabled: true, color: "#000" },
      { id: 5, expression: "B = (1; 0)", enabled: true, color: "#000" },
    ],
    [
      {
        id: 3,
        expression: "distance((2; 0), circle(AB))",
        enabled: true,
        color: "#000",
      },
    ],
    1e-6,
    "degrees",
    20,
    300,
  );
  assert.ok(
    pointToCircleResult.result.values[0],
    JSON.stringify(pointToCircleResult.result),
  );
  assert.ok(Math.abs(pointToCircleResult.result.values[0].value - 1) < 1e-9);
  const equationAreaResult = solveNumerically(
    [
      { id: "A", x: 0, y: 0 },
      { id: "B", x: 1, y: 0 },
    ],
    [
      {
        id: "equation-region",
        type: "equation",
        points: [],
        color: "#000",
        name: "f1",
        equation: "(x - x(A))^2 + (y - y(A))^2 <= 1",
      },
    ],
    [],
    [
      {
        id: 6,
        expression: "S(f1) = ?",
        enabled: true,
        color: "#000",
      },
    ],
    1e-6,
    "degrees",
    20,
    300,
  );
  assert.equal(equationAreaResult.result.kind, "approximate");
  assert.equal(equationAreaResult.result.values.length, 1);
  assert.ok(equationAreaResult.result.values[0].value > 2.5);
});

test("numerical solver enforces membership in an implicit equation", async () => {
  const { parseConstraint, solveNumerically } = await loadLocalModule("expressions");
  const parsed = parseConstraint("P ∈ f1");
  assert.equal(parsed.kind, "intersectionSet");
  assert.equal(parsed.intersection.first.kind, "equation");
  const solved = solveNumerically(
    [{ id: "P", x: 1.5, y: 4 }],
    [
      {
        id: "shape-equation",
        type: "equation",
        points: [],
        color: "#5b6df9",
        name: "f1",
        equation: "y = 0",
      },
    ],
    [{ id: 1, expression: "P ∈ f1", enabled: true, color: "#5b6df9" }],
    [{ id: 2, expression: "y(P)", enabled: true, color: "#ef6b62" }],
    1e-6,
    "degrees",
    1200,
    1500,
  );
  assert.ok(
    Math.abs(solved.points[0].y) < 1e-5,
    JSON.stringify({ points: solved.points, result: solved.result }),
  );
  assert.ok(solved.result.residual < 1e-5, solved.result.residual);
});

test("matches the Apollo equation region with its explicit ellipse", async () => {
  const project = JSON.parse(
    await readFile(
      new URL("../public/examples/apollo.json", import.meta.url),
      "utf8",
    ),
  );
  const { solveNumerically } = await loadLocalModule("expressions");
  const solved = solveNumerically(
    project.points,
    project.shapes,
    project.known,
    project.unknown,
    1e-6,
    "degrees",
    1200,
    2500,
  );
  assert.equal(solved.result.values.length, 1);
  assert.ok(
    Math.abs(solved.result.values[0].value) < 1e-9,
    solved.result.values[0].value,
  );
});

test("analytical solver derives exact radicals and proposition verdicts", async () => {
  const { solveAnalytically } = await loadLocalModule("analytic-solver");
  const points = [
    { id: "A", x: 0, y: 0 },
    { id: "B", x: 1, y: 0 },
    { id: "C", x: 0, y: 1 },
  ];
  const known = [
    { id: 1, expression: "AB = 3/4", enabled: true, color: "#000000" },
    { id: 2, expression: "AB = AC", enabled: true, color: "#000000" },
    { id: 3, expression: "∠BAC = 90°", enabled: true, color: "#000000" },
  ];
  const solved = solveAnalytically(
    points,
    [],
    known,
    [
      { id: 4, expression: "BC", enabled: true, color: "#000000" },
      { id: 5, expression: "AB = AC", enabled: true, color: "#000000" },
      {
        id: 6,
        expression: "∠ABC = ∠BCA",
        enabled: true,
        color: "#000000",
      },
      { id: 7, expression: "AB ⟂ AC", enabled: true, color: "#000000" },
      { id: 8, expression: "AB = BC", enabled: true, color: "#000000" },
      { id: 9, expression: "AB != BC", enabled: true, color: "#000000" },
    ],
    "degrees",
  );

  assert.equal(solved.result.kind, "exact");
  assert.equal(solved.result.mode, "analytic");
  assert.equal(solved.result.values[0].exact, "3*sqrt(2)/4");
  const [a, b, c] = solved.points;
  assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - 0.75) < 1e-4);
  assert.ok(Math.abs(Math.hypot(a.x - c.x, a.y - c.y) - 0.75) < 1e-4);
  assert.notEqual(solved.result.drawing.status, "unchanged");
  assert.deepEqual(solved.result.goalSummary, {
    total: 6,
    completed: 6,
    unresolved: [],
  });
  assert.deepEqual(
    solved.result.statements.map(({ verdict }) => verdict),
    ["proved", "proved", "proved", "disproved", "proved"],
  );
  assert.ok(solved.result.steps.length > 0);
  assert.ok(
    solved.result.steps.some((step) => step.title.en === "Pythagorean theorem"),
  );
});

test("analytical solver applies the law of cosines in both directions", async () => {
  const { solveAnalytically } = await loadLocalModule("analytic-solver");
  const points = [
    { id: "A", x: 0, y: 0 },
    { id: "B", x: 5, y: 0 },
    { id: "C", x: 3.5, y: 6 },
  ];
  const row = (id, expression) => ({
    id,
    expression,
    enabled: true,
    color: "#000000",
  });
  const side = solveAnalytically(
    points,
    [],
    [row(1, "AB = 5"), row(2, "AC = 7"), row(3, "∠BAC = 60°")],
    [row(4, "BC")],
    "degrees",
    1e-6,
    300,
    500,
  );
  assert.equal(side.result.values[0].exact, "sqrt(39)");
  assert.ok(
    side.result.steps.some((step) => step.title.en === "Law of cosines"),
  );

  const angle = solveAnalytically(
    points,
    [],
    [row(5, "AB = 3"), row(6, "AC = 4"), row(7, "BC = 5")],
    [row(8, "∠BAC")],
    "degrees",
    1e-6,
    300,
    500,
  );
  assert.equal(angle.result.values[0].exact, "90");
  assert.ok(
    angle.result.steps.some(
      (step) => step.title.en === "Angle from the law of cosines",
    ),
  );
});

test("solves a new cyclic isosceles angle chain with general rules", async () => {
  const { solveAnalytically } = await loadLocalModule("analytic-solver");
  const project = JSON.parse(
    await readFile(
      new URL("../public/examples/isosceles-everywhere.json", import.meta.url),
      "utf8",
    ),
  );
  const solved = solveAnalytically(
    project.points,
    project.shapes,
    project.known,
    project.unknown,
    "degrees",
    1e-6,
    600,
    1500,
  );
  assert.equal(solved.result.values[0]?.exact, "108");
  assert.equal(solved.result.goalSummary.completed, 1);
  assert.ok(
    solved.result.steps.some(
      (step) => step.title.en === "Inscribed angles in one circle",
    ),
  );
  const linearSystemStep = solved.result.steps.find(
    (step) => step.title.en === "Solve the linear relation system",
  );
  assert.ok(linearSystemStep);
  assert.match(linearSystemStep.expression, /\n/);
  assert.doesNotMatch(linearSystemStep.expression, /; /);
});

test("solves the cevian length-sum angle problem t1 analytically", async () => {
  const { solveAnalytically } = await loadLocalModule("analytic-solver");
  const project = JSON.parse(
    await readFile(
      new URL("../public/examples/t1-angle-sum.json", import.meta.url),
      "utf8",
    ),
  );
  const solved = solveAnalytically(
    project.points,
    project.shapes,
    project.known,
    project.unknown,
    "degrees",
    1e-6,
    1000,
    2000,
  );
  assert.equal(solved.result.values[0]?.exact, "40");
  assert.equal(solved.result.goalSummary.completed, 1);
  assert.ok(
    solved.result.steps.some(
      (step) => step.title.en === "Sine-law length ratio",
    ),
  );
});

test("uses isosceles altitudes and Apollonius's median theorem", async () => {
  const { solveAnalytically } = await loadLocalModule("analytic-solver");
  const cases = [
    {
      name: "isosceles-altitude",
      values: ["7"],
      theorem: "Altitude of an isosceles triangle",
    },
    {
      name: "median-area-t2",
      values: ["24"],
      theorem: "Apollonius's median theorem",
    },
  ];
  for (const expectation of cases) {
    const project = JSON.parse(
      await readFile(
        new URL(`../public/examples/${expectation.name}.json`, import.meta.url),
        "utf8",
      ),
    );
    const solved = solveAnalytically(
      project.points,
      project.shapes,
      project.known,
      project.unknown,
      "degrees",
      1e-6,
      1200,
      2500,
    );
    assert.deepEqual(
      solved.result.values.map((value) => value.exact),
      expectation.values,
      expectation.name,
    );
    assert.equal(solved.result.goalSummary.completed, 1);
    assert.ok(
      solved.result.steps.some(
        (step) => step.title.en === expectation.theorem,
      ),
      `missing theorem step for ${expectation.name}: ${solved.result.steps.map((step) => step.title.en).join(", ")}`,
    );
  }
});

test("rejects the impossible t3 altitude with either right-angle syntax", async () => {
  const { parseConstraint, solveNumerically } =
    await loadLocalModule("expressions");
  assert.deepEqual(parseConstraint("BD ⟂ AC"), {
    kind: "perpendicular",
    ids: ["B", "D", "A", "C"],
  });
  const project = JSON.parse(
    await readFile(
      new URL("../public/examples/inconsistent-altitude-t3.json", import.meta.url),
      "utf8",
    ),
  );
  const solveWith = (useAngle) =>
    solveNumerically(
      project.points,
      project.shapes,
      project.known.map((row) => ({
        ...row,
        enabled:
          row.expression === "BD ⟂ AC"
            ? !useAngle
            : row.expression === "∠BDA = 90°"
              ? useAngle
              : row.enabled,
      })),
      project.unknown,
      1e-6,
      "degrees",
      1200,
      2500,
    );
  const perpendicular = solveWith(false);
  const angle = solveWith(true);
  assert.equal(
    perpendicular.result.kind,
    "approximate",
    JSON.stringify(perpendicular),
  );
  assert.equal(angle.result.kind, "approximate", JSON.stringify(angle));
  assert.ok(perpendicular.result.residual > 1e-3);
  assert.ok(angle.result.residual > 1e-3, JSON.stringify(angle));
  assert.ok(
    Math.abs(perpendicular.result.residual - angle.result.residual) < 1e-10,
  );
  perpendicular.points.forEach((point, index) => {
    assert.ok(Math.abs(point.x - angle.points[index].x) < 1e-8);
    assert.ok(Math.abs(point.y - angle.points[index].y) < 1e-8);
  });
});

test("solves t4 with the right-triangle projection theorem", async () => {
  const { solveAnalytically } = await loadLocalModule("analytic-solver");
  const project = JSON.parse(
    await readFile(
      new URL("../public/examples/right-triangle-altitude-t4.json", import.meta.url),
      "utf8",
    ),
  );
  const solved = solveAnalytically(
    project.points,
    project.shapes,
    project.known,
    project.unknown,
    "degrees",
    1e-6,
    1200,
    2500,
  );
  assert.deepEqual(
    solved.result.values.map((value) => value.exact),
    ["25/13", "144/13"],
  );
  assert.equal(solved.result.goalSummary.completed, 2);
  assert.ok(
    solved.result.steps.some(
      (step) => step.title.en === "Leg-projection theorem",
    ),
  );
});

test("locates the curved-boundary intersection in t5", async () => {
  const { locateObjectIntersections } = await loadLocalModule("expressions");
  const project = JSON.parse(
    await readFile(
      new URL("../public/examples/intersecting-sectors-t5.json", import.meta.url),
      "utf8",
    ),
  );
  const map = new Map(project.points.map((point) => [point.id, point]));
  const located = locateObjectIntersections(
    { kind: "sector", ids: ["E", "D", "A"] },
    { kind: "sector", ids: ["F", "B", "C"] },
    map,
    project.shapes,
  );
  const expected = map.get("G");
  assert.equal(located.continuous, false);
  assert.ok(
    located.points.some(
      (point) => Math.hypot(point.x - expected.x, point.y - expected.y) < 0.02,
    ),
    JSON.stringify(located.points),
  );
});

test("keeps synthetic 180-degree relations independent of the input angle unit", async () => {
  const { solveAnalytically } = await loadLocalModule("analytic-solver");
  for (const [file, expected] of [
    ["intersecting-sectors-t5.json", "45"],
    ["exterior-angle-t7.json", "130"],
  ]) {
    const project = JSON.parse(
      await readFile(new URL(`../public/examples/${file}`, import.meta.url), "utf8"),
    );
    for (const angleUnit of ["degrees", "radians"]) {
      const solved = solveAnalytically(
        project.points,
        project.shapes,
        project.known,
        project.unknown,
        angleUnit,
        1e-6,
        1200,
        2500,
      );
      assert.equal(
        solved.result.values[0]?.exact,
        expected,
        `${file} in ${angleUnit}`,
      );
    }
  }
});

test("solves t8 by AA similarity and segment addition", async () => {
  const { solveAnalytically } = await loadLocalModule("analytic-solver");
  const project = JSON.parse(
    await readFile(
      new URL("../public/examples/similar-triangles-t8.json", import.meta.url),
      "utf8",
    ),
  );
  const solved = solveAnalytically(
    project.points,
    project.shapes,
    project.known,
    project.unknown,
    "degrees",
    1e-6,
    1200,
    2500,
  );
  assert.equal(solved.result.values[0]?.exact, "15");
  assert.ok(
    solved.result.steps.some((step) => step.title.en === "AA triangle similarity"),
  );
});

test("solves t6 from an orthogonal chain and a circumradius", async () => {
  const { solveAnalytically } = await loadLocalModule("analytic-solver");
  const project = JSON.parse(
    await readFile(
      new URL("../public/examples/orthogonal-circle-t6.json", import.meta.url),
      "utf8",
    ),
  );
  const solved = solveAnalytically(
    project.points,
    project.shapes,
    project.known,
    project.unknown,
    "degrees",
    1e-6,
    1200,
    2500,
  );
  assert.equal(solved.result.values[0]?.exact, "sqrt(34)/2");
  assert.ok(
    solved.result.steps.some(
      (step) => step.title.en === "Resolve an orthogonal chain",
    ),
  );
  assert.ok(
    solved.result.steps.some(
      (step) => step.title.en === "Circumradius of a triangle",
    ),
  );
});

test("keeps non-tabular t9 angles exact through inverse cosine", async () => {
  const { solveAnalytically } = await loadLocalModule("analytic-solver");
  const project = JSON.parse(
    await readFile(
      new URL("../public/examples/scalene-triangle-t9.json", import.meta.url),
      "utf8",
    ),
  );
  const solved = solveAnalytically(
    project.points,
    project.shapes,
    project.known,
    project.unknown,
    "degrees",
    1e-6,
    1200,
    2500,
  );
  assert.deepEqual(
    solved.result.values.map((value) => value.exact),
    [
      "180*acos(-1/4)/pi",
      "180*acos(7/8)/pi",
      "180*acos(11/16)/pi",
    ],
  );
  assert.ok(
    solved.result.steps.some(
      (step) => step.title.en === "Inverse cosine of an exact ratio",
    ),
  );
});

test("solves t10 with isosceles-trapezoid angle relations", async () => {
  const { solveAnalytically } = await loadLocalModule("analytic-solver");
  const project = JSON.parse(
    await readFile(
      new URL("../public/examples/isosceles-trapezoid-t10.json", import.meta.url),
      "utf8",
    ),
  );
  const solved = solveAnalytically(
    project.points,
    project.shapes,
    project.known,
    project.unknown,
    "degrees",
    1e-6,
    1200,
    2500,
  );
  assert.deepEqual(
    solved.result.values.map((value) => value.exact),
    ["60", "120"],
  );
  assert.ok(
    solved.result.steps.some(
      (step) => step.title.en === "Angles of an isosceles trapezoid",
    ),
  );
});

test("keeps the Green versus blue invariant after project migration", async () => {
  const { solveAnalytically } = await loadLocalModule("analytic-solver");
  const { parseImportedProject } = await loadLocalModule("project-state");
  const imported = parseImportedProject(
    await readFile(
      new URL("../public/examples/green-vs-blue.json", import.meta.url),
      "utf8",
    ),
  );
  const solved = solveAnalytically(
    imported.snapshot.points,
    imported.snapshot.shapes,
    imported.snapshot.known,
    imported.snapshot.unknown,
    "degrees",
    1e-6,
    500,
    1000,
  );
  assert.deepEqual(
    solved.result.values.map((value) => value.exact),
    ["5"],
  );
  assert.equal(solved.result.goalSummary.completed, 1);
  assert.deepEqual(solved.result.goalSummary.unresolved, [
    "S(AFB) + S(BGH) = ?",
    "S(HCE) + S(AED) = ?",
  ]);
  const names = { A: "J", B: "K", C: "L", D: "M", E: "N", F: "O", G: "P", H: "Q" };
  const rename = (value) => value.replace(/[A-H]/g, (id) => names[id]);
  const renamed = solveAnalytically(
    imported.snapshot.points.map((point) => ({ ...point, id: names[point.id] })),
    imported.snapshot.shapes.map((shape) => ({
      ...shape,
      points: shape.points.map((id) => names[id]),
    })),
    imported.snapshot.known.map((row) => ({
      ...row,
      expression: rename(row.expression),
    })),
    imported.snapshot.unknown.map((row) => ({
      ...row,
      expression: rename(row.expression),
    })),
    "degrees",
    1e-6,
    500,
    1000,
  );
  assert.deepEqual(
    renamed.result.values.map((value) => value.exact),
    ["5"],
  );
});

test("analytical solver reports partially completed targets", async () => {
  const { solveAnalytically } = await loadLocalModule("analytic-solver");
  const row = (id, expression) => ({
    id,
    expression,
    enabled: true,
    color: "#000000",
  });
  const solved = solveAnalytically(
    [
      { id: "A", x: 0, y: 0 },
      { id: "B", x: 1, y: 0 },
      { id: "C", x: 0, y: 1 },
      { id: "D", x: 1, y: 1 },
    ],
    [],
    [row(1, "AB = 2")],
    [row(2, "AB"), row(3, "S(ABCD)")],
    "degrees",
    1e-6,
    100,
    200,
  );
  assert.equal(solved.result.values[0].exact, "2");
  assert.deepEqual(solved.result.goalSummary, {
    total: 2,
    completed: 1,
    unresolved: ["S(ABCD)"],
  });
});

test("numerical predicate goals keep only direct givens formally proved", async () => {
  const { solveNumerically } = await loadLocalModule();
  const points = [
    { id: "A", x: 0, y: 0 },
    { id: "B", x: 3, y: 0 },
    { id: "C", x: 7, y: 0 },
  ];
  const known = [
    { id: 1, expression: "AB = 3", enabled: true, color: "#000000" },
    { id: 2, expression: "BC = 4", enabled: true, color: "#000000" },
  ];
  const solved = solveNumerically(
    points,
    [],
    known,
    [
      { id: 3, expression: "AB = 3", enabled: true, color: "#000000" },
      { id: 4, expression: "AB = BC", enabled: true, color: "#000000" },
      { id: 5, expression: "AB = AB", enabled: true, color: "#000000" },
    ],
    1e-6,
    "degrees",
    100,
    500,
  );
  assert.equal(solved.result.kind, "exact");
  assert.deepEqual(
    solved.result.statements.map(({ verdict }) => verdict),
    ["proved", "undetermined", "undetermined"],
  );
  assert.deepEqual(
    solved.result.statements.map(({ evidence }) => evidence),
    ["direct", "counterexample", "unsupported"],
  );
});

test("numerical predicate checks remain three-valued and reject unsafe direct matches", async () => {
  const { parseUnknown, solveNumerically } = await loadLocalModule();
  const row = (id, expression) => ({
    id,
    expression,
    enabled: true,
    color: "#000000",
  });

  assert.equal(parseUnknown("a = b")?.kind, "predicate");

  const symmetricDirect = solveNumerically(
    [
      { id: "A", x: 0, y: 0 },
      { id: "B", x: 1, y: 0 },
      { id: "C", x: 2, y: 0 },
    ],
    [],
    [row(0, "AB = BC")],
    [row(1, "BC = AB")],
    1e-6,
    "degrees",
    100,
    500,
  );
  assert.deepEqual(
    symmetricDirect.result.statements.map(({ verdict, evidence }) => ({
      verdict,
      evidence,
    })),
    [{ verdict: "proved", evidence: "direct" }],
  );

  const strict = solveNumerically(
    [
      { id: "A", x: 0, y: 0 },
      { id: "B", x: 1, y: 0 },
      { id: "C", x: 2.00001, y: 0 },
    ],
    [],
    [row(1, "AB = 1"), row(2, "BC = 1.00001")],
    [row(3, "AB < BC"), row(4, "AB > 2 * BC"), row(5, "AB = BD")],
    1e-6,
    "degrees",
    100,
    500,
  );
  assert.deepEqual(
    strict.result.statements.map(({ verdict }) => verdict),
    ["undetermined", "undetermined", "undetermined"],
  );
  assert.deepEqual(
    strict.result.statements.map(({ evidence }) => evidence),
    ["unsupported", "counterexample", "unsupported"],
  );

  const unsafeDirect = solveNumerically(
    [
      { id: "X", x: 0, y: 0 },
      { id: "Y", x: 1, y: 0 },
    ],
    [],
    [row(10, "A < B"), row(11, "XY = 1")],
    [row(12, "a < b")],
    1e-6,
    "degrees",
    100,
    500,
  );
  assert.deepEqual(
    unsafeDirect.result.statements.map(({ verdict, evidence }) => ({
      verdict,
      evidence,
    })),
    [{ verdict: "undetermined", evidence: "unsupported" }],
  );

  const invalidOnly = solveNumerically(
    [],
    [],
    [row(13, "A < B")],
    [row(14, "a < b")],
    1e-6,
    "degrees",
    100,
    500,
  );
  assert.equal(invalidOnly.result.kind, "empty");
  assert.deepEqual(
    invalidOnly.result.statements.map(({ verdict, evidence }) => ({
      verdict,
      evidence,
    })),
    [{ verdict: "undetermined", evidence: "unsupported" }],
  );

  const degenerate = solveNumerically(
    [
      { id: "A", x: 0, y: 0 },
      { id: "B", x: 0, y: 0 },
      { id: "C", x: 1, y: 0 },
      { id: "D", x: 0, y: 1 },
      { id: "E", x: 0, y: 0 },
      { id: "F", x: 1, y: 0 },
    ],
    [],
    [row(20, "AB = 0"), row(21, "DE = 1"), row(22, "EF = 1")],
    [row(23, "∠ABC < ∠DEF")],
    1e-6,
    "degrees",
    100,
    500,
  );
  assert.deepEqual(
    degenerate.result.statements.map(({ verdict, evidence }) => ({
      verdict,
      evidence,
    })),
    [{ verdict: "undetermined", evidence: "unsupported" }],
  );

  const incompatible = solveNumerically(
    [
      { id: "X", x: 0, y: 0 },
      { id: "Y", x: 1, y: 0 },
    ],
    [],
    [row(30, "XY = 1"), row(31, "XY = 1.0000005")],
    [row(32, "XY = 2")],
    1e-6,
    "degrees",
    100,
    500,
  );
  assert.equal(incompatible.result.kind, "inconsistent");
  assert.equal(incompatible.result.contradictions.length, 1);
});

test("solves the overturned-square regression fixture", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL("./fixtures/overturned-square.json", import.meta.url),
      "utf8",
    ),
  );
  const {
    normalizeUnknownExpression,
    parseConstraint,
    parseMathExpression,
    parseUnknown,
    renamePointInExpression,
    solveNumerically,
    trimNumber,
  } = await loadLocalModule();
  assert.deepEqual(parseConstraint("P ∈ arc(OAB)"), {
    kind: "onArc",
    ids: ["P", "O", "A", "B"],
    source: "P ∈ arc(OAB)",
  });
  assert.deepEqual(parseConstraint("convex(ABCD)"), {
    kind: "convex",
    ids: ["A", "B", "C", "D"],
    source: "convex(ABCD)",
  });
  assert.deepEqual(parseConstraint("ABC ∈ DEFG"), {
    kind: "insideFigure",
    ids: ["A", "B", "C", "D", "E", "F", "G"],
    containment: {
      inner: { kind: "polygon", ids: ["A", "B", "C"] },
      outer: { kind: "polygon", ids: ["D", "E", "F", "G"] },
    },
    source: "ABC ∈ DEFG",
  });
  assert.equal(
    parseConstraint("line(AB) ∩ circle(CD) = ∅")?.kind,
    "intersectionSet",
  );
  assert.deepEqual(
    parseConstraint("∅ = line(AB) ∩ circle(CD)")?.intersection?.points,
    [],
  );
  assert.deepEqual(
    parseConstraint("{A, B} = circle(CD) ∩ circle(EF)")?.intersection,
    {
      points: ["A", "B"],
      relation: "equals",
      first: { kind: "circle", ids: ["C", "D"] },
      second: { kind: "circle", ids: ["E", "F"] },
    },
  );
  assert.equal(
    parseConstraint("A ∈ line(BC) ∩ circle(DE)")?.intersection?.relation,
    "contains",
  );
  assert.equal(
    parseConstraint("line(BC) ∩ circle(DE) = A")?.intersection?.relation,
    "equals",
  );
  assert.equal(
    parseMathExpression("distance(line(AB), circle(CD))")?.measure,
    "objectDistance",
  );
  assert.equal(
    parseMathExpression("S(circle(AB) ∩ polygon(CDEF))")?.measure,
    "intersectionArea",
  );
  assert.equal(parseUnknown("AB = BC")?.kind, "predicate");
  assert.equal(parseUnknown("∠ABC = ∠DEF")?.kind, "predicate");
  assert.equal(parseUnknown("AB ⟂ CD")?.kind, "predicate");
  assert.equal(parseUnknown("AB ∥ CD")?.kind, "predicate");
  assert.equal(normalizeUnknownExpression("AB = BC"), "AB = BC");
  assert.equal(normalizeUnknownExpression("AB"), "AB = ?");
  assert.equal(parseUnknown("AB = BC = ?"), null);
  assert.deepEqual(parseConstraint("A123B89 = 5"), {
    kind: "distance",
    ids: ["A123", "B89"],
    value: 5,
  });
  assert.deepEqual(parseConstraint("C777 ∈ A123B89"), {
    kind: "onSegment",
    ids: ["C777", "A123", "B89"],
    source: "C777 ∈ A123B89",
  });
  assert.deepEqual(parseUnknown("S(A123B89C777)"), {
    kind: "area",
    ids: ["A123", "B89", "C777"],
    label: "S(A123B89C777)",
    geometry: "polygon",
  });
  assert.deepEqual(parseMathExpression("A123B89"), {
    kind: "measure",
    measure: "distance",
    ids: ["A123", "B89"],
  });
  assert.equal(
    renamePointInExpression("∠A123B89C777 = 90°", "B89", "D42"),
    "∠A123D42C777 = 90°",
  );
  const solved = solveNumerically(
    fixture.points,
    fixture.shapes,
    fixture.known,
    fixture.unknown,
    Number(fixture.solverEpsilon),
    "degrees",
    Number(fixture.solverMaxIterations),
    Number(fixture.solverTimeLimitMs),
  );

  assert.equal(solved.result.kind, "exact");
  assert.ok(solved.result.residual < 1e-6);
  assert.ok(
    Math.abs(solved.result.values[0].value - 135) < 1e-4,
    `unexpected area: ${solved.result.values[0].value}`,
  );
  assert.equal(trimNumber(135.000058, 6), "135.000058");

  for (const anchorId of ["S", "T"]) {
    const before = fixture.points.find((point) => point.id === anchorId);
    const after = solved.points.find((point) => point.id === anchorId);
    assert.deepEqual(after, before);
  }

  const ellipse = solveNumerically(
    [
      { id: "A", x: -1, y: 0 },
      { id: "B", x: 1, y: 0 },
      { id: "C", x: 0, y: 2 },
      { id: "D", x: 0, y: -2 },
    ],
    [
      {
        id: "ellipse-test",
        type: "ellipse",
        points: ["A", "B", "C"],
        color: "#000000",
      },
    ],
    [
      {
        id: 1,
        expression: "D ∈ ellipse(ABC)",
        enabled: true,
        color: "#000000",
      },
    ],
    [
      {
        id: 2,
        expression: "S(ellipse(ABC)) = ?",
        enabled: true,
        color: "#000000",
      },
    ],
    1e-6,
    "degrees",
    100,
    500,
  );
  assert.equal(ellipse.result.kind, "exact");
  assert.ok(
    Math.abs(ellipse.result.values[0].value - 2 * Math.PI * Math.sqrt(5)) <
      1e-9,
  );

  const spatial = solveNumerically(
    [
      { id: "A", x: -0.5, y: -0.5 },
      { id: "B", x: 0.5, y: -0.5 },
      { id: "C", x: 0, y: 0.5 },
      { id: "D", x: -2, y: -2 },
      { id: "E", x: 2, y: -2 },
      { id: "F", x: 2, y: 2 },
      { id: "G", x: -2, y: 2 },
      { id: "H", x: -2, y: 3 },
      { id: "I", x: 2, y: 3 },
      { id: "J", x: 0, y: 0 },
      { id: "K", x: 1, y: 0 },
    ],
    [],
    [
      { id: 3, expression: "convex(DEFG)", enabled: true, color: "#000" },
      { id: 4, expression: "ABC ∈ DEFG", enabled: true, color: "#000" },
      {
        id: 5,
        expression: "line(HI) ∩ circle(JK) = ∅",
        enabled: true,
        color: "#000",
      },
    ],
    [{ id: 6, expression: "AB = ?", enabled: true, color: "#000" }],
    1e-6,
    "degrees",
    100,
    500,
  );
  assert.equal(spatial.result.kind, "exact");
  assert.equal(spatial.result.values[0].value, 1);

  const objectDistance = solveNumerically(
    [
      { id: "A", x: -2, y: 0 },
      { id: "B", x: 2, y: 0 },
      { id: "C", x: 0, y: 3 },
      { id: "D", x: 0, y: 4 },
    ],
    [],
    [{ id: 7, expression: "AB = 4", enabled: true, color: "#000" }],
    [
      {
        id: 8,
        expression: "distance(line(AB), circle(CD)) = ?",
        enabled: true,
        color: "#000",
      },
    ],
    1e-6,
    "degrees",
    100,
    500,
  );
  assert.equal(objectDistance.result.kind, "exact");
  assert.ok(Math.abs(objectDistance.result.values[0].value - 2) < 1e-9);

  const repeatedVariable = solveNumerically(
    [
      { id: "A", x: 0, y: 0 },
      { id: "B", x: 3, y: 0 },
      { id: "C", x: 0, y: 0 },
      { id: "D", x: 0, y: 4 },
      { id: "E", x: 0, y: 0 },
      { id: "F", x: 5, y: 0 },
    ],
    [],
    [
      { id: 9, expression: "AB = 3", enabled: true, color: "#000" },
      { id: 10, expression: "a = AB", enabled: true, color: "#000" },
      { id: 11, expression: "a = CD", enabled: true, color: "#000" },
      { id: 12, expression: "a = EF", enabled: true, color: "#000" },
    ],
    [
      { id: 13, expression: "CD = ?", enabled: true, color: "#000" },
      { id: 14, expression: "EF = ?", enabled: true, color: "#000" },
    ],
    1e-6,
    "degrees",
    600,
    1500,
  );
  assert.equal(repeatedVariable.result.kind, "exact");
  repeatedVariable.result.values.forEach(({ value }) => {
    assert.ok(Math.abs(value - 3) < 1e-5, `unexpected repeated value: ${value}`);
  });
});

test("solves self-intersecting Doc Oct without a scale runaway", async () => {
  const fixture = JSON.parse(
    await readFile(new URL("./fixtures/doc-oct.json", import.meta.url), "utf8"),
  );
  const { solveNumerically } = await loadLocalModule();
  const solved = solveNumerically(
    fixture.points,
    fixture.shapes,
    fixture.known,
    fixture.unknown,
    Number(fixture.solverEpsilon),
    "degrees",
    Number(fixture.solverMaxIterations),
    Number(fixture.solverTimeLimitMs),
  );
  assert.equal(solved.result.kind, "exact");
  assert.ok(solved.result.residual < 1e-6);
  assert.ok(solved.result.iterations < 100);
  assert.ok(
    Math.max(...solved.points.flatMap(({ x, y }) => [Math.abs(x), Math.abs(y)])) <
      100,
    "the drawing must not explode towards infinity",
  );
  assert.ok(Math.abs(solved.result.values[0].value - 64) < 1e-5);
  assert.ok(Math.abs(solved.result.values[1].value - 64) < 1e-5);
});

test("measures figure intersection area and containment by overlap", async () => {
  const { solveNumerically } = await loadLocalModule();
  const points = [
    { id: "A", x: 0, y: 0 },
    { id: "B", x: 2, y: 0 },
    { id: "C", x: 2, y: 2 },
    { id: "D", x: 0, y: 2 },
    { id: "E", x: 1, y: 0 },
    { id: "F", x: 3, y: 0 },
    { id: "G", x: 3, y: 2 },
    { id: "H", x: 1, y: 2 },
  ];
  const known = points.map((point, index) => ({
    id: index + 1,
    expression: `${point.id} = (${point.x}; ${point.y})`,
    enabled: true,
    color: "#000000",
  }));
  const solved = solveNumerically(
    points,
    [],
    known,
    [
      {
        id: 20,
        expression: "S(ABCD ∩ EFGH) = ?",
        enabled: true,
        color: "#000000",
      },
    ],
    1e-6,
    "degrees",
    100,
    500,
  );
  assert.equal(solved.result.kind, "exact");
  assert.ok(Math.abs(solved.result.values[0].value - 2) < 1e-9);

  const {
    geometryContainmentResidual,
    geometryIntersectionArea,
    polygonArea,
  } =
    await loadLocalModule("geometry");
  assert.equal(
    polygonArea([
      { id: "A", x: 0, y: 0 },
      { id: "B", x: 2, y: 2 },
      { id: "C", x: 0, y: 2 },
      { id: "D", x: 2, y: 0 },
    ]),
    2,
    "a bow-tie polygon uses its filled area instead of cancelling its lobes",
  );
  const inner = points.slice(0, 4).map((point) => ({
    ...point,
    x: point.x / 2,
    y: point.y / 2,
  }));
  const outer = [
    { id: "E", x: -1, y: -1 },
    { id: "F", x: 2, y: -1 },
    { id: "G", x: 2, y: 2 },
    { id: "H", x: -1, y: 2 },
  ];
  assert.equal(
    geometryContainmentResidual("polygon", inner, "polygon", outer),
    0,
  );
  assert.equal(
    geometryIntersectionArea(
      "polygon",
      points.slice(0, 4),
      "polygon",
      points.slice(4),
    ),
    2,
  );
  const circleOverlap = geometryIntersectionArea(
    "circle",
    [
      { id: "A", x: 0, y: 0 },
      { id: "B", x: 1, y: 0 },
    ],
    "circle",
    [
      { id: "C", x: 1, y: 0 },
      { id: "D", x: 2, y: 0 },
    ],
  );
  assert.ok(
    Math.abs(circleOverlap - (2 * Math.PI) / 3 + Math.sqrt(3) / 2) <
      1e-12,
  );
});

test("parses and enforces point containment", async () => {
  const { parseConstraint, solveNumerically } = await loadLocalModule(
    "expressions",
  );
  const { pointInPolygon } = await loadLocalModule("geometry");
  assert.deepEqual(parseConstraint("A ∈ BCD"), {
    kind: "insideFigure",
    ids: ["A", "B", "C", "D"],
    containment: {
      inner: { kind: "point", ids: ["A"] },
      outer: { kind: "polygon", ids: ["B", "C", "D"] },
    },
    source: "A ∈ BCD",
  });
  assert.equal(
    parseConstraint("point(A) ∈ circle(BC)")?.containment?.inner.kind,
    "point",
  );
  const row = (id, expression) => ({
    id,
    expression,
    enabled: true,
    color: "#000000",
  });
  const solved = solveNumerically(
    [
      { id: "A", x: 6, y: 6 },
      { id: "B", x: 0, y: 0 },
      { id: "C", x: 4, y: 0 },
      { id: "D", x: 0, y: 4 },
    ],
    [{ id: "triangle", type: "polygon", points: ["B", "C", "D"], color: "#000" }],
    [
      row(1, "B = (0, 0)"),
      row(2, "C = (4, 0)"),
      row(3, "D = (0, 4)"),
      row(4, "A ∈ BCD"),
    ],
    [],
    1e-6,
    "degrees",
    1000,
    1500,
  );
  const map = new Map(solved.points.map((point) => [point.id, point]));
  assert.ok(
    pointInPolygon(map.get("A"), [map.get("B"), map.get("C"), map.get("D")]),
  );
});

test("distinguishes exact intersection sets from membership", async () => {
  const { solveNumerically } = await loadLocalModule();
  const points = [
    { id: "A", x: -2, y: 0 },
    { id: "B", x: 2, y: 0 },
    { id: "C", x: 0, y: 0 },
    { id: "D", x: 1, y: 0 },
    { id: "E", x: -1, y: 0 },
    { id: "F", x: 1, y: 0 },
  ];
  const coordinates = points.map((point, index) => ({
    id: index + 1,
    expression: `${point.id} = (${point.x}; ${point.y})`,
    enabled: true,
    color: "#000000",
  }));
  const solveWith = (expression) =>
    solveNumerically(
      points,
      [],
      [
        ...coordinates,
        { id: 20, expression, enabled: true, color: "#000000" },
      ],
      [],
      1e-6,
      "degrees",
      20,
      500,
    );
  assert.equal(
    solveWith("{E, F} = line(AB) ∩ circle(CD)").result.kind,
    "exact",
  );
  assert.equal(
    solveWith("E ∈ line(AB) ∩ circle(CD)").result.kind,
    "exact",
  );
  assert.equal(
    solveWith("E = line(AB) ∩ circle(CD)").result.kind,
    "approximate",
  );
});

test("migrates legacy intersections and sector directions", async () => {
  const {
    CURRENT_PROJECT_FORMAT_VERSION,
    migrateLegacyInsideExpression,
    migrateLegacyIntersectionExpression,
    migrateLegacySectorDirections,
  } = await loadLocalModule("project-migrations");
  const { parseImportedProject } = await loadLocalModule("project-state");
  assert.equal(CURRENT_PROJECT_FORMAT_VERSION, 7);
  assert.equal(
    migrateLegacyInsideExpression("inside(circle(AB), CDE)"),
    "circle(AB) ∈ CDE",
  );
  assert.equal(
    migrateLegacyIntersectionExpression("H = EG ∩ DF"),
    "H ∈ EG ∩ DF",
  );
  assert.equal(
    migrateLegacyIntersectionExpression("AB ∩ CD = ∅"),
    "AB ∩ CD = ∅",
  );
  const legacyProject = {
    format: "geosolver",
    version: 1,
    projectTitle: "Legacy intersection",
    points: "ABCDEFGH".split("").map((id, index) => ({
      id,
      x: index,
      y: index % 2,
    })),
    shapes: [],
    known: [
      {
        id: 1,
        expression: "H = EG ∩ DF",
        enabled: true,
        color: "#000000",
      },
    ],
    unknown: [],
  };
  const migrated = parseImportedProject(JSON.stringify(legacyProject));
  assert.equal(migrated.snapshot.known[0].expression, "H ∈ EG ∩ DF");
  assert.deepEqual(
    migrated.snapshot.points.map((point) => point.editorOrder),
    [...Array(migrated.snapshot.points.length).keys()],
  );
  const formatTwo = parseImportedProject(
    JSON.stringify({
      ...legacyProject,
      version: 2,
      known: [
        {
          ...legacyProject.known[0],
          expression: "H = EG ∩ DF",
        },
      ],
    }),
  );
  assert.equal(formatTwo.snapshot.known[0].expression, "H = EG ∩ DF");
  assert.equal(formatTwo.solverMode, "numerical");
  const formatSix = parseImportedProject(
    JSON.stringify({
      ...legacyProject,
      version: 6,
      shapes: [
        {
          id: "legacy-equation",
          type: "equationLine",
          points: [],
          color: "#000000",
          name: "f1",
          equation: "y = 0",
        },
      ],
      known: [
        {
          ...legacyProject.known[0],
          expression: "inside(ABC, DEFG)",
        },
      ],
    }),
  );
  assert.equal(formatSix.snapshot.shapes[0].type, "equation");
  assert.equal(formatSix.snapshot.known[0].expression, "ABC ∈ DEFG");
  const current = parseImportedProject(
    JSON.stringify({
      ...legacyProject,
      version: 3,
      solverMode: "analytic",
      known: [
        {
          ...legacyProject.known[0],
          expression: "H = EG ∩ DF",
        },
      ],
    }),
  );
  assert.equal(current.snapshot.known[0].expression, "H = EG ∩ DF");
  assert.equal(current.solverMode, "analytic");
  const oldSectors = parseImportedProject(
    JSON.stringify({
      ...legacyProject,
      version: 3,
      points: [
        { id: "O", x: 0, y: 0 },
        { id: "A", x: 1, y: 0 },
        { id: "B", x: 0, y: 1 },
      ],
      shapes: [
        {
          id: "minor",
          type: "sector",
          points: ["O", "A", "B"],
          color: "#000000",
          arc: "minor",
        },
        {
          id: "major",
          type: "sector",
          points: ["O", "A", "B"],
          color: "#000000",
          arc: "major",
        },
      ],
      known: [],
    }),
  );
  assert.deepEqual(oldSectors.snapshot.shapes[0].points, ["O", "B", "A"]);
  assert.equal(oldSectors.snapshot.shapes[0].arc, "clockwise");
  assert.deepEqual(oldSectors.snapshot.shapes[1].points, ["O", "A", "B"]);
  assert.equal(oldSectors.snapshot.shapes[1].arc, "clockwise");
  const renamedArc = migrateLegacySectorDirections({
    version: 3,
    points: [
      { id: "O", x: 0, y: 0 },
      { id: "A", x: 1, y: 0 },
      { id: "B", x: 0, y: 1 },
    ],
    shapes: [
      {
        id: "sector",
        type: "sector",
        points: ["O", "A", "B"],
        color: "#000000",
        arc: "minor",
      },
    ],
    known: [
      { id: 1, expression: "G ∈ arc(OAB)", enabled: true, color: "#000000" },
    ],
    unknown: [
      { id: 2, expression: "S(sector(OAB))", enabled: true, color: "#000000" },
    ],
  });
  assert.equal(renamedArc.known[0].expression, "G ∈ arc(OBA)");
  assert.equal(renamedArc.unknown[0].expression, "S(sector(OBA))");
  const versionless = { ...legacyProject };
  delete versionless.version;
  assert.equal(
    parseImportedProject(JSON.stringify(versionless)).snapshot.known[0]
      .expression,
    "H ∈ EG ∩ DF",
  );
});

test("imports every project exposed by the help examples", async () => {
  const { parseImportedProject } = await loadLocalModule("project-state");
  const names = [
    "right-triangle",
    "square-area",
    "major-sector",
    "quarter-circle-perpendiculars",
    "rectangle-diagonal-angle",
    "overturned-square",
    "doc-oct",
    "tangent-circles-25",
    "triangle-altitudes-24",
    "equilateral-circle-26",
    "green-vs-blue",
    "semicircle-turducken",
    "two-circles-tale",
    "washing-machine",
    "one-fact",
    "all-in-square",
    "isosceles-everywhere",
    "t1-angle-sum",
    "isosceles-altitude",
    "median-area-t2",
    "inconsistent-altitude-t3",
    "right-triangle-altitude-t4",
    "intersecting-sectors-t5",
    "task-t", "t18", "t17", "t16", "t15", "t14", "t13",
    "runaway-polygon", "t12", "t11", "this-is-a-trap", "power-chords",
    "all-born-equal", "beautiful-haircut", "sunset-square-city", "t19",
  ];
  const projects = await Promise.all(
    names.map(async (name) =>
      parseImportedProject(
        await readFile(
          new URL(`../public/examples/${name}.json`, import.meta.url),
          "utf8",
        ),
      ),
    ),
  );
  assert.equal(projects.length, names.length);
  projects.forEach((project) => assert.ok(project.projectTitle));
  const quarterCircle = projects[names.indexOf("quarter-circle-perpendiculars")];
  assert.ok(
    quarterCircle.snapshot.known.some(
      (row) => row.expression === "E ∈ arc(ABC)",
    ),
  );
  assert.ok(
    quarterCircle.snapshot.known.some(
      (row) => row.expression === "G ∈ arc(ABC)",
    ),
  );
});

test("analytical solver covers every analytically solvable bundled example", async () => {
  const { solveAnalytically } = await loadLocalModule("analytic-solver");
  const expected = new Map([
    ["right-triangle", { values: ["5"], completed: 1 }],
    ["square-area", { values: ["36", "24"], completed: 2 }],
    ["major-sector", { values: ["32*pi/3"], completed: 1 }],
    ["quarter-circle-perpendiculars", { values: ["3"], completed: 1 }],
    [
      "rectangle-diagonal-angle",
      {
        values: ["sqrt(10 + 2*sqrt(5))", "-1 + sqrt(5)"],
        completed: 2,
      },
    ],
    ["overturned-square", { values: ["135"], completed: 1 }],
    ["doc-oct", { values: ["64", "64"], completed: 2 }],
    ["tangent-circles-25", { values: ["4*sqrt(14)"], completed: 1 }],
    ["triangle-altitudes-24", { values: ["3", "1"], completed: 2 }],
    ["equilateral-circle-26", { values: ["0"], completed: 1 }],
    ["green-vs-blue", { values: ["5"], completed: 1 }],
    ["semicircle-turducken", { values: ["45"], completed: 1 }],
    ["two-circles-tale", { values: ["4/9", "9/4"], completed: 2 }],
    ["washing-machine", { values: ["2/5"], completed: 1 }],
    ["one-fact", { values: ["16"], completed: 1 }],
    ["all-in-square", { values: ["4*pi"], completed: 1 }],
    ["isosceles-everywhere", { values: ["108"], completed: 1 }],
    ["t1-angle-sum", { values: ["40"], completed: 1 }],
    ["isosceles-altitude", { values: ["7"], completed: 1 }],
    ["median-area-t2", { values: ["24"], completed: 1 }],
    [
      "right-triangle-altitude-t4",
      { values: ["25/13", "144/13"], completed: 2 },
    ],
    ["intersecting-sectors-t5", { values: ["45"], completed: 1 }],
    ["orthogonal-circle-t6", { values: ["sqrt(34)/2"], completed: 1 }],
    ["exterior-angle-t7", { values: ["130"], completed: 1 }],
    ["similar-triangles-t8", { values: ["15"], completed: 1 }],
    [
      "scalene-triangle-t9",
      {
        values: [
          "180*acos(-1/4)/pi",
          "180*acos(7/8)/pi",
          "180*acos(11/16)/pi",
        ],
        completed: 3,
      },
    ],
    ["isosceles-trapezoid-t10", { values: ["60", "120"], completed: 2 }],
  ]);
  for (const [name, expectation] of expected) {
    const project = JSON.parse(
      await readFile(
        new URL(`../public/examples/${name}.json`, import.meta.url),
        "utf8",
      ),
    );
    const solved = solveAnalytically(
      project.points,
      project.shapes,
      project.known,
      project.unknown,
      "degrees",
      1e-6,
      name === "intersecting-sectors-t5" ? 1200 : 250,
      name === "intersecting-sectors-t5" ? 2500 : 350,
    );
    assert.deepEqual(
      solved.result.values.map((value) => value.exact),
      expectation.values,
      `unexpected exact result for ${name}`,
    );
    assert.equal(solved.result.goalSummary.total, project.unknown.length);
    assert.equal(solved.result.goalSummary.completed, expectation.completed);
    assert.equal(
      solved.result.goalSummary.unresolved.length,
      project.unknown.length - expectation.completed,
    );
    const stepExpressions = (solved.result.steps ?? [])
      .map((step) => step.expression)
      .filter(Boolean);
    if (name === "doc-oct") {
      assert.ok(stepExpressions.includes("S(ABED) = AB^2"));
      assert.ok(stepExpressions.includes("P(ABCDEFGH) = S(ABED) = 64"));
    }
    if (name === "tangent-circles-25") {
      assert.ok(stepExpressions.includes("EA = AB - EF"));
      assert.ok(
        stepExpressions.includes(
          "h(A,NQ) = (AE*CO + AC*EP)/CE = (3*3 + 6*6)/9 = 5",
        ),
      );
      assert.ok(
        stepExpressions.includes(
          "(NQ/2)^2 = 9^2 - 5^2 = 56\nNQ/2 = sqrt(56) = 2*sqrt(14)\nNQ = 2*2*sqrt(14) = 4*sqrt(14)",
        ),
      );
      assert.ok(
        stepExpressions.every((expression) => !expression.includes("радиусов")),
      );
    }
    if (name === "equilateral-circle-26") {
      assert.ok(
        stepExpressions.includes(
          "x^2 + y^2 + sqrt(3)*a*y - a^2/4 = 0",
        ),
      );
      assert.ok(
        stepExpressions.includes(
          "MB^2+MC^2-MA^2 = x^2+y^2+sqrt(3)*a*y-a^2/4 = 0",
        ),
      );
    }
    if (name === "all-in-square") {
      assert.deepEqual(
        solved.result.values[0].alternatives?.map((value) => value.exact),
        ["144*pi"],
      );
      assert.ok(
        stepExpressions.includes(
          "r=2 or r=12; S(circle(IJ))=4*pi or 144*pi",
        ),
      );
    }
  }
});

test("analytical solver covers the newly bundled theorem examples", async () => {
  const { solveAnalytically } = await loadLocalModule("analytic-solver");
  const expected = new Map([
    ["task-t", [4.5]],
    ["t17", [0]],
    ["t16", [180]],
    ["t15", [0, 0]],
    ["t14", [(3 * Math.sqrt(3)) / (4 * Math.PI)]],
    ["t13", [(Math.sqrt(3) - 1) / 4]],
    ["runaway-polygon", [2 / 3]],
    ["t12", [8, 18]],
    ["t11", [
      Math.sin((40 * Math.PI) / 180) / Math.sin((80 * Math.PI) / 180),
      Math.sin((60 * Math.PI) / 180) / Math.sin((80 * Math.PI) / 180),
    ]],
    ["this-is-a-trap", [5]],
    ["power-chords", [(205 * Math.PI) / 4]],
    ["all-born-equal", [15]],
    ["beautiful-haircut", [10]],
    ["sunset-square-city", [8]],
    ["t19", [0]],
  ]);
  for (const [name, values] of expected) {
    const project = JSON.parse(
      await readFile(
        new URL(`../public/examples/${name}.json`, import.meta.url),
        "utf8",
      ),
    );
    const solved = solveAnalytically(
      project.points, project.shapes, project.known, project.unknown,
      "degrees", 1e-6, 300, 500, false,
    );
    assert.equal(
      solved.result.goalSummary.completed,
      values.length,
      `${name}: ${JSON.stringify(solved.result.goalSummary)}`,
    );
    assert.equal(solved.result.values.length, values.length, name);
    solved.result.values.forEach((value, index) => {
      assert.ok(
        Math.abs(value.value - values[index]) < 1e-9,
        `${name}[${index}]: ${value.value} != ${values[index]}`,
      );
    });
  }
});

test("solves circle tangencies against square sides", async () => {
  const { solveNumerically } = await loadLocalModule("expressions");
  const project = JSON.parse(
    await readFile(
      new URL("../public/examples/all-in-square.json", import.meta.url),
      "utf8",
    ),
  );
  const solved = solveNumerically(
    project.points,
    project.shapes,
    project.known,
    project.unknown,
    1e-6,
    "degrees",
    2200,
    4000,
  );
  const map = new Map(solved.points.map((point) => [point.id, point]));
  const radius = Math.hypot(
    map.get("I").x - map.get("J").x,
    map.get("I").y - map.get("J").y,
  );
  assert.ok(solved.result.residual < 1e-4, solved.result.residual);
  assert.ok(Math.abs(radius - 2) < 1e-3, radius);
  assert.ok(
    Math.abs(solved.result.values[0].value - 4 * Math.PI) < 1e-2,
    solved.result.values[0].value,
  );
});

test("does not claim the 26 invariant without separating A and O", async () => {
  const { solveAnalytically } = await loadLocalModule("analytic-solver");
  const project = JSON.parse(
    await readFile(
      new URL(
        "../public/examples/equilateral-circle-26.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const known = project.known.filter(
    (row) => row.expression !== "distinct(AO)",
  );
  const solved = solveAnalytically(
    project.points,
    project.shapes,
    known,
    project.unknown,
    "degrees",
    1e-6,
    250,
    350,
  );
  assert.deepEqual(solved.result.values, []);
  assert.equal(solved.result.goalSummary.completed, 0);
});

test("numerically solves the fully constrained 26 example", async () => {
  const { solveNumerically } = await loadLocalModule("expressions");
  const project = JSON.parse(
    await readFile(
      new URL(
        "../public/examples/equilateral-circle-26.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const solved = solveNumerically(
    project.points,
    project.shapes,
    project.known,
    project.unknown,
    1e-6,
    "degrees",
    1600,
    2500,
  );
  assert.ok(solved.result.residual < 1e-5, solved.result.residual);
  assert.ok(
    Math.abs(solved.result.values[0].value) < 1e-4,
    solved.result.values[0].value,
  );
});

test("anchors the 24 construction at H = (0, 0)", async () => {
  const { solveAnalytically } = await loadLocalModule("analytic-solver");
  const { solveNumerically } = await loadLocalModule("expressions");
  const { parseImportedProject } = await loadLocalModule("project-state");
  const project = parseImportedProject(
    await readFile(
      new URL("../public/examples/triangle-altitudes-24.json", import.meta.url),
      "utf8",
    ),
  );
  const known = [
    ...project.snapshot.known,
    { id: 999999, expression: "H = (0; 0)", enabled: true, color: "#000" },
  ];
  const numerical = solveNumerically(
    project.snapshot.points,
    project.snapshot.shapes,
    known,
    project.snapshot.unknown,
    1e-6,
    "degrees",
    1600,
    3000,
  );
  const numericalH = numerical.points.find((point) => point.id === "H");
  assert.ok(
    Math.hypot(numericalH.x, numericalH.y) < 1e-5,
    JSON.stringify({ h: numericalH, residual: numerical.result.residual }),
  );
  assert.ok(numerical.result.residual < 1e-4, numerical.result.residual);

  const analytic = solveAnalytically(
    project.snapshot.points,
    project.snapshot.shapes,
    known,
    project.snapshot.unknown,
    "degrees",
    1e-6,
    1600,
    3000,
  );
  assert.deepEqual(
    analytic.result.values.map((value) => value.exact),
    ["3", "1"],
  );
  const analyticH = analytic.points.find((point) => point.id === "H");
  assert.ok(Math.hypot(analyticH.x, analyticH.y) < 1e-5);
});

test("uses the chord midpoint and selected arc in Only one fact", async () => {
  const { solveNumerically } = await loadLocalModule("expressions");
  const project = JSON.parse(
    await readFile(
      new URL("../public/examples/one-fact.json", import.meta.url),
      "utf8",
    ),
  );
  const solved = solveNumerically(
    project.points,
    project.shapes,
    project.known,
    project.unknown,
    1e-6,
    "degrees",
    2400,
    4000,
  );
  assert.ok(solved.result.residual < 1e-4, solved.result.residual);
  assert.ok(
    Math.abs(solved.result.values[0].value - 16) < 1e-2,
    solved.result.values[0].value,
  );
});

test("solves the tangent-circle project 25 accurately", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL("./fixtures/tangent-circles-25.json", import.meta.url),
      "utf8",
    ),
  );
  const { solveNumerically } = await loadLocalModule();
  const solved = solveNumerically(
    fixture.points,
    fixture.shapes,
    fixture.known,
    fixture.unknown,
    Number(fixture.solverEpsilon),
    "degrees",
    Number(fixture.solverMaxIterations),
    Number(fixture.solverTimeLimitMs),
  );
  assert.equal(solved.result.kind, "exact");
  assert.ok(solved.result.residual < 1e-7);
  assert.ok(solved.result.iterations <= Number(fixture.solverMaxIterations));
  assert.ok(
    Math.abs(solved.result.values[0].value - 4 * Math.sqrt(14)) < 1e-5,
    `unexpected tangent chord: ${solved.result.values[0].value}`,
  );
});

test("converges for three mutually tangent circles inside a larger circle", async () => {
  const { solveNumerically } = await loadLocalModule();
  const points = [
    { id: "A", x: -2.4412083200671497, y: -0.05315954740262043 },
    { id: "B", x: -0.6748339895793395, y: -1.8583562263429352 },
    { id: "C", x: -1.5758722746394223, y: -0.706118206466386 },
    { id: "D", x: -0.3826839484681536, y: -1.515517583411662 },
    { id: "E", x: -1.656754544162852, y: -0.7819828302962958 },
    { id: "F", x: -0.7296446694056163, y: -1.7623990713643816 },
    { id: "G", x: -1.5114397806398827, y: -0.6158638781378329 },
    { id: "H", x: -0.1731330132615062, y: -1.3622575391490714 },
    { id: "I", x: -2.409448512517331, y: -1.864588700762274 },
    { id: "J", x: -2.634154497928616, y: -1.6934974702571497 },
    { id: "K", x: -2.523418359268405, y: -1.7849833992655537 },
  ];
  const shapes = [
    { id: "outer", type: "circle", points: ["A", "B"], color: "#000" },
    { id: "one", type: "circle", points: ["C", "D"], color: "#000" },
    { id: "two", type: "circle", points: ["E", "F"], color: "#000" },
    { id: "three", type: "circle", points: ["G", "H"], color: "#000" },
  ];
  const expressions = [
    "I = circle(CD) ∩ circle(GH)",
    "J = circle(EF) ∩ circle(CD)",
    "K = circle(EF) ∩ circle(GH)",
    "D = circle(AB) ∩ circle(CD)",
    "F = circle(AB) ∩ circle(EF)",
    "H = circle(AB) ∩ circle(GH)",
    "AC = AE = AG = 1",
    "distinct(AECG)",
    "circle(CD) ∈ circle(AB)",
    "circle(EF) ∈ circle(AB)",
    "circle(GH) ∈ circle(AB)",
  ];
  const known = expressions.map((expression, index) => ({
    id: index + 1,
    expression,
    enabled: true,
    color: "#000",
  }));
  const solved = solveNumerically(
    points,
    shapes,
    known,
    [{ id: 100, expression: "AB = ?", enabled: true, color: "#000" }],
    1e-6,
    "degrees",
    1200,
    2500,
  );
  assert.equal(solved.result.kind, "exact");
  assert.ok(solved.result.residual < 1e-7, solved.result.residual);
  assert.ok(
    Math.abs(solved.result.values[0].value - (1 + Math.sqrt(3) / 2)) < 1e-6,
    solved.result.values[0].value,
  );
});

test("keeps fully specified coordinate anchors fixed during numerical search", async () => {
  const { solveNumerically } = await loadLocalModule();
  const points = [
    { id: "A", x: 0.004, y: 3.336 },
    { id: "B", x: 1.171, y: 1.47 },
    { id: "C", x: 1, y: 2 },
  ];
  const known = ["C ∈ AB", "C = (1; 2)", "A = (0; 0)"].map(
    (expression, index) => ({
      id: index + 1,
      expression,
      enabled: true,
      color: "#000",
    }),
  );
  const unknown = ["x(B) = ?", "y(B) = ?"].map((expression, index) => ({
    id: index + 10,
    expression,
    enabled: true,
    color: "#000",
  }));
  const solved = solveNumerically(
    points,
    [{ id: "AB", type: "segment", points: ["A", "B"], color: "#000" }],
    known,
    unknown,
    1e-6,
    "degrees",
    1200,
    2500,
  );
  assert.equal(solved.result.kind, "exact");
  assert.ok(solved.result.residual < 1e-7, solved.result.residual);
  assert.deepEqual(solved.points.find((point) => point.id === "A"), {
    id: "A",
    x: 0,
    y: 0,
  });
  assert.deepEqual(solved.points.find((point) => point.id === "C"), {
    id: "C",
    x: 1,
    y: 2,
  });
});

test("derives all available two-triangle targets and does not fake numerical convergence", async () => {
  const { solveNumerically } = await loadLocalModule();
  const { solveAnalytically } = await loadLocalModule("analytic-solver");
  const points = [
    { id: "A", x: -5.069, y: -3.615 },
    { id: "B", x: -4.568, y: -0.657 },
    { id: "C", x: -0.344, y: -1.373 },
    { id: "D", x: 2.805, y: 1.124 },
    { id: "E", x: 4.665, y: -1.221 },
  ];
  const known = [
    "distinct(ABC)",
    "distinct(CDE)",
    "∠ABC = 90°",
    "∠CDE = 90°",
    "∠BAC = 55°",
    "∠DCE = 35°",
    "AB = 3",
    "CE = 5",
    "DE = 3",
  ].map((expression, index) => ({
    id: index + 1,
    expression,
    enabled: true,
    color: "#000",
  }));
  const unknown = ["∠ACB = ?", "AC = ?", "CD = ?"].map(
    (expression, index) => ({
      id: index + 20,
      expression,
      enabled: true,
      color: "#000",
    }),
  );
  const analytic = solveAnalytically(
    points,
    [],
    known,
    unknown,
    "degrees",
    1e-6,
    1200,
    2500,
  );
  assert.equal(analytic.result.goalSummary.completed, 3);
  assert.deepEqual(
    analytic.result.values.map((value) => value.exact),
    ["35", "3/cos(55*pi/180)", "4"],
  );

  const numerical = solveNumerically(
    points,
    [],
    known,
    unknown,
    1e-6,
    "degrees",
    1200,
    2500,
  );
  assert.equal(numerical.result.kind, "approximate");
  assert.ok(Number.isFinite(numerical.result.residual));
  assert.ok(numerical.result.residual < 0.01, numerical.result.residual);
  numerical.points.forEach((point) => {
    assert.ok(Number.isFinite(point.x));
    assert.ok(Number.isFinite(point.y));
    assert.ok(Math.abs(point.x) < 100 && Math.abs(point.y) < 100);
  });
});

test("keeps proven targets stable and reports drawing accuracy after a shuffle", async () => {
  const project = JSON.parse(
    await readFile(
      new URL("../public/examples/washing-machine.json", import.meta.url),
      "utf8",
    ),
  );
  const coordinates = [
    ["A", 6.5215, 5.0811], ["B", -0.6121, 6.8752], ["C", -4.9974, 0.1646],
    ["D", 2.3592, -2.1], ["E", 4.4371, 1.5637], ["F", 0.603, -1.2827],
    ["G", 5.5395, 5.9484], ["H", -0.0775, 4.5128], ["I", 2.3679, -2.5636],
    ["J", -0.1061, 0.0534], ["K", -0.1245, 0.4636], ["L", -0.5342, 0.4461],
    ["M", -0.5159, 0.0359], ["N", -0.5316, 0.4469], ["O", 0.7867, -1.5511],
    ["P", -0.4379, 0.5216], ["Q", 0.9319, -1.44], ["R", -0.3045, 0.5656],
    ["S", 0.7727, -1.5231], ["T", -0.4125, 0.5134], ["U", 0.9257, -1.4309],
    ["V", 0.4617, -1.05], ["W", 0.5042, -1.4678], ["X", 0.9225, -1.4279],
    ["Y", 0.8798, -1.0099],
  ];
  project.points = coordinates.map(([id, x, y]) => ({ id, x, y }));
  project.known = project.known.map((row) => ({
    ...row,
    expression: row.expression.replace(
      /^([FGHI])\s*=\s*(circle\(EF\)\s*∩)/i,
      "$1 ∈ $2",
    ),
  }));
  const { solveAnalytically } = await loadLocalModule("analytic-solver");
  const { solveNumerically } = await loadLocalModule();
  const analytic = solveAnalytically(
    project.points, project.shapes, project.known, project.unknown,
    "degrees", 1e-6, 1200, 2500, false,
  );
  const hints = Object.fromEntries(
    analytic.result.values.map((value) => [value.label, value.value]),
  );
  const solved = solveNumerically(
    project.points, project.shapes, project.known, project.unknown,
    1e-6, "degrees", 1200, 2500, hints,
  );
  assert.equal(solved.result.kind, "exact");
  assert.equal(solved.result.drawing.status, "approximate");
  assert.ok(Math.abs(solved.result.values[0].value - 2 / 5) < 1e-12);
  assert.ok(solved.result.residual < 0.00001, solved.result.residual);
});

test("keeps the overturned-square area stable after a failed drawing shuffle", async () => {
  const project = JSON.parse(
    await readFile(
      new URL("../public/examples/overturned-square.json", import.meta.url),
      "utf8",
    ),
  );
  const coordinates = [
    ["A", 2.8373, -5.6892], ["B", -4.9039, 2.9556], ["C", 2.7326, -5.7499],
    ["D", -4.3172, 3.4423], ["E", -0.4311, -1.4263], ["F", 3.0074, -5.6902],
    ["G", -1.8051, 1.8386], ["H", 2.9616, -2.157], ["I", 2.3884, -5.5758],
    ["J", -0.9921, -4.8231], ["K", -6.3015, -1.1085], ["L", -2.0804, -4.6611],
    ["M", 2.9291, -2.1986], ["N", -2.4795, 3.1819], ["O", -4.729, 3.0254],
    ["P", 1.5219, -4.0576], ["Q", -3.7071, 3.7556], ["R", 2.0065, -3.728],
    ["S", -2419.095, 967.8401], ["T", 1826.8949, -739.2329],
  ];
  project.points = coordinates.map(([id, x, y]) => ({ id, x, y }));
  const { solveAnalytically } = await loadLocalModule("analytic-solver");
  const { solveNumerically } = await loadLocalModule();
  const analytic = solveAnalytically(
    project.points, project.shapes, project.known, project.unknown,
    "degrees", 1e-6, 1200, 2500, false,
  );
  const hints = Object.fromEntries(
    analytic.result.values.map((value) => [value.label, value.value]),
  );
  const solved = solveNumerically(
    project.points, project.shapes, project.known, project.unknown,
    1e-6, "degrees", 1200, 2500, hints,
  );
  assert.equal(solved.result.kind, "exact");
  assert.equal(solved.result.drawing.status, "rebuilt");
  assert.equal(solved.result.values[0].value, 135);
  assert.ok(solved.result.residual < 1e-6, solved.result.residual);
  solved.points.forEach((point) => {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  });
});
