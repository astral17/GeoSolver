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
    solverRunner,
    solverWorker,
    solverHook,
    analyticSolver,
    exactValue,
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
    projectMigrations,
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
    readFile(new URL("../app/solver-runner.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/solver-worker.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/use-solver-worker.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/analytic-solver.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/exact-value.ts", import.meta.url), "utf8"),
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
    readFile(new URL("../app/project-migrations.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/project-state.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/examples.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/editor-groups.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/group-reordering.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/styles/foundations.css", import.meta.url), "utf8"),
    readFile(new URL("../app/styles/responsive.css", import.meta.url), "utf8"),
    Promise.all(
      [
        "cardioid",
        "apollo",
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
        "task-t",
        "t18",
        "t17",
        "t16",
        "t15",
        "t14",
        "t13",
        "runaway-polygon",
        "t12",
        "t11",
        "this-is-a-trap",
        "power-chords",
        "all-born-equal",
        "beautiful-haircut",
        "sunset-square-city",
        "t19",
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
  assert.doesNotMatch(tools, /id: "majorSector"/);
  assert.match(tools, /arc start and clockwise end/);
  assert.match(tools, /id: "circularSegment"/);
  assert.match(tools, /id: "intersectionPoint"/);
  assert.match(tools, /id: "crossedPolygon"/);
  assert.match(tools, /Circular segment/);
  assert.match(geometry, /resolveArcEnd/);
  assert.match(geometry, /ellipseGeometry/);
  assert.match(renderer, /-geometry\.rotation/);
  assert.match(geometry, /geometryContainmentResidual/);
  assert.match(geometry, /geometryIntersectionArea/);
  assert.match(geometry, /linearIntersection/);
  assert.match(expressions, /parseIntersectionConstraint/);
  assert.match(solverHook, /new Worker\(new URL\("\.\/solver-worker\.ts"/);
  assert.match(solverWorker, /type: "progress"/);
  assert.match(solverRunner, /request\.timeLimitMs - \(performance\.now\(\) - startedAt\)/);
  assert.match(examples, /PROJECT_EXAMPLE_CATEGORIES/);
  assert.match(examples, /id: "equations"/);
  assert.match(examples, /new Set\(\["cardioid", "apollo"\]\)/);
  assert.match(expressions, /export function locateObjectIntersections/);
  assert.match(expressions, /parseIntersectionPointSet/);
  assert.match(expressions, /parseContainmentConstraint/);
  assert.match(expressions, /constraint\.kind === "convex"/);
  assert.match(expressions, /OBJECTDISTANCE_/);
  assert.match(expressions, /distanceBetweenObjects/);
  assert.match(expressions, /definitionSources/);
  assert.match(editorModules, /H = EG ∩ DF/);
  assert.match(expressions, /normalizeUnknownExpression/);
  assert.match(header, /Clear completely/);
  assert.match(page, /focusAdjacentExpression/);
  assert.match(conditions, /examples-trigger/);
  assert.match(editorModules, /onEllipse/);
  assert.match(editorModules, /onArc/);
  assert.match(interactions, /locateObjectIntersections/);
  assert.match(geometry, /projectPointToArc/);
  assert.match(interactions, /cycleOnClick/);
  assert.match(interactions, /cycleCandidates/);
  assert.match(interactions, /activeTool === "setArea"/);
  assert.match(interactions, /pendingPoints\.includes\(id\)/);
  assert.doesNotMatch(interactions, /shapeReference/);
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
  assert.doesNotMatch(objects, /EditorGroupDropZone/);
  assert.match(objects, /catalogBuckets/);
  assert.match(objects, /buildGroupedEntries\(catalogItems, groups\)/);
  assert.match(objects, /EditorGroupBoundaryDropZone/);
  assert.match(objects, /commitObjectMove/);
  assert.match(objects, /moveObjectStep/);
  assert.match(objects, /moveEditorRowOneStep/);
  assert.match(objects, /type: "equation"/);
  assert.doesNotMatch(objects, /type: "equationLine"/);
  assert.doesNotMatch(objects, /type: "equationRegion"/);
  assert.match(objects, /shadowedEquationVariables/);
  assert.doesNotMatch(objects, /SHAPE_TYPES\.filter/);
  assert.match(objects, /object-visibility/);
  assert.match(objects, /event\.altKey/);
  assert.match(objects, /ArrowUp/);
  assert.match(renderer, /shape\.visible === false/);
  assert.match(renderer, /point\.visible === false/);
  assert.match(renderer, /isReferenceVisible/);
  assert.match(renderer, /isReferenceVisible\(mark\.ids\)/);
  assert.match(renderer, /compileImplicitEquation/);
  assert.match(hitTesting, /point\.visible !== false/);
  assert.match(domain, /visible\?: boolean/);
  assert.match(domain, /export type EditorGroup/);
  assert.match(domain, /anchorId\?: string/);
  assert.match(domain, /groups: EditorGroup\[\]/);
  assert.match(projectState, /typeof value\.visible/);
  assert.match(projectState, /isImportedGroup/);
  assert.match(projectState, /groups: snapshot\.groups/);
  assert.match(projectMigrations, /PROJECT_MIGRATIONS/);
  assert.match(projectMigrations, /migrateLegacyIntersectionExpression/);
  assert.match(examples, /fetch\(new URL/);
  assert.match(examples, /parseImportedProject/);
  assert.match(examples, /quarter-circle-perpendiculars/);
  assert.match(examples, /rectangle-diagonal-angle/);
  assert.match(examples, /overturned-square/);
  assert.match(examples, /doc-oct/);
  assert.match(examples, /tangent-circles-25/);
  assert.match(examples, /triangle-altitudes-24/);
  assert.match(examples, /equilateral-circle-26/);
  assert.match(examples, /green-vs-blue/);
  assert.match(examples, /semicircle-turducken/);
  assert.match(examples, /two-circles-tale/);
  assert.match(examples, /washing-machine/);
  assert.match(examples, /one-fact/);
  assert.match(examples, /all-in-square/);
  assert.match(examples, /isosceles-everywhere/);
  assert.match(examples, /t1-angle-sum/);
  assert.match(examples, /isosceles-altitude/);
  assert.match(examples, /median-area-t2/);
  assert.match(examples, /inconsistent-altitude-t3/);
  assert.match(examples, /right-triangle-altitude-t4/);
  assert.match(examples, /intersecting-sectors-t5/);
  assert.doesNotMatch(examples, /snapshot:/);
  assert.match(foundations, /\.object-row:focus-within/);
  assert.match(foundations, /\.editor-group-header/);
  assert.match(foundations, /\.expression-row:focus-within \.row-delete/);
  assert.match(
    foundations,
    /\.tool-rail\s*\{[\s\S]*?z-index:\s*50/,
  );
  assert.match(renderer, /equationQualityRef/);
  assert.match(renderer, /draftEquation/);
  assert.match(renderer, /setTimeout\([\s\S]*?,\s*70\)/);
  assert.match(responsive, /@media \(hover: none\), \(pointer: coarse\)/);
  exampleFiles.forEach((source) => {
    const project = JSON.parse(source);
    assert.equal(project.format, "geosolver");
    assert.ok(project.projectTitle);
    assert.ok(Array.isArray(project.points));
    assert.ok(Array.isArray(project.known));
  });
  assert.ok(
    exampleFiles.some(
      (source) =>
        source.includes("E ∈ arc(ABC)") && source.includes("G ∈ arc(ABC)"),
    ),
  );
  assert.match(expressions, /fixedLineAnchorIds/);
  assert.match(page, /EMPTY_PROJECT_TITLE/);
  assert.match(renderer, /shape\.type === "sector"/);
  assert.match(header, /clear-button/);
  assert.match(page, /activeCanvasPointersRef/);
  assert.match(page, /pinchGestureRef/);
  assert.match(page, /const MIN_VIEW_SCALE = 0\.1/);
  assert.match(page, /const MAX_VIEW_SCALE = 100_000/);
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
  assert.doesNotMatch(editorGroups, /EditorGroupDropZone/);
  assert.match(editorGroups, /focusAdjacentEditorEntry/);
  assert.match(editorGroups, /moveEditorRowOneStep/);
  assert.match(editorGroups, /data-editor-navigation-kind="group"/);
  assert.match(editorGroups, /editor-group-drag-handle/);
  assert.match(editorGroups, /editor-group-chevron/);
  assert.match(editorGroups, /emitContainer/);
  assert.match(editorGroups, /parentGroupId/);
  assert.match(groupReordering, /repositionExpressionGroup/);
  assert.match(groupReordering, /repositionExpressionGroupNearRow/);
  assert.match(groupReordering, /anchorSide: placeAfter/);
  assert.match(groupReordering, /targetBounds\.height \/ 2/);
  assert.match(groupReordering, /shouldSkipTarget/);
  assert.match(groupReordering, /data-expression-row/);
  assert.match(groupReordering, /groupDragHandleProps/);
  assert.match(groupReordering, /moveEditorGroup/);
  assert.match(groupReordering, /normalizeGroupSection/);
  assert.match(groupReordering, /commitGroupMove/);
  assert.match(groupReordering, /advanceGroupDown/);
  assert.match(groupReordering, /boundaryGroupId === source\.parentGroupId/);
  assert.match(groupReordering, /dragStepRef/);
  assert.match(groupReordering, /groupSiblingTokens/);
  assert.match(groupReordering, /direction < 0 \? "last" : "first"/);
  assert.match(groupReordering, /if \(candidateId === ancestorId\) return true/);
  assert.match(groupReordering, /if \(hitsOwnContent\)/);
  assert.match(groupReordering, /ordered-object/);
  assert.match(groupReordering, /exit-on-content/);
  assert.doesNotMatch(groupReordering, /editor-group-drag-ghost/);
  assert.match(groupReordering, /groupsRef\.current/);
  assert.match(objects, /data-editor-navigation-kind="object"/);
  assert.doesNotMatch(page, /addKnownExpression\("a \+ b = c"\)/);
  assert.match(settings, /onLocaleChange/);
  assert.match(settings, /English/);
  assert.match(settings, /settings-solver-iterations/);
  assert.match(settings, /settings-solver-time-limit/);
  assert.match(settings, /Maximum iterations/);
  assert.match(settings, /onSolverModeChange/);
  assert.match(settings, /Analytical/);
  assert.match(settings, /settings-show-area-constraints/);
  assert.match(settings, /Show area constraints/);
  assert.match(solver, /export function solveCoordinates/);
  assert.match(solver, /solveLinearSystem/);
  assert.match(solver, /timeLimitMs/);
  assert.match(solverRunner, /solveAnalytically/);
  assert.match(solverRunner, /request\.mode === "analytic"/);
  assert.match(analyticSolver, /export function solveAnalytically/);
  assert.match(analyticSolver, /Pythagorean theorem/);
  assert.match(exactValue, /export function formatExact/);
  assert.match(exactValue, /sqrt/);
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
  assert.match(
    tools,
    /toolIds: \["polygon", "crossedPolygon", "regularPolygon"\]/,
  );
  assert.match(tools, /!regular && !allowSelfIntersections/);
  assert.match(tools, /expressions\.push\(`convex\(/);
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
  assert.match(interactions, /activeTool === "intersectionPoint"/);
  assert.match(interactions, /findIntersectionObjectsAt/);
  assert.match(interactions, /locateObjectIntersections/);
  assert.match(interactions, /resetPendingIntersection/);
  assert.match(interactions, /activeTool === "quadrilateral"/);
  assert.match(interactions, /onAddFocusedKnown/);
  assert.match(renderer, /shape\.type === "polyline"/);
  assert.match(groups, /kind: "groupEnd"/);
  assert.match(groups, /materializeEditorOrder/);
  assert.match(groups, /moveEditorRow/);
  assert.match(groups, /moveEditorGroupByOrder/);
  assert.match(groups, /targetIndex < 0/);
  assert.match(groups, /data-editor-group-collapsed/);
  assert.match(groups, /data-editor-group-boundary="after"/);
  assert.doesNotMatch(groups, /data-editor-group-boundary="before"/);
  assert.match(groups, /if \(token\.group\.collapsed\) return/);
  assert.match(groups, /emitContainer\(token\.group\.id, depth \+ 1\)/);
  assert.match(reordering, /lastDragZoneRef/);
  assert.match(reordering, /dragAnchorRef/);
  assert.doesNotMatch(reordering, /bounds\.top \+ 54/);
  assert.match(reordering, /draggedMembershipRef/);
  assert.match(reordering, /commitOrderedMove/);
  assert.match(reordering, /pointerDirection < 0/);
  assert.match(reordering, /placeExpressionAfterGroup/);
  assert.match(reordering, /placeExpressionBeforeGroup/);
  assert.match(reordering, /placeExpressionAcrossEmptyGroup/);
  assert.match(reordering, /enterExpressionGroup/);
  assert.match(reordering, /memberIndices\[memberIndices\.length - 1\] \+ 1/);
  assert.match(reordering, /moveEditorRowOneStep/);
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
