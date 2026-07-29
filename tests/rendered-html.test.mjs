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
  assert.match(html, /Линии · S/);
  assert.match(html, /Четырёхугольники · F/);
  assert.match(html, /Измерить площадь · Q/);
  assert.match(html, /Задать условие · E/);
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
  assert.doesNotMatch(html, /распознано/);
});

test("circular tools and localized modules are present", async () => {
  const [
    page,
    settings,
    tools,
    solver,
    expressions,
    geometry,
    conditions,
    interactions,
    renderer,
    header,
    help,
    objects,
    hitTesting,
    domain,
    projectState,
    examples,
    editorGroups,
    groupReordering,
    foundations,
    responsive,
    exampleFiles,
  ] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/settings-dialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/tools.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/solver.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/expressions.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/geometry.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/conditions-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/canvas-interactions.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/canvas-renderer.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/app-header.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/help-dialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/objects-section.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/canvas-hit-testing.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/domain.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/project-state.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/examples.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/editor-groups.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/group-reordering.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/styles/foundations.css", import.meta.url), "utf8"),
    readFile(new URL("../app/styles/responsive.css", import.meta.url), "utf8"),
    Promise.all(
      [
        "right-triangle",
        "square-area",
        "major-sector",
        "quarter-circle-perpendiculars",
        "rectangle-diagonal-angle",
        "overturned-square",
      ].map((name) =>
        readFile(
          new URL(`../public/examples/${name}.json`, import.meta.url),
          "utf8",
        ),
      ),
    ),
  ]);
  const editorModules = [
    page,
    expressions,
    geometry,
    conditions,
    interactions,
    renderer,
    header,
  ].join("\n");
  assert.ok(page.split(/\r?\n/).length < 2100);
  assert.match(tools, /id: "majorSector"/);
  assert.match(tools, /id: "circularSegment"/);
  assert.match(tools, /Circular segment/);
  assert.match(geometry, /resolveArcEnd/);
  assert.match(expressions, /parseIntersectionConstraint/);
  assert.match(editorModules, /H = EG ∩ DF/);
  assert.match(expressions, /normalizeUnknownExpression/);
  assert.match(header, /Clear completely/);
  assert.match(page, /focusAdjacentExpression/);
  assert.match(conditions, /examples-trigger/);
  assert.match(editorModules, /onEllipse/);
  assert.match(editorModules, /onArc/);
  assert.match(geometry, /projectPointToArc/);
  assert.match(interactions, /cycleOnClick/);
  assert.match(interactions, /cycleCandidates/);
  assert.match(page, /findPointsAt/);
  assert.match(conditions, /Описание чертежа/);
  assert.match(conditions, /ObjectsSection/);
  assert.match(help, /Готовые примеры/);
  assert.match(help, /onLoadExample/);
  assert.match(objects, /onAddPoint/);
  assert.match(objects, /onAddShape\(option\.type\)/);
  assert.match(objects, /object-shape-menu/);
  assert.match(objects, /onDeletePoint/);
  assert.match(objects, /onDeleteShape/);
  assert.match(objects, /object-delete/);
  assert.match(objects, /onMoveShape/);
  assert.match(objects, /object-drag-handle/);
  assert.match(objects, /pointermove/);
  assert.match(objects, /dataObjectColumn="x"/);
  assert.match(objects, /focusField/);
  assert.match(objects, /isValidShapePointCount/);
  assert.match(objects, /pointCountError/);
  assert.match(objects, /shapePointsError/);
  assert.match(objects, /object-inline-error/);
  assert.match(objects, /onValidationChange/);
  assert.match(objects, /onSelectPoints\(shape\.points\)/);
  assert.match(objects, /EditorGroupDropZone/);
  assert.match(objects, /catalogBuckets/);
  assert.doesNotMatch(objects, /SHAPE_TYPES\.filter/);
  assert.match(objects, /object-visibility/);
  assert.match(objects, /event\.altKey/);
  assert.match(objects, /ArrowUp/);
  assert.match(renderer, /shape\.visible === false/);
  assert.match(renderer, /point\.visible === false/);
  assert.match(renderer, /isReferenceVisible/);
  assert.match(renderer, /isReferenceVisible\(mark\.ids\)/);
  assert.match(hitTesting, /point\.visible !== false/);
  assert.match(domain, /visible\?: boolean/);
  assert.match(domain, /export type EditorGroup/);
  assert.match(domain, /anchorId\?: string/);
  assert.match(domain, /groups: EditorGroup\[\]/);
  assert.match(projectState, /typeof value\.visible/);
  assert.match(projectState, /isImportedGroup/);
  assert.match(projectState, /groups: snapshot\.groups/);
  assert.match(examples, /fetch\(new URL/);
  assert.match(examples, /parseImportedProject/);
  assert.match(examples, /quarter-circle-perpendiculars/);
  assert.match(examples, /rectangle-diagonal-angle/);
  assert.match(examples, /overturned-square/);
  assert.doesNotMatch(examples, /snapshot:/);
  assert.match(foundations, /\.object-row:focus-within/);
  assert.match(foundations, /\.editor-group-header/);
  assert.match(foundations, /\.expression-row:focus-within \.row-delete/);
  assert.match(responsive, /@media \(hover: none\), \(pointer: coarse\)/);
  exampleFiles.forEach((source) => {
    const project = JSON.parse(source);
    assert.equal(project.format, "geosolver");
    assert.ok(project.projectTitle);
    assert.ok(Array.isArray(project.points));
    assert.ok(Array.isArray(project.known));
  });
  assert.match(expressions, /fixedLineAnchorIds/);
  assert.match(page, /EMPTY_PROJECT_TITLE/);
  assert.match(renderer, /shape\.type === "sector"/);
  assert.match(header, /clear-button/);
  assert.match(page, /activeCanvasPointersRef/);
  assert.match(page, /pinchGestureRef/);
  assert.match(page, /solverMaxIterationsInput/);
  assert.match(page, /solverTimeLimitMsInput/);
  assert.match(conditions, /focusExpressionAcrossSections/);
  assert.match(conditions, /navigateFromObjects/);
  assert.match(conditions, /insertExpressionAfter\(group, -1\)/);
  assert.match(conditions, /addEditorGroup/);
  assert.match(conditions, /selectEditorGroup/);
  assert.match(conditions, /useEditorGroupReordering/);
  assert.match(editorGroups, /buildGroupedEntries/);
  assert.match(editorGroups, /EditorGroupHeader/);
  assert.match(editorGroups, /EditorGroupDropZone/);
  assert.match(editorGroups, /focusAdjacentEditorEntry/);
  assert.match(editorGroups, /data-editor-navigation-kind="group"/);
  assert.match(editorGroups, /editor-group-drag-handle/);
  assert.match(editorGroups, /editor-group-chevron/);
  assert.match(editorGroups, /emitAnchoredGroups/);
  assert.match(groupReordering, /repositionExpressionGroup/);
  assert.match(groupReordering, /repositionExpressionGroupNearRow/);
  assert.match(groupReordering, /anchorSide: placeAfter/);
  assert.match(groupReordering, /targetBounds\.height \/ 2/);
  assert.match(groupReordering, /shouldSkipTarget/);
  assert.match(groupReordering, /data-expression-row/);
  assert.match(groupReordering, /groupDragHandleProps/);
  assert.match(groupReordering, /moveEditorGroup/);
  assert.match(objects, /data-editor-navigation-kind="object"/);
  assert.doesNotMatch(page, /addKnownExpression\("a \+ b = c"\)/);
  assert.match(settings, /onLocaleChange/);
  assert.match(settings, /English/);
  assert.match(settings, /settings-solver-iterations/);
  assert.match(settings, /settings-solver-time-limit/);
  assert.match(settings, /Maximum iterations/);
  assert.match(settings, /settings-show-area-constraints/);
  assert.match(settings, /Show area constraints/);
  assert.match(solver, /export function solveCoordinates/);
  assert.match(solver, /solveLinearSystem/);
  assert.match(solver, /timeLimitMs/);
});

test("polyline, focused constraints and PWA assets are present", async () => {
  const [
    tools,
    interactions,
    renderer,
    groups,
    reordering,
    conditions,
    toolRail,
    registration,
    manifest,
    sw,
  ] =
    await Promise.all([
      readFile(new URL("../app/tools.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/canvas-interactions.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/canvas-renderer.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/editor-groups.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/expression-reordering.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/conditions-panel.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/tool-rail.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/pwa-registration.tsx", import.meta.url), "utf8"),
      readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
      readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    ]);

  assert.match(tools, /toolIds: \["segment", "line", "ray", "polyline"\]/);
  assert.match(tools, /toolIds: \["setLength", "setAngle", "setArea"\]/);
  assert.match(tools, /id: "quadrilateral"/);
  assert.match(tools, /id: "segment"[\s\S]*?shortcut: "1"/);
  assert.match(tools, /id: "polygon"[\s\S]*?shortcut: "1"/);
  assert.match(
    tools,
    /id: "quadrilaterals"[\s\S]*?shortcut: "F"[\s\S]*?code: "KeyF"/,
  );
  assert.ok(
    tools.indexOf('{ kind: "group", id: "constraints" }') <
      tools.indexOf('{ kind: "tool", id: "length" }'),
  );
  assert.ok(
    tools.indexOf('{ kind: "group", id: "quadrilaterals" }') <
      tools.indexOf('{ kind: "group", id: "polygons" }'),
  );
  assert.match(interactions, /activeTool === "polyline"/);
  assert.match(interactions, /activeTool === "quadrilateral"/);
  assert.match(interactions, /onAddFocusedKnown/);
  assert.match(renderer, /shape\.type === "polyline"/);
  assert.match(groups, /kind: "groupEnd"/);
  assert.match(groups, /data-editor-group-collapsed/);
  assert.match(groups, /data-editor-group-boundary="after"/);
  assert.doesNotMatch(groups, /data-editor-group-boundary="before"/);
  assert.match(groups, /!group\.collapsed && groupItems\.length > 0/);
  assert.match(reordering, /lastDragZoneRef/);
  assert.match(reordering, /draggedMembershipRef/);
  assert.match(reordering, /placeExpressionAfterGroup/);
  assert.match(reordering, /placeExpressionBeforeGroup/);
  assert.match(reordering, /placeExpressionAcrossEmptyGroup/);
  assert.match(reordering, /enterExpressionGroup/);
  assert.match(reordering, /memberIndices\[memberIndices\.length - 1\] \+ 1/);
  assert.match(reordering, /targetEntry\.kind === "group"/);
  assert.match(
    reordering,
    /draggedMembershipRef\.current === targetGroupId[\s\S]*?placeExpressionAfterGroup[\s\S]*?enterExpressionGroup\(group, id, targetGroupId, "last"\)/,
  );
  assert.match(conditions, /data-expression-group-id/);
  assert.match(conditions, /knownNumbers/);
  assert.match(conditions, /unknownNumbers/);
  assert.doesNotMatch(conditions, /t\("распознано", "recognized"\)/);
  assert.match(toolRail, /groupActive \|\| groupOpen/);
  assert.match(registration, /serviceWorker\.register/);
  assert.match(sw, /APP_ROOT/);
  const parsedManifest = JSON.parse(manifest);
  assert.equal(parsedManifest.display, "standalone");
  assert.equal(parsedManifest.start_url, "./");
  assert.ok(parsedManifest.icons.some((icon) => icon.sizes === "512x512"));
});
