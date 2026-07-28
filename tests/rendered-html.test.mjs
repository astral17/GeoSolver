import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function getRenderedPath() {
  const isPagesBuild =
    process.env.GITHUB_PAGES === "true" ||
    process.env.npm_lifecycle_event === "build:pages";

  if (!isPagesBuild) {
    return "/";
  }

  const explicitBasePath = process.env.PAGES_BASE_PATH?.trim();
  if (explicitBasePath) {
    return `/${explicitBasePath.replace(/^\/+|\/+$/g, "")}/`;
  }

  const [repositoryOwner = "", repositoryName = ""] = (
    process.env.GITHUB_REPOSITORY ?? ""
  ).split("/");
  const isUserSite =
    repositoryName.toLowerCase() ===
    `${repositoryOwner.toLowerCase()}.github.io`;

  return repositoryName && !isUserSite ? `/${repositoryName}/` : "/";
}

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(new URL(getRenderedPath(), "http://localhost"), {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders GeoSolver shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>GeoSolver/);
  assert.match(html, /geo/);
  assert.match(html, /solver/);
  assert.match(html, /Что известно/);
  assert.match(html, /Многоугольник/);
  assert.match(html, /Shift\+Enter/);
  assert.match(html, /Переместить · V/);
  assert.match(html, /Выделить область · B/);
  assert.match(html, /Треугольники · T/);
  assert.match(html, /Окружности · C/);
  assert.match(html, /Четырёхугольники · 4/);
  assert.match(html, /Измерить площадь · Q/);
  assert.match(html, /x\(A\) = 2/);
  assert.match(html, /A = \(2, -1\)/);
  assert.match(html, /S\(ABCD\) = \?/);
  assert.match(html, /AB = BC = CD/);
  assert.match(html, /help-button/);
  assert.match(html, /<em>Справка<\/em>/);
  assert.doesNotMatch(html, /6\.403/);
  assert.match(html, /\\angle/);
  assert.match(html, /mobile-panel-tabs/);
  assert.match(html, /mobile-panel-canvas/);
  assert.doesNotMatch(html, /theme-toggle/);
  assert.match(html, /geosolver-theme/);
  assert.match(html, /id="known-expression-1"/);
  assert.match(html, /name="known-expression-1"/);
  assert.match(html, /data-expression-row="1"/);
  assert.match(html, /id="unknown-expression-\d+"/);
  assert.match(html, /settings-button/);
  assert.match(html, /aria-controls="settings-panel"/);
  assert.match(html, /id="project-title"/);
  assert.match(html, /name="project-title"/);
  assert.match(html, /id="project-import"/);
  assert.match(html, /accept="\.json,application\/json"/);
  assert.match(html, /AB ∩ CD = ∅/);
  assert.match(html, /Решить систему/);
});

test("circular tools and localized modules are present", async () => {
  const [page, settings, englishTools, solver] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/settings-dialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/tool-localization.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/solver.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /id: "majorSector"/);
  assert.match(page, /id: "circularSegment"/);
  assert.match(page, /resolveArcEnd/);
  assert.match(page, /parseIntersectionConstraint/);
  assert.match(page, /H = EG ∩ DF/);
  assert.match(page, /normalizeUnknownExpression/);
  assert.match(page, /Clear completely/);
  assert.match(page, /focusAdjacentExpression/);
  assert.match(page, /examples-trigger/);
  assert.match(page, /onEllipse/);
  assert.match(page, /shape\.type === "sector"/);
  assert.match(page, /clear-button/);
  assert.doesNotMatch(page, /addKnownExpression\("a \+ b = c"\)/);
  assert.match(settings, /onLocaleChange/);
  assert.match(settings, /English/);
  assert.match(englishTools, /Circular segment/);
  assert.match(solver, /export function solveCoordinates/);
});
