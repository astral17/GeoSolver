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
];

async function loadExpressionModule() {
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

  return load("expressions");
}

test("solves the overturned-square regression fixture", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL("./fixtures/overturned-square.json", import.meta.url),
      "utf8",
    ),
  );
  const { parseConstraint, solveNumerically, trimNumber } =
    await loadExpressionModule();
  assert.deepEqual(parseConstraint("P ∈ arc(OAB)"), {
    kind: "onArc",
    ids: ["P", "O", "A", "B"],
    source: "P ∈ arc(OAB)",
  });
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
});
